import type { LatLng, Reading, Station } from "../types";
import { distanceM } from "./geo";

/** A spring takes the level of photos taken this close to it, the same radius that attaches a photo to a station. */
export const SPRING_RADIUS_M = 400;

const later = (a: Reading | undefined, b: Reading) => (!a || b.takenAt > a.takenAt ? b : a);

/** Latest reading of each watercourse, through the stations on it. */
export function watercourseLevels(readings: Reading[], stations: Station[]): Map<number, Reading> {
  const watercourseOf = new Map(stations.map((s) => [s.code, s.watercourseId]));
  const latest = new Map<number, Reading>();
  for (const r of readings) {
    const id = r.station ? watercourseOf.get(r.station) : null;
    if (id != null) latest.set(id, later(latest.get(id), r));
  }
  return latest;
}

/** Latest reading taken within SPRING_RADIUS_M of the spring, if any. */
export function springLevel(readings: Reading[], spring: LatLng): Reading | null {
  let latest: Reading | undefined;
  for (const r of readings) if (distanceM(r, spring) <= SPRING_RADIUS_M) latest = later(latest, r);
  return latest ?? null;
}
