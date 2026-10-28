import { openSignIn } from "../account/signIn";
import { fetchBasin, fetchMe, fetchSprings, fetchWatercourseLines, publishReading, saveName, signOut } from "../api";
import { FLOW, FLOW_LEVELS, type FlowLevel } from "../domain/flow";
import { distanceM, insideRing } from "../domain/geo";
import { $, esc, formatDate } from "../html";
import { addReading, state, update } from "../state";
import type { LatLng } from "../types";
import { compress } from "./compress";
import { readMetadata } from "./exif";

// Same value as STATION_ATTACH_RADIUS_M in backend/eds/settings.py.
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

// The sign-in link in the e-mail comes back to the site with ?connexion= (backend/accounts/api.py).
export const SIGN_IN_NOTICES: Record<string, string> = {
  ok: `<div class="msg ok">Vous êtes connecté : vous pouvez publier.</div>`,
  invalide: `<div class="msg error"><strong>Ce lien ne marche plus.</strong> Il a expiré ou a déjà servi : demandez-en un nouveau.</div>`,
  suspendu: `<div class="msg error"><strong>Ce compte est suspendu.</strong> Contactez l'association.</div>`,
};

/** The "Publier des photos" dialog (cahier des charges, 2.4). Only a signed-in account publishes. */
export function mountPublishForm(): void {
  $("#btn-publish").addEventListener("click", () => open());
  const signIn = new URLSearchParams(location.search).get("connexion");
  if (signIn) {
    history.replaceState(null, "", location.pathname + location.hash);
    open(SIGN_IN_NOTICES[signIn] ?? "");
  }
}

async function open(notice = ""): Promise<void> {
  const dialog = $<HTMLDialogElement>("#sheet");
  const me = await fetchMe().catch(() => null);
  if (!me) return openSignIn(dialog, "Publier une photo", "Pour publier, connectez-vous", notice, () => open(SIGN_IN_NOTICES.ok));
  dialog.innerHTML = `
    <form method="dialog" class="publish">
      <h2>Publier une photo</h2>
      <label class="drop">Choisir une photo<input type="file" accept="image/jpeg,image/*" id="f-photo" required></label>
      <div id="f-checks" class="checks" aria-live="polite"></div>
      <div id="f-station"></div>
      <label>Nom affiché sous vos photos<input type="text" id="f-name" autocomplete="given-name" maxlength="60" value="${esc(me.name)}" required>
        <small class="hint">Le changer renomme aussi vos photos déjà publiées.</small></label>
      <fieldset class="flows"><legend>Débit observé</legend>
        ${FLOW_LEVELS.map((k) => `<label style="--c:${FLOW[k].colour}"><input type="radio" name="flow" value="${k}" required>${FLOW[k].label}<small>${FLOW[k].hint}</small></label>`).join("")}
      </fieldset>
      <label>Commentaire (facultatif)<textarea id="f-comment" maxlength="2000" placeholder="Biodiversité, météo des derniers jours, aspect de l'eau…"></textarea></label>
      <div id="f-message" role="status">${notice}</div>
      <p>Connecté avec votre compte · <button type="button" class="link" id="f-sign-out">Se déconnecter</button></p>
      <div class="buttons">
        <button type="button" class="btn" value="cancel" id="f-cancel">Annuler</button>
        <button type="submit" class="btn primary" id="f-submit" disabled>Publier</button>
      </div>
    </form>`;
  if (!dialog.open) dialog.showModal();

  let pending: { photo: Blob; position: LatLng | null; takenAt: Date } | null = null;
  const checks = $("#f-checks");
  const message = $("#f-message");
  const submit = $<HTMLButtonElement>("#f-submit");
  const fail = (title: string, detail: string) => {
    message.innerHTML = `<div class="msg error"><strong>${title}</strong> ${detail}</div>`;
  };

  $("#f-cancel").addEventListener("click", () => dialog.close());
  $("#f-sign-out").addEventListener("click", async () => {
    await signOut().catch(() => undefined);
    dialog.close();
  });

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

    const station = dialog.querySelector<HTMLSelectElement>("#f-station-select:enabled")?.value || undefined;
    submit.disabled = true;
    try {
      // shortcut: readings already on screen keep the old name until the page reloads; fine while renames are rare.
      if (name !== me.name) me.name = (await saveName(name)).name;
      const result = await publishReading({
        ...pending,
        // Without GPS, a station stands for itself; a spring or a watercourse with no station lends its position.
        position: pending.position ?? chosenSpring() ?? (station ? null : chosenWatercourse()),
        flowLevel: flow,
        comment: $<HTMLTextAreaElement>("#f-comment").value,
        station,
      });
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

/** Where the photo was taken: its GPS position when it has one; otherwise the contributor picks the place. */
async function renderPlaceChoice(position: LatLng | null): Promise<void> {
  const box = $("#f-station");
  if (!position) {
    box.innerHTML = `<small>La photo ne contient pas sa position : indiquez où elle a été prise.</small><div id="f-place"></div>`;
    return renderPlacePicker();
  }
  const nearest = nearestStation(position);
  box.innerHTML = `<small>Position GPS de la photo utilisée. ${
    nearest ? `${esc(nearest.station.name)} est à ${Math.round(nearest.distance)} m.` : "Aucune station à moins de 400 m : la photo apparaîtra sur la carte seulement."
  }</small>`;
}

/**
 * On a watercourse (then a station on it) or at a spring, unnamed ones included; all required.
 * A spring, or a watercourse with no station, lends its own position to the photo (data-at).
 */
async function renderPlacePicker(): Promise<void> {
const [lines, springs] = await Promise.all([fetchWatercourseLines(), fetchSprings()]);
  // Watercourses have no number: those with stations follow their first station's, the others come after by name.
  const firstCode = (id: number) => state.stations.filter((s) => s.watercourseId === id).map((s) => s.code).sort(byCode)[0];
  const watercourses = lines.features
    .map(({ properties: p, geometry }) => {
      // shortcut: the middle vertex of the longest piece stands for the watercourse; fine for a map pin.
      // A watercourse with no line yet (geometry null) has no position to lend: only its stations can place the photo.
      const piece = geometry && [...geometry.coordinates].sort((a: number[][], b: number[][]) => b.length - a.length)[0];
      const label = p.name.startsWith("Cours d'eau sans nom") ? `${p.name} (${p.topage_code || `n° ${p.id}`})` : p.name;
      return { id: p.id as number, label, first: firstCode(p.id), at: piece ? at(...(piece[Math.floor(piece.length / 2)] as [number, number])) : "" };
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
}

const latLng = (value: string | undefined): LatLng | null => {
  if (!value) return null;
  const [lat, lng] = value.split(",").map(Number);
  return { lat, lng };
};
const chosenSpring = () => latLng(document.querySelector<HTMLSelectElement>("#f-spring:enabled")?.value);
const chosenWatercourse = () => latLng(document.querySelector<HTMLSelectElement>("#f-watercourse:enabled")?.selectedOptions[0]?.dataset.at);
