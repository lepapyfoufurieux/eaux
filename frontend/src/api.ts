import type { FlowLevel } from "./domain/flow";
import type { LatLng, Reading, Station, Watercourse } from "./types";

type GeoJSON = { type: "FeatureCollection"; features: { geometry: any; properties: Record<string, any> }[] };

async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchReadings(): Promise<Reading[]> {
  const rows = await getJSON<any[]>("/api/readings");
  return rows.map((r) => ({
    id: r.id,
    takenAt: new Date(r.taken_at),
    flowLevel: r.flow_level,
    comment: r.comment,
    authorName: r.author_name,
    station: r.station,
    lat: r.lat,
    lng: r.lng,
    photo: r.photo,
    thumbnail: r.thumbnail,
  }));
}

export async function fetchStations(): Promise<Station[]> {
  const rows = await getJSON<any[]>("/api/stations");
  return rows.map((s) => ({
    code: s.code,
    name: s.name,
    watercourse: s.watercourse,
    watercourseId: s.watercourse_id,
    order: s.order,
    lat: s.lat,
    lng: s.lng,
  }));
}

export const fetchBasin = () => getJSON<GeoJSON>("/api/geo/basin");
export const fetchSprings = () => getJSON<GeoJSON>("/api/geo/springs");
export const fetchWatercourseLines = () => getJSON<GeoJSON>("/api/geo/watercourses");

export async function fetchWatercourses(): Promise<Watercourse[]> {
  const collection = await fetchWatercourseLines();
  return collection.features.map(({ properties: p }) => ({
    id: p.id,
    name: p.name,
    tributaryOf: p.tributary_of,
    confluencePosition: p.confluence_position,
  }));
}

export interface NewReading {
  photo: Blob;
  /** Null when the photo has no position; the station is then required. */
  position: LatLng | null;
  takenAt: Date;
  flowLevel: FlowLevel;
  authorName: string;
  comment: string;
  station?: string;
}

export interface Published {
  reading: Reading;
  stationDistanceM: number | null;
  editKey: string;
}

export async function publishReading(input: NewReading): Promise<Published> {
  const form = new FormData();
  form.append("photo", input.photo, "photo.jpg");
  if (input.position) {
    form.append("lat", String(input.position.lat));
    form.append("lng", String(input.position.lng));
  }
  form.append("taken_at", input.takenAt.toISOString());
  form.append("flow_level", input.flowLevel);
  form.append("author_name", input.authorName);
  form.append("comment", input.comment);
  if (input.station) form.append("station", input.station);

  const response = await fetch("/api/readings", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? "La publication a échoué. Réessayez plus tard.");
  const r = body.reading;
  return {
    reading: { ...r, takenAt: new Date(r.taken_at), flowLevel: r.flow_level, authorName: r.author_name },
    stationDistanceM: body.station_distance_m,
    editKey: body.edit_key,
  };
}

export function exportUrl(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  const query = params.toString();
  return `/api/readings.csv${query ? `?${query}` : ""}`;
}
