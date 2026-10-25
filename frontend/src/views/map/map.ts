import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchBasin, fetchSprings, fetchWatercourseLines } from "../../api";
import { FLOW, FLOW_LEVELS, UNKNOWN_COLOUR, flowColour } from "../../domain/flow";
import { centre, groupByPlace } from "../../domain/grouping";
import { springLevel, watercourseLevels } from "../../domain/mapLevels";
import { monthIndex } from "../../domain/months";
import { $, esc, formatDate } from "../../html";
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
let rivers: Awaited<ReturnType<typeof fetchWatercourseLines>>;
let springs: Awaited<ReturnType<typeof fetchSprings>>;
const geoLayer = L.layerGroup();
const readingLayer = L.layerGroup();

const levelText = (r: Reading | null | undefined) =>
  r ? `${FLOW[r.flowLevel].label}, le ${formatDate(r.takenAt)}` : "Pas de relevé sur la période";

export async function mountMap(): Promise<L.Map> {
  map = L.map("map", { zoomControl: false, minZoom: 11, maxZoom: 18 }).setView([42.875, 1.52], 13);
  L.control.zoom({ position: "topright", zoomInTitle: "Zoomer", zoomOutTitle: "Dézoomer" }).addTo(map);
  L.tileLayer(IGN_PLAN, { maxZoom: 18, attribution: "© IGN Géoplateforme · relevés des habitants" }).addTo(map);
  mountLegend();

  const [basin, riverLines, springPoints] = await Promise.all([fetchBasin(), fetchWatercourseLines(), fetchSprings()]);
  rivers = riverLines;
  springs = springPoints;
  // Veil everything outside the catchment, then draw its edge over a white halo so it reads on any tile.
  const outlines = basin.features.flatMap((f) => f.geometry.coordinates.map((polygon: number[][][]) => polygon[0].map(([lng, lat]) => [lat, lng])));
  const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
  if (outlines.length) L.polygon([world, ...outlines] as any, { interactive: false, className: "basin-mask" }).addTo(map);
  L.geoJSON(basin as any, { interactive: false, style: { className: "basin-halo" } }).addTo(map);
  const basinLayer = L.geoJSON(basin as any, { interactive: false, style: { className: "basin" } }).addTo(map);
  if (basin.features.length) map.fitBounds(basinLayer.getBounds(), { padding: [12, 12] });
  // A white casing under every watercourse lifts it off the tiles; it never changes, so it is drawn once.
  L.geoJSON(rivers as any, { interactive: false, style: { className: "river-halo" } }).addTo(map);
  geoLayer.addTo(map);
  readingLayer.addTo(map);

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
  renderWater(visible, state);
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

/** Watercourses and springs coloured by the latest reading of the period shown. */
function renderWater(visible: Reading[], state: AppState): void {
  geoLayer.clearLayers();
  const levels = watercourseLevels(visible, state.stations);
  // Leaflet sets the stroke as an SVG attribute, which ignores var(), so the colour goes through a class.
  L.geoJSON(rivers as any, {
    style: (feature) => ({ className: `river ${levels.get(feature?.properties.id)?.flowLevel ?? "unknown"}` }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(esc(p.name), { sticky: true });
      layer.bindPopup(
        `<h3>${esc(p.name)}</h3><dl>${p.topage_code ? `<dt>Code BD TOPAGE</dt><dd>${esc(p.topage_code)}</dd>` : ""}<dt>Débit</dt><dd>${levelText(levels.get(p.id))}</dd></dl>`,
      );
    },
  }).addTo(geoLayer);
  L.geoJSON(springs as any, {
    pointToLayer: (feature, latlng) => {
      const reading = springLevel(visible, latlng);
      return L.marker(latlng, {
        icon: L.divIcon({ className: "spring", html: `<span style="--c:${flowColour(reading?.flowLevel)}"></span>`, iconSize: [12, 12] }),
        title: `Source : ${levelText(reading)}`,
      }).bindPopup(
        `<h3>Source</h3><dl><dt>Type</dt><dd>${esc(feature.properties.kind)}</dd>${feature.properties.altitude_m ? `<dt>Altitude</dt><dd>${feature.properties.altitude_m} m</dd>` : ""}<dt>Origine</dt><dd>${esc(feature.properties.origin)}</dd><dt>Débit</dt><dd>${levelText(reading)}</dd></dl>`,
      );
    },
  }).addTo(geoLayer);
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
    `<li><i style="--c:${UNKNOWN_COLOUR}"></i>Pas de relevé sur la période</li>` +
    `<li><i class="line"></i>Cours d'eau (BD TOPAGE)</li><li><i class="spring"></i>Source (IGN / OFB)</li><li><i class="basin"></i>Bassin versant du Saurat</li><li><i class="group">3</i>Photos au même endroit</li></ul>`;
}

/** Centre the map on a place, e.g. from the river view's "Voir sur la carte". */
export function focusOn(lat: number, lng: number): void {
  map.setView([lat, lng], 16);
}
