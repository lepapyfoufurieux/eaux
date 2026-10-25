import type { LatLng, Reading, Station } from "../types";
import { distanceM } from "./geo";

/** A photo counts for a spring only this close, the same spread that groups photos on the map. */
export const SPRING_RADIUS_M = 50;

export const later = (a: Reading | undefined, b: Reading) => (!a || b.takenAt > a.takenAt ? b : a);

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

/**
 * Latest reading of each spring. A photo counts only for the spring nearest to it, within SPRING_RADIUS_M,
 * so one photo at a spring head does not colour its neighbours.
 */
export function springLevels<T>(readings: Reading[], springs: T[], at: (spring: T) => LatLng): Map<T, Reading> {
  const latest = new Map<T, Reading>();
  for (const r of readings) {
    let nearest: T | undefined;
    let best = SPRING_RADIUS_M;
    for (const spring of springs) {
      const d = distanceM(r, at(spring));
      if (d <= best) [nearest, best] = [spring, d];
    }
    if (nearest !== undefined) latest.set(nearest, later(latest.get(nearest), r));
  }
  return latest;
}

/**
 * The piece of watercourse each spring head starts: the line (of a multi-line watercourse) with an end within
 * SPRING_RADIUS_M of it. A piece, not the whole watercourse: BD TOPAGE bundles some unnamed brooks into one.
 */
export function headPieces<T>(heads: T[], at: (head: T) => LatLng, watercourses: { id: number; pieces: LatLng[][] }[]): Map<T, { id: number; piece: number }> {
  const result = new Map<T, { id: number; piece: number }>();
  for (const head of heads) {
    let best = SPRING_RADIUS_M;
    for (const w of watercourses) {
      w.pieces.forEach((line, piece) => {
        for (const end of [line[0], line[line.length - 1]]) {
          const d = distanceM(at(head), end);
          if (d <= best) {
            best = d;
            result.set(head, { id: w.id, piece });
          }
        }
      });
    }
  }
  return result;
}
