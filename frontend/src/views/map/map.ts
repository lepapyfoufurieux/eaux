import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchBasin, fetchSprings, fetchWatercourseLines } from "../../api";
import { FLOW, FLOW_LEVELS, UNKNOWN_COLOUR, flowColour } from "../../domain/flow";
import { groupForMap } from "../../domain/grouping";
import { headPieces, later, readingPieces, springLevels, stretchFinder, watercourseLevels, watercoursePieces } from "../../domain/mapLevels";
import { monthIndex } from "../../domain/months";
import { $, esc, formatDate } from "../../html";
import { type AppState, subscribe } from "../../state";
import type { Reading } from "../../types";
import { groupSheet, readingSheet } from "./sheets";

// Plan IGN tiles of the valley, downloaded by data/download_tiles.py up to this zoom; the map enlarges them above it.
const LOCAL_TILES = "/tiles/{z}/{x}/{y}.png";
const MAX_LOCAL_ZOOM = 17;
// The area shown, as in data/prepare_basin.py: the valley and its surroundings, nothing more.
const AREA = L.latLngBounds([42.83, 1.43], [42.93, 1.63]);
// Plan IGN from the Géoplateforme (free, no key, shows the small brooks well), for tiles missing locally.
const IGN_PLAN =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2" +
  "&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const TILE_RETRIES = 4;

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
// Spring heads ("Tête de cours d'eau") and the piece of watercourse each one starts: a photo there colours that piece.
let heads: ReturnType<typeof headPieces<(typeof springs.features)[number]>>;
// Each watercourse as its separate lines, for the photos with no station taken on one of them.
let riverPieces: { id: number; pieces: { lat: number; lng: number }[][] }[];
let stretchOf: ReturnType<typeof stretchFinder>;
const springAt = (f: (typeof springs.features)[number]) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
const geoLayer = L.layerGroup();
const readingLayer = L.layerGroup();

const levelText = (r: Reading | null | undefined) =>
  r ? `${FLOW[r.flowLevel].label}, le ${formatDate(r.takenAt)}` : "Pas de relevé sur la période";

export async function mountMap(): Promise<L.Map> {
  map = L.map("map", { zoomControl: false, maxZoom: 18, maxBounds: AREA, maxBoundsViscosity: 1 }).setView([42.875, 1.52], 13);
  // Zooming out stops once the whole area is in view.
  const fitMinZoom = () => map.getSize().x > 0 && map.setMinZoom(map.getBoundsZoom(AREA));
  fitMinZoom();
  map.on("resize", fitMinZoom);
  L.control.zoom({ position: "topright", zoomInTitle: "Zoomer", zoomOutTitle: "Dézoomer" }).addTo(map);
  L.control.scale({ position: "topright", imperial: false }).addTo(map);
  L.tileLayer(LOCAL_TILES, { bounds: AREA, maxNativeZoom: MAX_LOCAL_ZOOM, maxZoom: 18, attribution: "© IGN Plan IGN · relevés des habitants" })
    // A tile missing locally comes from the Géoplateforme. It sometimes answers with a passing 404 that the browser
    // caches, and Leaflet never retries, so each retry asks for a slightly different URL (the server ignores the parameter).
    .on("tileerror", ({ tile, coords }) => {
      const tries = Number(tile.dataset.tries ?? 0);
      if (tries >= TILE_RETRIES) return;
      tile.dataset.tries = String(tries + 1);
      const src = L.Util.template(IGN_PLAN, coords) + (tries ? `&retry=${tries}` : "");
      setTimeout(() => (tile.src = src), 1000 * tries);
    })
    .addTo(map);
  mountLegend();

  const [basin, riverLines, springPoints] = await Promise.all([fetchBasin(), fetchWatercourseLines(), fetchSprings()]);
  rivers = riverLines;
  springs = springPoints;
  riverPieces = watercoursePieces(rivers.features);
  stretchOf = stretchFinder(riverPieces);
  heads = headPieces(
    springs.features.filter((f) => f.properties.kind.startsWith("Tête de cours d'eau")),
    springAt,
    riverPieces,
  );
  // Veil everything outside the catchment, then draw its edge over a white halo so it reads on any tile.
  const outlines = basin.features.flatMap((f) => f.geometry.coordinates.map((polygon: number[][][]) => polygon[0].map(([lng, lat]) => [lat, lng])));
  const world = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
  if (outlines.length) L.polygon([world, ...outlines] as any, { interactive: false, className: "basin-mask" }).addTo(map);
  L.geoJSON(basin as any, { interactive: false, style: { className: "basin-halo" } }).addTo(map);
  const basinLayer = L.geoJSON(basin as any, { interactive: false, style: { className: "basin" } }).addTo(map);
  if (basin.features.length) map.fitBounds(basinLayer.getBounds(), { padding: [12, 12] });
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
  for (const { at, readings: group } of groupForMap(visible, state.stations)) {
    group.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
    const latest = group[group.length - 1];
    const marker = L.marker(at, {
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
  const springLevel = springLevels(visible, springs.features, springAt);
  const shown = { ...rivers, features: state.hideEmpty ? rivers.features.filter((f) => levels.has(f.properties.id)) : rivers.features };
  // A white casing under every watercourse lifts it off the tiles.
  L.geoJSON(shown as any, { interactive: false, style: { className: "river-halo" } }).addTo(geoLayer);
  // Leaflet sets the stroke as an SVG attribute, which ignores var(), so the colour goes through a class.
  L.geoJSON(shown as any, {
    style: (feature) => ({ className: `river ${levels.get(feature?.properties.id)?.flowLevel ?? "unknown"}` }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(esc(p.name), { sticky: true });
      layer.bindPopup(
        `<h3>${esc(p.name)}</h3><dl>${p.topage_code ? `<dt>Code BD TOPAGE</dt><dd>${esc(p.topage_code)}</dd>` : ""}<dt>Débit</dt><dd>${levelText(levels.get(p.id))}</dd></dl>`,
      );
    },
  }).addTo(geoLayer);
  // Pieces with their own photos (no station on them, or the spring head they start), over their watercourse,
  // with the latest of these and the watercourse's own reading.
  const pieces = readingPieces(visible, riverPieces);
  for (const [head, { id, piece }] of heads) {
    const reading = springLevel.get(head);
    if (reading) pieces.set(`${id}:${piece}`, { id, piece, reading: later(pieces.get(`${id}:${piece}`)?.reading, reading) });
  }
  // A photo colours its whole stretch, not just the line BD TOPAGE happened to cut there.
  const stretches = new Map<string, { id: number; piece: number; reading: Reading }>();
  for (const { id: from, piece: start, reading } of pieces.values()) {
    for (const { id, piece } of stretchOf(from, start)) {
      stretches.set(`${id}:${piece}`, { id, piece, reading: later(stretches.get(`${id}:${piece}`)?.reading, reading) });
    }
  }
  for (const { id, piece, reading } of stretches.values()) {
    const river = rivers.features.find((f) => f.properties.id === id);
    if (!river) continue;
    const level = later(levels.get(id), reading);
    const line = river.geometry.coordinates[piece].map(([lng, lat]: number[]) => [lat, lng]);
    L.polyline(line, { interactive: false, className: "river-halo" }).addTo(geoLayer);
    L.polyline(line, { className: `river ${level.flowLevel}` })
      .bindTooltip(esc(river.properties.name), { sticky: true })
      .bindPopup(`<h3>${esc(river.properties.name)}</h3><dl><dt>Débit</dt><dd>${levelText(level)}</dd></dl>`)
      .addTo(geoLayer);
  }
  const springsShown = state.hideEmpty ? springs.features.filter((f) => springLevel.has(f)) : springs.features;
  L.geoJSON({ ...springs, features: springsShown } as any, {
    pointToLayer: (feature, latlng) => {
      const reading = springLevel.get(feature as (typeof springs.features)[number]);
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
    // setContent detaches the clicked button; the map would then take the click for one outside the popup and close it.
    click.stopPropagation();
    index =(index + Number(step) + group.length) % group.length;
    popup.setContent(groupSheet(group, index));
  };
  marker.on("popupopen", () => popup.getElement()?.addEventListener("click", onClick));
  marker.on("popupclose", () => popup.getElement()?.removeEventListener("click", onClick));
}

function mountLegend(): void {
  // A <details> so it folds away; folded from the start on phones, where it would cover the map.
  const open = matchMedia("(min-width: 761px)").matches ? " open" : "";
  $("#legend").innerHTML =
    `<details${open}><summary>Légende</summary><ul>` +
    FLOW_LEVELS.map((k) => `<li><i style="--c:${FLOW[k].colour}"></i>${FLOW[k].label}</li>`).join("") +
    `<li><i style="--c:${UNKNOWN_COLOUR}"></i>Pas de relevé sur la période</li>` +
    `<li><i class="line"></i>Cours d'eau (BD TOPAGE)</li><li><i class="spring"></i>Source (IGN / OFB)</li><li><i class="basin"></i>Bassin versant du Saurat</li><li><i class="group">3</i>Photos au même endroit</li></ul></details>`;
}

/** Centre the map on a place, e.g. from the river view's "Voir sur la carte". */
export function focusOn(lat: number, lng: number): void {
  map.setView([lat, lng], 16);
}
