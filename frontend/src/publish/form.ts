import { fetchBasin, fetchSprings, fetchWatercourseLines, publishReading } from "../api";
import { FLOW, FLOW_LEVELS, type FlowLevel } from "../domain/flow";
import { distanceM, insideRing } from "../domain/geo";
import { SPRING_RADIUS_M } from "../domain/mapLevels";
import { $, esc, formatDate, storage } from "../html";
import { addReading, state, update } from "../state";
import type { LatLng } from "../types";
import { compress } from "./compress";
import { readMetadata } from "./exif";

const NAME_KEY = "eds-name";
const EDIT_KEYS = "eds-edit-keys";
const ATTACH_RADIUS_M = 400;

let basinRings: [number, number][][] | null = null;

async function insideBasin(point: LatLng): Promise<boolean> {
  if (!basinRings) {
    const basin = await fetchBasin();
    basinRings = basin.features.flatMap((f) => f.geometry.coordinates.map((polygon: [number, number][][]) => polygon[0]));
  }
  // No outline loaded yet (fresh install): let the server decide.
  return basinRings.length === 0 || basinRings.some((ring) => insideRing(point, ring));
}

function nearestStation(point: LatLng) {
  return state.stations
    .map((station) => ({ station, distance: distanceM(point, station) }))
    .filter((s) => s.distance < ATTACH_RADIUS_M)
    .sort((a, b) => a.distance - b.distance)[0];
}

/** The "Publier des photos" dialog (cahier des charges, 2.4). */
export function mountPublishForm(): void {
  $("#btn-publish").addEventListener("click", open);
}

function open(): void {
  const dialog = $<HTMLDialogElement>("#sheet");
  const remembered = storage.get(NAME_KEY) ?? "";
  dialog.innerHTML = `
    <form method="dialog" class="publish">
      <h2>Publier une photo</h2>
      <label class="drop">Choisir une photo<input type="file" accept="image/jpeg,image/*" id="f-photo" required></label>
      <div id="f-checks" class="checks" aria-live="polite"></div>
      <div id="f-station"></div>
      <label>Votre nom ou prénom<input type="text" id="f-name" autocomplete="given-name" value="${esc(remembered)}" required></label>
      <label class="row"><input type="checkbox" id="f-remember" ${remembered ? "checked" : ""}> Se souvenir de mon nom sur cet appareil</label>
      <fieldset class="flows"><legend>Débit observé</legend>
        ${FLOW_LEVELS.map((k) => `<label style="--c:${FLOW[k].colour}"><input type="radio" name="flow" value="${k}" required>${FLOW[k].label}<small>${FLOW[k].hint}</small></label>`).join("")}
      </fieldset>
      <label>Commentaire (facultatif)<textarea id="f-comment" maxlength="2000" placeholder="Biodiversité, météo des derniers jours, aspect de l'eau…"></textarea></label>
      <div id="f-message" role="status"></div>
      <div class="buttons">
        <button type="button" class="btn" value="cancel" id="f-cancel">Annuler</button>
        <button type="submit" class="btn primary" id="f-submit" disabled>Publier</button>
      </div>
    </form>`;
  dialog.showModal();

  let pending: { photo: Blob; position: LatLng | null; takenAt: Date } | null = null;
  const checks = $("#f-checks");
  const message = $("#f-message");
  const submit = $<HTMLButtonElement>("#f-submit");
  const fail = (title: string, detail: string) => {
    message.innerHTML = `<div class="msg error"><strong>${title}</strong> ${detail}</div>`;
  };

  $("#f-cancel").addEventListener("click", () => dialog.close());

  $<HTMLInputElement>("#f-photo").addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    pending = null;
    submit.disabled = true;
    message.innerHTML = "";
    $("#f-station").innerHTML = "";
    if (!file) return;
    checks.textContent = "Lecture des métadonnées (EXIF)…";

    const meta = await readMetadata(file);
    if (meta.position && !(await insideBasin(meta.position))) {
      checks.textContent = `✓ Position trouvée · ✕ Hors du bassin versant`;
      return fail("Cette photo a été prise hors du bassin versant.", "Seuls les cours d'eau du bassin versant de Saurat sont suivis.");
    }
    let photo: Blob;
    try {
      photo = await compress(file);
    } catch {
      return fail("Ce format d'image n'est pas pris en charge.", "Sur iPhone : Réglages › Appareil photo › Formats › « Le plus compatible ».");
    }
    const where = meta.position ? `✓ Position ${meta.position.lat.toFixed(5)}, ${meta.position.lng.toFixed(5)}` : "✕ Pas de position GPS";
    checks.textContent = `${where} · ✓ Prise le ${formatDate(meta.takenAt)} · ✓ ${Math.round(photo.size / 1024)} Ko`;
    await renderPlaceChoice(meta.position);
    pending = { photo, ...meta };
    submit.disabled = false;
  });

  dialog.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!pending) return;
    const name = $<HTMLInputElement>("#f-name").value.trim();
    const flow = (dialog.querySelector<HTMLInputElement>('input[name="flow"]:checked')?.value ?? "") as FlowLevel;
    if (!name || !flow) return fail("Il manque des informations.", "Indiquez votre nom et le débit observé.");
    storage.set(NAME_KEY, $<HTMLInputElement>("#f-remember").checked ? name : null);

    const station = dialog.querySelector<HTMLSelectElement>("#f-station-select:enabled")?.value || undefined;
    submit.disabled = true;
    try {
      const result = await publishReading({
        ...pending,
        // A place picked by hand replaces the GPS: a station stands for itself, a spring or a bare watercourse lends its position.
        position: placePicked() ? chosenSpring() ?? (station ? null : chosenWatercourse()) : pending.position,
        flowLevel: flow,
        authorName: name,
        comment: $<HTMLTextAreaElement>("#f-comment").value,
        station,
      });
      rememberEditKey(result.reading.id, result.editKey);
      addReading(result.reading);
      if (result.reading.station) update({ selectedStation: result.reading.station });
      dialog.close();
    } catch (error) {
      submit.disabled = false;
      fail("La publication a échoué.", (error as Error).message);
    }
  });
}

const byCode = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const at = (lng: number, lat: number) => `${lat},${lng}`;

/**
 * Where the photo was taken. With GPS the photo's position is used, and a button opens the place chooser for a
 * contributor who would rather say it by hand. Without GPS the chooser is shown straight away.
 */
async function renderPlaceChoice(position: LatLng | null): Promise<void> {
  const box = $("#f-station");
  if (!position) {
    box.innerHTML = `<small>La photo ne contient pas sa position : indiquez où elle a été prise.</small><div id="f-place"></div>`;
    return renderPlacePicker(null);
  }
  const nearest = nearestStation(position);
  box.innerHTML = `<small>Position GPS de la photo utilisée. ${
    nearest ? `${esc(nearest.station.name)} est à ${Math.round(nearest.distance)} m.` : "Aucune station à moins de 400 m : la photo apparaîtra sur la carte seulement."
  }</small>
    <button type="button" class="btn" id="f-pick-place" aria-expanded="false">Choisir la position</button>
    <div id="f-place"></div>`;
  const button = $<HTMLButtonElement>("#f-pick-place");
  button.addEventListener("click", async () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Utiliser la position GPS" : "Choisir la position";
    $("#f-place").innerHTML = "";
    if (open) await renderPlacePicker(position);
  });
}

const placePicked = () => document.querySelector("#f-on-watercourse") !== null;

/**
 * On a watercourse (then a station on it) or at a spring, unnamed ones included; required once shown.
 * `near` (the GPS position, if any) pre-selects the nearest station, or else the spring within 50 m.
 * A spring, or a watercourse with no station, lends its own position to the photo (data-at).
 */
async function renderPlacePicker(near: LatLng | null): Promise<void> {  const [lines, springs] = await Promise.all([fetchWatercourseLines(), fetchSprings()]);
  // Watercourses have no number: those with stations follow their first station's, the others come after by name.
  const firstCode = (id: number) => state.stations.filter((s) => s.watercourseId === id).map((s) => s.code).sort(byCode)[0];
  const watercourses = lines.features
    .map(({ properties: p, geometry }) => {
      // shortcut: the middle vertex of the longest piece stands for the watercourse; fine for a map pin.
      const piece = [...geometry.coordinates].sort((a: number[][], b: number[][]) => b.length - a.length)[0];
      const [lng, lat] = piece[Math.floor(piece.length / 2)];
      const label = p.name.startsWith("Cours d'eau sans nom") ? `${p.name} (${p.topage_code || `n° ${p.id}`})` : p.name;
      return { id: p.id as number, label, first: firstCode(p.id), at: at(lng, lat) };
    })
    .sort((a, b) => (a.first && b.first ? byCode(a.first, b.first) : a.first ? -1 : b.first ? 1 : byCode(a.label, b.label)));
  // Named springs first, then the others from the highest down.
  const springOptions = springs.features
    .map(({ properties: p, geometry }) => ({
      named: p.kind.includes("("),
      altitude: p.altitude_m ?? 0,
      label: `${p.kind}${p.altitude_m ? ` · ${p.altitude_m} m` : ""}`,
      at: at(geometry.coordinates[0], geometry.coordinates[1]),
    }))
    .sort((a, b) => Number(b.named) - Number(a.named) || (a.named ? byCode(a.label, b.label) : b.altitude - a.altitude));

  const nearest = near && nearestStation(near);
  const spring = near && !nearest ? springs.features.find((f) => distanceM(near, { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }) <= SPRING_RADIUS_M) : undefined;
  const box = $("#f-place");
  box.innerHTML = `
    <div class="modes" role="group" aria-label="Lieu de la photo">
      <button type="button" data-place="watercourse" aria-pressed="true">Cours d'eau</button>
      <button type="button" data-place="spring" aria-pressed="false">Source</button>
    </div>
    <div id="f-on-watercourse">
      <label>Cours d'eau
        <select id="f-watercourse" required><option value="">Choisir…</option>
          ${watercourses.map((w) => `<option value="${w.id}" data-at="${w.at}">${esc(w.label)}</option>`).join("")}</select></label>
      <label>Station<select id="f-station-select" required disabled><option value="">Choisir d'abord le cours d'eau</option></select></label>
    </div>
    <label id="f-on-spring" hidden>Source
      <select id="f-spring" required disabled><option value="">Choisir…</option>
        ${springOptions.map((s) => `<option value="${s.at}">${esc(s.label)}</option>`).join("")}</select></label>`;

  const watercourseSelect = $<HTMLSelectElement>("#f-watercourse");
  const stationSelect = $<HTMLSelectElement>("#f-station-select");
  const springSelect = $<HTMLSelectElement>("#f-spring");
  const showStations = () => {
    const stations = state.stations.filter((s) => s.watercourseId === Number(watercourseSelect.value)).sort((a, b) => byCode(a.code, b.code));
    stationSelect.disabled = !watercourseSelect.value;
    stationSelect.required = stations.length > 0;
    stationSelect.innerHTML = !watercourseSelect.value
      ? `<option value="">Choisir d'abord le cours d'eau</option>`
      : stations.length
        ? `<option value="">Choisir…</option>` + stations.map((s) => `<option value="${s.code}">${esc(s.code)} · ${esc(s.name)}</option>`).join("")
        : `<option value="">Pas de station sur ce cours d'eau</option>`;
  };
  watercourseSelect.addEventListener("change", showStations);
  // The hidden choice is disabled, so the browser neither requires nor sends it.
  for (const button of box.querySelectorAll<HTMLButtonElement>("[data-place]")) {
    button.addEventListener("click", () => {
      const spring = button.dataset.place === "spring";
      box.querySelectorAll("[data-place]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      $("#f-on-watercourse").hidden = spring;
      $("#f-on-spring").hidden = !spring;
      watercourseSelect.disabled = spring;
      springSelect.disabled = !spring;
      if (spring) stationSelect.disabled = true;
      else showStations();
    });
  }

  if (nearest?.station.watercourseId != null) {
    watercourseSelect.value = String(nearest.station.watercourseId);
    showStations();
    stationSelect.value = nearest.station.code;
  } else if (spring) {
    box.querySelector<HTMLButtonElement>('[data-place="spring"]')!.click();
    springSelect.value = at(spring.geometry.coordinates[0], spring.geometry.coordinates[1]);
  }
}

const latLng = (value: string | undefined): LatLng | null => {
  if (!value) return null;
  const [lat, lng] = value.split(",").map(Number);
  return { lat, lng };
};
const chosenSpring = () => latLng(document.querySelector<HTMLSelectElement>("#f-spring:enabled")?.value);
const chosenWatercourse = () => latLng(document.querySelector<HTMLSelectElement>("#f-watercourse:enabled")?.selectedOptions[0]?.dataset.at);

/** The edit key lets this device modify or delete the reading later, without an account. */
function rememberEditKey(id: string, key: string): void {
  const keys = JSON.parse(storage.get(EDIT_KEYS) ?? "{}");
  keys[id] = key;
  storage.set(EDIT_KEYS, JSON.stringify(keys));
}
