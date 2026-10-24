import { FLOW, flowColour } from "../../domain/flow";
import { monthLabel } from "../../domain/months";
import { stationStateAt } from "../../domain/stationState";
import { $, esc, formatDate } from "../../html";
import { type AppState, update } from "../../state";
import { focusOn } from "../map/map";

/** Side card for the selected station: current state, history and photos. */
export function renderStationCard(s: AppState): void {
  const card = $("#station-card");
  const station = s.stations.find((st) => st.code === s.selectedStation);
  if (!station) {
    card.innerHTML = `<p class="hint">Choisissez une station sur le plan.</p>`;
    return;
  }
  const readings = s.readings
    .filter((r) => r.station === station.code)
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
  const current = stationStateAt(s.readings, station.code, s.riverMonth);
  const latestNote = readings.find((r) => r.comment);

  card.innerHTML = `
    <h2>${esc(station.code)} · ${esc(station.name)}</h2>
    <div class="meta">${esc(station.watercourse ?? "")} · ${station.lat.toFixed(4)}, ${station.lng.toFixed(4)}</div>
    <div class="now" style="--c:${flowColour(current?.flowLevel)}">
      ${current ? FLOW[current.flowLevel].label : "Pas de relevé récent"}
      <small>${current ? `relevé du ${formatDate(current.takenAt)} par ${esc(current.authorName)}` : `aucun relevé dans les 2 mois avant fin ${monthLabel(s.riverMonth)}`}</small>
    </div>
    ${latestNote ? `<p class="note">Dernière note : <q>${esc(latestNote.comment)}</q> (${esc(latestNote.authorName)})</p>` : ""}
    <div class="thumbs">${readings
      .map((r) => `<a href="${r.photo}" target="_blank" rel="noopener" style="--c:${FLOW[r.flowLevel].colour}"><img src="${r.thumbnail}" alt="Photo du ${formatDate(r.takenAt)}"></a>`)
      .join("")}</div>
    <div class="card-actions">
      <button type="button" class="btn primary" data-action="publish">Publier une photo ici</button>
      <button type="button" class="btn" data-action="locate">Voir sur la carte</button>
    </div>`;

  card.querySelector('[data-action="publish"]')?.addEventListener("click", () => $("#btn-publish").click());
  card.querySelector('[data-action="locate"]')?.addEventListener("click", () => {
    update({ mode: "map" });
    focusOn(station.lat, station.lng);
  });
}
