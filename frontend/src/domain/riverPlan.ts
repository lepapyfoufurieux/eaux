import type { Station, Watercourse } from "../types";

/**
 * Layout of the schematic "Fil de l'eau" plan, computed from the data instead of hard-coded:
 * the main river runs left to right, each tributary hangs above or below its confluence.
 */
export interface PlanLayout {
  trunk: { name: string; x1: number; x2: number; y: number };
  branches: { name: string; x: number; direction: -1 | 1; stations: string[] }[];
  positions: Record<string, { x: number; y: number; onTrunk: boolean; river: string }>;
  /** Stations that could not be placed (no watercourse, or one outside the trunk's network). */
  unplaced: string[];
  width: number;
  height: number;
}

const X0 = 80;
const GAP = 190;
const TRUNK_Y_OFFSET = 360;
const FIRST_STEP = 125;
// Two branches on the same side of the trunk stay this far apart, so their labels (written to the right) never overlap.
const BRANCH_GAP = 240;
// Room kept above the highest station and below the lowest one, for their labels.
const MARGIN = 60;
const NEXT_STEP = 110;

export function layoutRiverPlan(stations: Station[], watercourses: Watercourse[]): PlanLayout {
  const byId = new Map(watercourses.map((w) => [w.id, w]));
  const stationsOn = (id: number) => stations.filter((s) => s.watercourseId === id);

  // The trunk is the top-level watercourse holding the most stations.
  const roots = watercourses.filter((w) => w.tributaryOf === null);
  const trunk = roots.sort((a, b) => stationsOn(b.id).length - stationsOn(a.id).length)[0];
  if (!trunk) {
    return { trunk: { name: "", x1: 0, x2: 0, y: 0 }, branches: [], positions: {}, unplaced: stations.map((s) => s.code), width: 0, height: 0 };
  }

  // The direct tributary of the trunk that a watercourse eventually flows into.
  const branchRoot = (w: Watercourse): Watercourse | null => {
    let current: Watercourse | undefined = w;
    for (let guard = 0; current && guard < 20; guard++) {
      if (current.tributaryOf === trunk.id) return current;
      current = current.tributaryOf === null ? undefined : byId.get(current.tributaryOf);
    }
    return null;
  };

  const trunkStations = stationsOn(trunk.id).sort((a, b) => a.order - b.order);
  const trunkEnd = X0 + Math.max(trunkStations.length, 1) * GAP;
  const y = TRUNK_Y_OFFSET;
  const positions: PlanLayout["positions"] = {};
  trunkStations.forEach((s, i) => {
    positions[s.code] = { x: X0 + i * GAP, y, onTrunk: true, river: trunk.name };
  });

  // Gather branch stations under their branch root.
  const branchStations = new Map<number, Station[]>();
  const unplaced: string[] = [];
  for (const s of stations) {
    if (s.watercourseId === trunk.id) continue;
    const w = s.watercourseId === null ? undefined : byId.get(s.watercourseId);
    const root = w ? branchRoot(w) : null;
    if (!root) {
      unplaced.push(s.code);
      continue;
    }
    branchStations.set(root.id, [...(branchStations.get(root.id) ?? []), s]);
  }

  const branchRoots = [...branchStations.keys()].map((id) => byId.get(id)!);
  const confluenceX = (w: Watercourse, i: number) =>
    w.confluencePosition !== null ? X0 + w.confluencePosition * (trunkEnd - X0) : X0 + GAP / 2 + i * GAP;
  const ordered = branchRoots.map((w, i) => ({ w, x: confluenceX(w, i) })).sort((a, b) => a.x - b.x);

  // Each branch goes on the side with more room (above first), and moves downstream if its confluence is too close.
  const lastX = { [-1]: -Infinity, [1]: -Infinity };
  const branches: PlanLayout["branches"] = ordered.map(({ w, x: confluence }) => {
    const direction: -1 | 1 = lastX[-1] <= lastX[1] ? -1 : 1;
    const x = Math.max(confluence, lastX[direction] + BRANCH_GAP);
    lastX[direction] = x;
    // Nearest the confluence first, which is the most downstream station.
    const list = branchStations.get(w.id)!.sort((a, b) => b.order - a.order);
    list.forEach((s, k) => {
      positions[s.code] = { x, y: y + direction * (FIRST_STEP + k * NEXT_STEP), onTrunk: false, river: w.name };
    });
    return { name: w.name, x, direction, stations: list.map((s) => s.code) };
  });

  // Fit the height to the deepest branch on each side, with room for the labels above and below.
  const ys = Object.values(positions).map((p) => p.y);
  const shift = Math.max(0, MARGIN - Math.min(y, ...ys));
  for (const p of Object.values(positions)) p.y += shift;
  return {
    // A branch pushed past the last station still hangs from the trunk.
    trunk: { name: trunk.name, x1: 30, x2: Math.max(trunkEnd, ...branches.map((b) => b.x + 30)), y: y + shift },
    branches,
    positions,
    unplaced,
    width: Math.max(trunkEnd, ...branches.map((b) => b.x + BRANCH_GAP)) + 60,
    height: Math.max(y * 2, ...ys.map((v) => v + MARGIN)) + shift,
  };
}
