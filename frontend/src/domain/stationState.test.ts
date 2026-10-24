import { describe, expect, it } from "vitest";
import type { Reading } from "../types";
import { monthIndex } from "./months";
import { stationStateAt } from "./stationState";

const reading = (date: string, station = "S01"): Reading => ({
  id: date,
  takenAt: new Date(date),
  flowLevel: "normal",
  comment: "",
  authorName: "Claire",
  station,
  lat: 0,
  lng: 0,
  photo: "",
  thumbnail: "",
});

describe("stationStateAt", () => {
  const readings = [reading("2026-03-18T11:00"), reading("2026-05-24T10:00"), reading("2026-05-25T10:00", "S02")];

  it("uses the latest reading before the end of the month", () => {
    expect(stationStateAt(readings, "S01", monthIndex(new Date(2026, 5, 1)))?.id).toBe("2026-05-24T10:00");
  });

  it("ignores readings taken after the month", () => {
    expect(stationStateAt(readings, "S01", monthIndex(new Date(2026, 3, 1)))?.id).toBe("2026-03-18T11:00");
  });

  it("returns nothing once the latest reading is older than two months", () => {
    expect(stationStateAt(readings, "S01", monthIndex(new Date(2026, 6, 1)))).toBeNull();
  });
});
