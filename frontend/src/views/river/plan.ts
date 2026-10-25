import { FLOW, FLOW_LEVELS, flowColour, flowRank } from "../../domain/flow";
import { type MonthIndex, monthLabel } from "../../domain/months";
import { type PlanLayout, layoutRiverPlan } from "../../domain/riverPlan";
import { readingInMonth, stationStateAt } from "../../domain/stationState";
import { $, esc } from "../../html";
import { type AppState, dataSpan, state, subscribe, update } from "../../state";
import type { Reading } from "../../types";
import { renderStationCard } from "./stationCard";

const STRIP_MONTHS = 17;
const PLAY_INTERVAL_MS = 900;

let layout: PlanLayout | null = null;
let layoutKey = "";
let timer: number | undefined;
/** Part of the plan in view (SVG units); pinching, dragging and the wheel change it. */
let view = { x: 0, y: 0, w: 0, h: 0 };
// Clicks that end a drag or a pinch must not select a station.
let dragged = false;
const MAX_ZOOM = 6;

/** The schematic "Fil de l'eau" view: every station coloured by its latest reading at the chosen month. */
export function mountRiverView(): void {
  const plan = $<SVGSVGElement>("#river-plan");
  const slider = $<HTMLInputElement>("#river-month-input");
  const play = $<HTMLButtonElement>("#river-play");

  mountZoom(plan);
  plan.addEventListener("click", (event) => {
    if (dragged) return;
    const code = (event.target as Element).closest<SVGElement>("[data-station]")?.dataset.station;
    if (code) update({ selectedStation: code });
  });
  plan.addEventListener("keydown", (event) => {
    const code = (event.target as SVGElement).dataset?.station;
    if (code && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      update({ selectedStation: code });
    }
  });
  slider.addEventListener("input", () => update({ riverMonth: Number(slider.value) }));
  play.addEventListener("click", togglePlay);

  subscribe(render);
}

/** Zoom and pan inside the plan only: two fingers pinch, one finger or the mouse drags, the wheel zooms. */
function mountZoom(svg: SVGSVGElement): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  // Client pixels to SVG units, at the current zoom.
  const toSvg = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!.inverse());
  const apply = () => {
    if (!layout) return;
    const { width, height } = layout;
    view.w = Math.min(width, Math.max(width / MAX_ZOOM, view.w));
    view.h = view.w * (height / width);
    view.x = Math.min(width - view.w, Math.max(0, view.x));
    view.y = Math.min(height - view.h, Math.max(0, view.y));
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  };
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const p = toSvg(clientX, clientY);
    const w = Math.min(layout!.width, Math.max(layout!.width / MAX_ZOOM, view.w / factor));
    const k = w / view.w;
    view = { x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k, w, h: view.h * k };
    apply();
  };

  svg.addEventListener("pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) moved = 0;
    if (pointers.size === 1) dragged = false;
  });
  svg.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (!last || !layout) return;
    const now = { x: event.clientX, y: event.clientY };
    if (pointers.size === 2) {
      const [other] = [...pointers.entries()].filter(([id]) => id !== event.pointerId).map(([, p]) => p);
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      if (before > 0) zoomAt((now.x + other.x) / 2, (now.y + other.y) / 2, after / before);
    } else {
      const a = toSvg(last.x, last.y);
      const b = toSvg(now.x, now.y);
      view.x -= b.x - a.x;
      view.y -= b.y - a.y;
      apply();
    }
    moved += Math.hypot(now.x - last.x, now.y - last.y);
    dragged = moved > 6;
    pointers.set(event.pointerId, now);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    svg.addEventListener(type, (event) => pointers.delete((event as PointerEvent).pointerId));
  }
  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.2 : 1 / 1.2);
    },
    { passive: false },
  );
}

function togglePlay(): void {
  const play = $<HTMLButtonElement>("#river-play");
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
    play.textContent = "Faire défiler";
    return;
  }
  const [lo, hi] = dataSpan();
  update({ riverMonth: lo });
  play.textContent = "Arrêter";
  timer = window.setInterval(() => {
    if (state.riverMonth >= hi) togglePlay();
    else update({ riverMonth: state.riverMonth + 1 });
  }, PLAY_INTERVAL_MS);
}

function render(s: AppState): void {
  if (s.mode !== "river") return;
  // The layout only depends on stations and watercourses; recompute it when they change.
  const key = `${s.stations.length}:${s.watercourses.length}`;
  if (!layout || key !== layoutKey) {
    layout = layoutRiverPlan(s.stations, s.watercourses);
    layoutKey = key;
    view = { x: 0, y: 0, w: layout.width, h: layout.height };
  }
  const [lo, hi] = dataSpan();
  const slider = $<HTMLInputElement>("#river-month-input");
  slider.min = String(lo);
  slider.max = String(hi);
  slider.value = String(s.riverMonth);
  $("#river-month").textContent = monthLabel(s.riverMonth);

  drawTally(s);
  drawPlan(s, layout);
  renderStationCard(s);
}

function drawTally(s: AppState): void {
  const counts = Object.fromEntries(FLOW_LEVELS.map((k) => [k, 0])) as Record<string, number>;
  let unknown = 0;
  for (const station of s.stations) {
    const reading = stationStateAt(s.readings, station.code, s.riverMonth);
    if (reading) counts[reading.flowLevel]++;
    else unknown++;
  }
  $("#river-tally").innerHTML =
    FLOW_LEVELS.map((k) => `<span style="--c:${FLOW[k].colour}"><i></i>${FLOW[k].label} <b>${counts[k]}</b></span>`).join("") +
    `<span style="--c:${flowColour(null)}"><i></i>Sans nouvelles <b>${unknown}</b></span>`;
}

const segment = (x1: number, y1: number, x2: number, y2: number, reading: Reading | null, width: number) =>
  `<path class="track${reading ? "" : " unknown"}" d="M${x1} ${y1} L${x2} ${y2}" stroke="${flowColour(reading?.flowLevel)}" stroke-width="${width}"/>`;

function strip(s: AppState, code: string, x: number, y: number, month: MonthIndex): string {
  let cells = "";
  for (let i = 0; i < STRIP_MONTHS; i++) {
    const m = month - STRIP_MONTHS + 1 + i;
    const reading = readingInMonth(s.readings, code, m);
    cells += `<rect class="cell${m === month ? " now" : ""}" x="${x + i * 5.5}" y="${y}" width="5.5" height="9" fill="${flowColour(reading?.flowLevel)}"><title>${monthLabel(m)} : ${reading ? FLOW[reading.flowLevel].label : "pas de relevé"}</title></rect>`;
  }
  return cells;
}

function drawPlan(s: AppState, plan: PlanLayout): void {
  const svg = $<SVGSVGElement>("#river-plan");
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const at = (code: string) => stationStateAt(s.readings, code, s.riverMonth);
  const { y } = plan.trunk;
  const trunkCodes = Object.entries(plan.positions)
    .filter(([, p]) => p.onTrunk)
    .sort(([, a], [, b]) => a.x - b.x);

  // Trunk: each stretch takes the colour of the station just upstream of it.
  let out = segment(plan.trunk.x1, y, trunkCodes[0]?.[1].x ?? plan.trunk.x2, y, trunkCodes[0] ? at(trunkCodes[0][0]) : null, 14);
  trunkCodes.forEach(([code, p], i) => {
    const next = trunkCodes[i + 1]?.[1].x ?? plan.trunk.x2;
    out += segment(p.x, y, next, y, at(code), 14);
  });

  // Branches: the stretch from the confluence shows the driest station of the branch.
  for (const branch of plan.branches) {
    const states = branch.stations.map(at).filter((r): r is Reading => r !== null);
    const driest = states.sort((a, b) => flowRank(a.flowLevel) - flowRank(b.flowLevel))[0] ?? null;
    out += segment(branch.x, y, branch.x, plan.positions[branch.stations[0]].y, driest, 7);
    branch.stations.forEach((code, i) => {
      if (i > 0) out += segment(branch.x, plan.positions[branch.stations[i - 1]].y, branch.x, plan.positions[code].y, at(code), 7);
    });
  }

  out += `<text class="river-name trunk" x="${plan.trunk.x1}" y="${y - 20}">${esc(plan.trunk.name.toUpperCase())}</text>`;

  for (const station of s.stations) {
    const p = plan.positions[station.code];
    if (!p) continue;
    const count = s.readings.filter((r) => r.station === station.code).length;
    const countLabel = `${count} relevé${count > 1 ? "s" : ""}`;
    const label = p.onTrunk
      ? `<text x="${p.x}" y="${y + 36}" text-anchor="middle" class="name">${esc(station.name)}</text>
         <text x="${p.x}" y="${y + 50}" text-anchor="middle" class="meta">${countLabel}</text>${strip(s, station.code, p.x - 47, y + 56, s.riverMonth)}`
      : `<text x="${p.x + 18}" y="${p.y - 6}" class="name">${esc(station.name)}</text>
         <text x="${p.x + 18}" y="${p.y + 8}" class="meta">${esc(p.river)} · ${countLabel}</text>${strip(s, station.code, p.x + 18, p.y + 13, s.riverMonth)}`;
    const selected = s.selectedStation === station.code ? " selected" : "";
    out += `<g class="station${selected}" data-station="${station.code}" tabindex="0" role="button" aria-label="${esc(station.name)}">
      ${label}<circle cx="${p.x}" cy="${p.y}" r="${p.onTrunk ? 13 : 10}"/></g>`;
  }
  svg.innerHTML = out;
}
