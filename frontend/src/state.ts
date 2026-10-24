import { type MonthIndex, monthRange } from "./domain/months";
import type { Reading, Station, Watercourse } from "./types";

/**
 * The one copy of the data that both views read. Views subscribe and redraw on change;
 * nothing else in the app keeps its own list of readings.
 */
export interface AppState {
  mode: "map" | "river";
  readings: Reading[];
  stations: Station[];
  watercourses: Watercourse[];
  /** Months shown on the map (time bar), inclusive. */
  range: [MonthIndex, MonthIndex];
  /** Month shown on the river plan, and the selected station there. */
  riverMonth: MonthIndex;
  selectedStation: string | null;
}

type Listener = (state: AppState) => void;

const listeners = new Set<Listener>();

export const state: AppState = {
  mode: "map",
  readings: [],
  stations: [],
  watercourses: [],
  range: monthRange([]),
  riverMonth: monthRange([])[1],
  selectedStation: null,
};

export function update(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener(state));
}

export function subscribe(listener: Listener): void {
  listeners.add(listener);
}

/** Full month span covered by the data, for the time bar and the river slider. */
export function dataSpan(): [MonthIndex, MonthIndex] {
  return monthRange(state.readings.map((r) => r.takenAt));
}

export function addReading(reading: Reading): void {
  update({ readings: [...state.readings, reading] });
}
