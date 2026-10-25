import { describe, expect, it } from "vitest";
import type { Reading, Station } from "../types";
import { springLevel, watercourseLevels } from "./mapLevels";

const reading = (date: string, station: string | null, lat = 42.87): Reading => ({
  id: date,
  takenAt: new Date(date),
  flowLevel: "normal",
  comment: "",
  authorName: "Claire",
  station,
  lat,
  lng: 1.52,
  photo: "",
  thumbnail: "",
});

const station = (code: string, watercourseId: number | null): Station => ({
  code,
  name: code,
  watercourse: null,
  watercourseId,
  order: 0,
  lat: 0,
  lng: 0,
});

describe("watercourseLevels", () => {
  it("keeps the latest reading across the stations of each watercourse", () => {
    const stations = [station("S01", 1), station("S02", 1), station("S03", null)];
    const readings = [reading("2026-05-02", "S02"), reading("2026-05-01", "S01"), reading("2026-06-01", "S03"), reading("2026-07-01", null)];
    const levels = watercourseLevels(readings, stations);
    expect(levels.get(1)?.id).toBe("2026-05-02");
    expect(levels.size).toBe(1);
  });
});

describe("springLevel", () => {
  it("uses the latest reading within 400 m and ignores farther ones", () => {
    const readings = [reading("2026-05-01", null, 42.871), reading("2026-05-02", null, 42.872), reading("2026-06-01", null, 42.9)];
    expect(springLevel(readings, { lat: 42.87, lng: 1.52 })?.id).toBe("2026-05-02");
    expect(springLevel(readings, { lat: 43.5, lng: 1.52 })).toBeNull();
  });
});
