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

/** Metres from a point to a polyline, on a local flat projection: fine at the scale of a valley. */
function distanceToLineM(p: LatLng, line: LatLng[]): number {
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay, bx, by] = [(line[i - 1].lng - p.lng) * kx, (line[i - 1].lat - p.lat) * ky, (line[i].lng - p.lng) * kx, (line[i].lat - p.lat) * ky];
    const [dx, dy] = [bx - ax, by - ay];
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/**
 * Latest reading of each piece of watercourse, from photos with no station taken on it: each one counts for
 * the nearest piece within SPRING_RADIUS_M. Keyed "watercourse id:piece index".
 */
export function readingPieces(readings: Reading[], watercourses: { id: number; pieces: LatLng[][] }[]): Map<string, { id: number; piece: number; reading: Reading }> {
  const result = new Map<string, { id: number; piece: number; reading: Reading }>();
  for (const r of readings) {
    if (r.station) continue;
    let best = SPRING_RADIUS_M;
    let found: { id: number; piece: number } | undefined;
    for (const w of watercourses) {
      w.pieces.forEach((line, piece) => {
        const d = distanceToLineM(r, line);
        if (d <= best) [best, found] = [d, { id: w.id, piece }];
      });
    }
    if (!found) continue;
    const key = `${found.id}:${found.piece}`;
    result.set(key, { ...found, reading: later(result.get(key)?.reading, r) });
  }
  return result;
}

/**
 * BD TOPAGE cuts a brook into lines even where nothing joins it, and sometimes carries it on under another
 * watercourse. Returns a finder for the stretch a line belongs to: the lines chained through ends shared by
 * exactly two lines, so a colour runs from one real junction (or source, or mouth) to the next.
 */
export function stretchFinder(watercourses: { id: number; pieces: LatLng[][] }[]): (id: number, piece: number) => { id: number; piece: number }[] {
  const key = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const ends = (line: LatLng[]) => [line[0], line[line.length - 1]];
  const touching = new Map<string, { id: number; piece: number }[]>();
  for (const w of watercourses) {
    w.pieces.forEach((line, piece) => {
      for (const end of ends(line)) touching.set(key(end), [...(touching.get(key(end)) ?? []), { id: w.id, piece }]);
    });
  }
  const piecesOf = new Map(watercourses.map((w) => [w.id, w.pieces]));
  return (id, piece) => {
    const seen = new Map([[`${id}:${piece}`, { id, piece }]]);
    const todo = [{ id, piece }];
    while (todo.length) {
      const current = todo.pop()!;
      for (const end of ends(piecesOf.get(current.id)![current.piece])) {
        const here = touching.get(key(end))!;
        const next = here.length === 2 ? here.find((t) => t.id !== current.id || t.piece !== current.piece) : undefined;
        if (next && !seen.has(`${next.id}:${next.piece}`)) {
          seen.set(`${next.id}:${next.piece}`, next);
          todo.push(next);
        }
      }
    }
    return [...seen.values()];
  };
}

/** Each watercourse as its separate lines (GeoJSON MultiLineString, [lng, lat] pairs) in LatLng. */
export function watercoursePieces(
  features: { geometry: { coordinates: number[][][] } | null; properties: Record<string, any> }[],
): { id: number; pieces: LatLng[][] }[] {
  return features.map((f) => ({
    id: f.properties.id,
    // A watercourse created by hand, or left empty by a data refresh, has no line (geometry null).
    pieces: (f.geometry?.coordinates ?? []).map((line) => line.map(([lng, lat]) => ({ lat, lng }))),
  }));
}
