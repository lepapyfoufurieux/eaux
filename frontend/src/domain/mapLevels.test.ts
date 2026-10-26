import { describe, expect, it } from "vitest";
import type { Reading, Station } from "../types";
import { headPieces, readingPieces, springLevels, stretchFinder, watercoursePieces, watercourseLevels } from "./mapLevels";

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

describe("springLevels", () => {
  // 0.0001° of latitude is about 11 m.
  const spring = (lat: number) => ({ lat, lng: 1.52 });
  const at = (s: { lat: number; lng: number }) => s;

  it("uses the latest reading within 50 m and ignores farther ones", () => {
    const here = spring(42.87);
    const readings = [reading("2026-05-01", null, 42.8701), reading("2026-05-02", null, 42.8702), reading("2026-06-01", null, 42.871)];
    expect(springLevels(readings, [here], at).get(here)?.id).toBe("2026-05-02");
  });

  it("colours only the nearest spring, not its neighbours", () => {
    const [near, neighbour] = [spring(42.87), spring(42.8703)];
    const levels = springLevels([reading("2026-05-01", null, 42.87)], [neighbour, near], at);
    expect(levels.has(near)).toBe(true);
    expect(levels.has(neighbour)).toBe(false);
  });
});

describe("headPieces", () => {
  it("links a spring head to the line that ends next to it", () => {
    const head = { lat: 42.87, lng: 1.52 };
    const p = (lat: number) => ({ lat, lng: 1.52 });
    const watercourses = [
      { id: 1, pieces: [[p(42.86), p(42.865)], [p(42.8702), p(42.88)]] },
      { id: 2, pieces: [[p(42.8706), p(42.86)]] },
    ];
    expect(headPieces([head], (h) => h, watercourses).get(head)).toEqual({ id: 1, piece: 1 });
    expect(headPieces([p(42.9)], (h) => h, watercourses).size).toBe(0);
  });
});

describe("readingPieces", () => {
  it("gives a photo with no station to the piece of watercourse it was taken on", () => {
    // A west-east line through 42.87 N; the photo is about 11 m north of it, mid-way.
    const line = [{ lat: 42.87, lng: 1.5 }, { lat: 42.87, lng: 1.52 }];
    const far = [{ lat: 42.88, lng: 1.5 }, { lat: 42.88, lng: 1.52 }];
    const pieces = readingPieces([reading("2026-05-01", null, 42.8701)], [{ id: 7, pieces: [far, line] }]);
    expect([...pieces.values()].map(({ id, piece }) => ({ id, piece }))).toEqual([{ id: 7, piece: 1 }]);
    expect(readingPieces([reading("2026-05-01", "S01", 42.8701)], [{ id: 7, pieces: [line] }]).size).toBe(0);
  });
});

describe("stretchFinder", () => {
  it("chains lines up to a real junction, even under another watercourse", () => {
    const p = (lng: number) => ({ lat: 42.87, lng });
    const side = { lat: 42.88, lng: 1.52 };
    // 1.50 → 1.51 → 1.52 is one stretch, cut in two and carried on by watercourse 3; at 1.52 brook 2 joins.
    const stretch = stretchFinder([
      { id: 1, pieces: [[p(1.5), p(1.51)], [p(1.52), p(1.53)]] },
      { id: 3, pieces: [[p(1.51), p(1.52)]] },
      { id: 2, pieces: [[side, p(1.52)]] },
    ]);
    const ids = (id: number, piece: number) => stretch(id, piece).map((s) => `${s.id}:${s.piece}`).sort();
    expect(ids(1, 0)).toEqual(["1:0", "3:0"]);
    expect(ids(1, 1)).toEqual(["1:1"]);
  });
});

describe("watercoursePieces", () => {
  it("turns each line into LatLng and keeps a watercourse without a line, with no pieces", () => {
    const pieces = watercoursePieces([
      { geometry: { coordinates: [[[1.5, 42.87], [1.51, 42.88]]] }, properties: { id: 1 } },
      { geometry: null, properties: { id: 2 } },
    ]);
    expect(pieces).toEqual([
      { id: 1, pieces: [[{ lat: 42.87, lng: 1.5 }, { lat: 42.88, lng: 1.51 }]] },
      { id: 2, pieces: [] },
    ]);
  });
});
