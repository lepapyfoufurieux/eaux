import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchBasin, fetchSprings, fetchWatercourseLines } from "../../api";
import { FLOW, FLOW_LEVELS } from "../../domain/flow";
import { centre, groupByPlace } from "../../domain/grouping";
import { monthIndex } from "../../domain/months";
import { $, esc } from "../../html";
import { type AppState, subscribe } from "../../state";
import type { Reading } from "../../types";
import { groupSheet, readingSheet } from "./sheets";

// Plan IGN from the Géoplateforme: free, no key, shows the small brooks well.
const IGN_PLAN =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2" +
  "&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const pinIcon = (colour: string, count = 1) =>
  L.divIcon({
    className: count > 1 ? "pin group" : "pin",
    html: count > 1 ? `<span style="--c:${colour}">${count}</span>` : `<span style="--c:${colour}"></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

let map: L.Map;
const readingLayer = L.layerGroup();

export async function mountMap(): Promise<L.Map> {
  map = L.map("map", { zoomControl: false, minZoom: 11, maxZoom: 18 }).setView([42.875, 1.52], 13);
  L.control.zoom({ position: "topright", zoomInTitle: "Zoomer", zoomOutTitle: "Dézoomer" }).addTo(map);
  L.tileLayer(IGN_PLAN, { maxZoom: 18, attribution: "© IGN Géoplateforme · relevés des habitants" }).addTo(map);
  readingLayer.addTo(map);
  mountLegend();

  const [basin, rivers, springs] = await Promise.all([fetchBasin(), fetchWatercourseLines(), fetchSprings()]);
  const basinLayer = L.geoJSON(basin as any, { interactive: false, style: { className: "basin" } }).addTo(map);
  if (basin.features.length) map.fitBounds(basinLayer.getBounds(), { padding: [12, 12] });
  L.geoJSON(rivers as any, { interactive: false, style: { className: "river" } }).addTo(map);
  L.geoJSON(springs as any, {
    pointToLayer: (_feature, latlng) => L.marker(latlng, { icon: L.divIcon({ className: "spring", iconSize: [11, 11] }) }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(
        `<h3>Source</h3><dl><dt>Type</dt><dd>${esc(p.kind)}</dd>${p.altitude_m ? `<dt>Altitude</dt><dd>${p.altitude_m} m</dd>` : ""}<dt>Origine</dt><dd>${esc(p.origin)}</dd></dl>`,
      );
    },
  }).addTo(map);

  subscribe(render);
  return map;
}

function render(state: AppState): void {
  readingLayer.clearLayers();
  const [lo, hi] = state.range;
  const visible = state.readings.filter((r) => {
    const m = monthIndex(r.takenAt);
    return m >= lo && m <= hi;
  });
  for (const group of groupByPlace(visible)) {
    group.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const latest = group[group.length - 1];
    const marker = L.marker(centre(group), {
      icon: pinIcon(FLOW[latest.flowLevel].colour, group.length),
      title: group.length > 1 ? `${group.length} photos` : FLOW[latest.flowLevel].label,
    });
    if (group.length === 1) marker.bindPopup(readingSheet(latest), { maxWidth: 280 });
    else bindGroupPopup(marker, group);
    marker.addTo(readingLayer);
  }
}

function bindGroupPopup(marker: L.Marker, group: Reading[]): void {
  let index = group.length - 1;
  const popup = L.popup({ maxWidth: 300 }).setContent(groupSheet(group, index));
  marker.bindPopup(popup);
  const onClick = (click: Event) => {
    const step = (click.target as HTMLElement).closest<HTMLElement>("[data-step]")?.dataset.step;
    if (!step) return;
    index = (index + Number(step) + group.length) % group.length;
    popup.setContent(groupSheet(group, index));
  };
  marker.on("popupopen", () => popup.getElement()?.addEventListener("click", onClick));
  marker.on("popupclose", () => popup.getElement()?.removeEventListener("click", onClick));
}

function mountLegend(): void {
  $("#legend").innerHTML =
    `<h2>Débit observé</h2><ul>` +
    FLOW_LEVELS.map((k) => `<li><i style="--c:${FLOW[k].colour}"></i>${FLOW[k].label}</li>`).join("") +
    `<li><i class="spring"></i>Source (IGN / OFB)</li><li><i class="group">3</i>Photos au même endroit</li></ul>`;
}

/** Centre the map on a place, e.g. from the river view's "Voir sur la carte". */
export function focusOn(lat: number, lng: number): void {
  map.setView([lat, lng], 16);
}
