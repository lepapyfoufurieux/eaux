import type { Reading } from "../types";
import { type MonthIndex, monthStart } from "./months";

/** A station's reading stays current for this many months, then the station shows as "no news". */
export const STATE_VALID_MONTHS = 2;

/**
 * The reading that describes a station at the end of `month`: its latest reading
 * taken before the end of that month and no earlier than the start of the previous one.
 */
export function stationStateAt(readings: Reading[], stationCode: string, month: MonthIndex): Reading | null {
  const end = monthStart(month + 1);
  const start = monthStart(month - (STATE_VALID_MONTHS - 1));
  let latest: Reading | null = null;
  for (const r of readings) {
    if (r.station !== stationCode || r.takenAt >= end) continue;
    if (!latest || r.takenAt > latest.takenAt) latest = r;
  }
  return latest && latest.takenAt >= start ? latest : null;
}

/** The latest reading of the station within the month itself, used by the monthly strip. */
export function readingInMonth(readings: Reading[], stationCode: string, month: MonthIndex): Reading | null {
  const start = monthStart(month);
  const end = monthStart(month + 1);
  let latest: Reading | null = null;
  for (const r of readings) {
    if (r.station === stationCode && r.takenAt >= start && r.takenAt < end && (!latest || r.takenAt > latest.takenAt)) {
      latest = r;
    }
  }
  return latest;
}
