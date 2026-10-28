import type { FlowLevel } from "./domain/flow";
import type { LatLng, Reading, Station, Watercourse } from "./types";

type GeoJSON = { type: "FeatureCollection"; features: { geometry: any; properties: Record<string, any> }[] };

async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

/** A reading as the API sends it (snake_case), as the app uses it. Used for the list and for a new reading. */
const toReading = (r: any): Reading => ({
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
});

export async function fetchReadings(): Promise<Reading[]> {
  return (await getJSON<any[]>("/api/readings")).map(toReading);
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
  comment: string;
  station?: string;
}

export interface Published {
  reading: Reading;
  stationDistanceM: number | null;
}

/** The signed-in account. */
export interface Me {
  /** Shown under the photos; empty until the contributor gives it. */
  name: string;
  email: string;
}

/** One of the signed-in account's readings; an admin may have hidden it. */
export interface MyReading extends Reading {
  hidden: boolean;
}

/** Django's CSRF token, set by GET /api/me; every write sends it back. */
const csrfToken = () => document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] ?? "";

async function write(url: string, method: string, body?: FormData | object): Promise<any> {
  const json = body !== undefined && !(body instanceof FormData);
  const response = await fetch(url, {
    method,
    headers: { "X-CSRFToken": csrfToken(), ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(body) : (body as FormData | undefined),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("Vous n'êtes plus connecté : fermez cette fenêtre et reconnectez-vous.");
  if (response.status === 429) throw new Error("Trop de demandes : réessayez dans une heure.");
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "La demande a échoué. Réessayez plus tard.");
  return data;
}

/** The signed-in account, or null. Also sets the CSRF cookie. */
export async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/api/me");
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`/api/me: ${response.status}`);
  return response.json();
}

export const requestSignInLink = (email: string): Promise<void> => write("/api/auth/link", "POST", { email });
export const signInWithCode = (email: string, code: string): Promise<void> => write("/api/auth/code", "POST", { email, code });
export const signOut = (): Promise<void> => write("/api/auth/logout", "POST");
/** Also renames the account's readings already published. */
export const saveName = (name: string): Promise<Me> => write("/api/me", "PATCH", { name });
/** Deletes the account and all its readings. */
export const deleteAccount = (): Promise<void> => write("/api/me", "DELETE");
export const deleteMyReading = (id: string): Promise<void> => write(`/api/me/readings/${encodeURIComponent(id)}`, "DELETE");

export async function fetchMyReadings(): Promise<MyReading[]> {
  return (await getJSON<any[]>("/api/me/readings")).map((r) => ({ ...toReading(r), hidden: r.status === "hidden" }));
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
  form.append("comment", input.comment);
  if (input.station) form.append("station", input.station);

  const body = await write("/api/readings", "POST", form);
  return { reading: toReading(body.reading), stationDistanceM: body.station_distance_m };
}

export function exportUrl(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  const query = params.toString();
  return `/api/readings.csv${query ? `?${query}` : ""}`;
}
