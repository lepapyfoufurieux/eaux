import { FLOW } from "../../domain/flow";
import { esc, formatDate } from "../../html";
import { state } from "../../state";
import type { Reading } from "../../types";

/** Popup content for one reading (cahier des charges, 2.3 "Fiche Photo"). */
export function readingSheet(r: Reading): string {
  const station = state.stations.find((s) => s.code === r.station);
  return `<div class="sheet-reading">
    ${station ? `<div class="where">${esc(station.code)} · ${esc(station.name)}</div>` : ""}
    <div class="who">${esc(r.authorName)}</div>
    <div class="when">${formatDate(r.takenAt)}</div>
    <a class="photo" href="${r.photo}" target="_blank" rel="noopener"><img src="${r.thumbnail}" alt="Photo du cours d'eau, ${FLOW[r.flowLevel].label.toLowerCase()}"></a>
    <span class="chip" style="--c:${FLOW[r.flowLevel].colour}"><i></i>${FLOW[r.flowLevel].label}</span>
    ${r.comment ? `<p class="note">${esc(r.comment)}</p>` : ""}
  </div>`;
}

/** Popup content for a group of readings on the same spot, browsed one at a time ("Fiche Groupe"). */
export function groupSheet(group: Reading[], index: number): string {
  const dots = group.map((r, i) => `<b class="${i === index ? "on" : ""}" style="--c:${FLOW[r.flowLevel].colour}"></b>`).join("");
  return `<div class="sheet-group" data-index="${index}">
    <div class="track">
      <button type="button" class="nav" data-step="-1" aria-label="Photo précédente">‹</button>
      ${readingSheet(group[index])}
      <button type="button" class="nav" data-step="1" aria-label="Photo suivante">›</button>
    </div>
    <div class="count">${index + 1} / ${group.length} photos sur ce lieu</div>
    <div class="dots">${dots}</div>
  </div>`;
}
