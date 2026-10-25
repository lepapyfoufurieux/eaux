import { describe, expect, it } from "vitest";
import { monthIndex } from "./domain/months";
import { addReading, state, update } from "./state";
import type { Reading } from "./types";

const reading = (date: string): Reading => ({
  id: date,
  takenAt: new Date(date),
  flowLevel: "normal",
  comment: "",
  authorName: "Claire",
  station: null,
  lat: 0,
  lng: 0,
  photo: "",
  thumbnail: "",
});

describe("addReading", () => {
  it("stretches the map's range to a reading published in a new month", () => {
    const october = monthIndex(new Date(2026, 9, 1));
    update({ readings: [], range: [october - 3, october] });
    addReading(reading("2026-11-02T10:00"));
    expect(state.range).toEqual([october - 3, october + 1]);
  });
});
