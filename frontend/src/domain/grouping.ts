import type { LatLng } from "../types";
import { distanceM } from "./geo";

export const GROUP_MAX_SPREAD_M = 50;

/**
 * Group points whose largest pairwise distance stays under `maxSpreadM` (cahier des charges, 2.2).
 * Greedy: each point joins the first group it fits in entirely. Fine for a few thousand points.
 */
export function groupByPlace<T extends LatLng>(points: T[], maxSpreadM = GROUP_MAX_SPREAD_M): T[][] {
  const groups: T[][] = [];
  for (const point of points) {
    const group = groups.find((g) => g.every((other) => distanceM(point, other) < maxSpreadM));
    if (group) group.push(point);
    else groups.push([point]);
  }
  return groups;
}

export function centre(points: LatLng[]): LatLng {
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
  return { lat, lng };
}

/**
 * Map pins: one per station, on the station, holding every photo attached to it; photos with no
 * station keep the 50 m grouping. Two shots of one station from either bank then stay one pin.
 */
export function groupForMap<T extends LatLng & { station: string | null }>(
  readings: T[],
  stations: (LatLng & { code: string })[],
): { at: LatLng; readings: T[] }[] {
  const where = new Map(stations.map((s) => [s.code, { lat: s.lat, lng: s.lng }]));
  const byStation = new Map<string, T[]>();
  const loose: T[] = [];
  for (const r of readings) {
    if (r.station && where.has(r.station)) byStation.set(r.station, [...(byStation.get(r.station) ?? []), r]);
    else loose.push(r);
  }
  return [
    ...[...byStation].map(([code, group]) => ({ at: where.get(code)!, readings: group })),
    ...groupByPlace(loose).map((group) => ({ at: centre(group), readings: group })),
  ];
}
