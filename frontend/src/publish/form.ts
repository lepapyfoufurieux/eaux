import { fetchBasin, publishReading } from "../api";
import { FLOW, FLOW_LEVELS, type FlowLevel } from "../domain/flow";
import { distanceM, insideRing } from "../domain/geo";
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

  let pending: { photo: Blob; lat: number; lng: number; takenAt: Date } | null = null;
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
    if (meta === "no-position" || meta === "unreadable") {
      checks.textContent = "✕ Pas de position GPS dans la photo";
      return fail(
        "Cette photo ne contient pas sa position.",
        "Activez la localisation pour l'appareil photo, reprenez la photo, puis réessayez. Les photos envoyées par messagerie perdent souvent leur position.",
      );
    }
    if (!(await insideBasin(meta))) {
      checks.textContent = `✓ Position trouvée · ✕ Hors du bassin versant`;
      return fail("Cette photo a été prise hors du bassin versant.", "Seuls les cours d'eau du bassin versant de Saurat sont suivis.");
    }
    let photo: Blob;
    try {
      photo = await compress(file);
    } catch {
      return fail("Ce format d'image n'est pas pris en charge.", "Sur iPhone : Réglages › Appareil photo › Formats › « Le plus compatible ».");
    }
    checks.textContent = `✓ Position ${meta.lat.toFixed(5)}, ${meta.lng.toFixed(5)} · ✓ Prise le ${formatDate(meta.takenAt)} · ✓ ${Math.round(photo.size / 1024)} Ko`;
    renderStationChoice(meta);
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

    submit.disabled = true;
    try {
      const result = await publishReading({
        ...pending,
        flowLevel: flow,
        authorName: name,
        comment: $<HTMLTextAreaElement>("#f-comment").value,
        station: dialog.querySelector<HTMLSelectElement>("#f-station-select")?.value || undefined,
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

/** Show which station the photo will be attached to, and let the contributor pick another one. */
function renderStationChoice(point: LatLng): void {
  const nearest = nearestStation(point);
  const options = state.stations
    .map((s) => `<option value="${s.code}" ${nearest?.station.code === s.code ? "selected" : ""}>${esc(s.code)} · ${esc(s.name)}</option>`)
    .join("");
  $("#f-station").innerHTML = `<label>Station
    <select id="f-station-select"><option value="">Automatique (la plus proche)</option>${options}</select></label>
    <small>${nearest ? `${esc(nearest.station.name)} est à ${Math.round(nearest.distance)} m.` : "Aucune station à moins de 400 m : la photo apparaîtra sur la carte seulement."}</small>`;
}

/** The edit key lets this device modify or delete the reading later, without an account. */
function rememberEditKey(id: string, key: string): void {
  const keys = JSON.parse(storage.get(EDIT_KEYS) ?? "{}");
  keys[id] = key;
  storage.set(EDIT_KEYS, JSON.stringify(keys));
}
