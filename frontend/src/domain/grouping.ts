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
