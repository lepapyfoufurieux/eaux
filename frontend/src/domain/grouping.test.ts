import { describe, expect, it } from "vitest";
import { groupByPlace, groupForMap } from "./grouping";

// 0.0001° of latitude is about 11 m.
const at = (dLat: number) => ({ lat: 42.87 + dLat * 0.0001, lng: 1.5 });

describe("groupByPlace", () => {
  it("groups points less than 50 m apart", () => {
    expect(groupByPlace([at(0), at(2), at(4)])).toHaveLength(1);
  });

  it("splits when the spread reaches 50 m, even if neighbours are close", () => {
    // 0 → 3 → 6: each step is 33 m but the ends are 67 m apart.
    const groups = groupByPlace([at(0), at(3), at(6)]);
    expect(groups.map((g) => g.length)).toEqual([2, 1]);
  });
});

describe("groupForMap", () => {
  const station = { code: "S01", lat: 42.87, lng: 1.5 };

  it("makes one pin per station, on the station, however far apart its photos are", () => {
    const pins = groupForMap([{ ...at(0), station: "S01" }, { ...at(8), station: "S01" }], [station]);
    expect(pins).toHaveLength(1);
    expect(pins[0].at).toEqual({ lat: 42.87, lng: 1.5 });
    expect(pins[0].readings).toHaveLength(2);
  });

  it("keeps the 50 m grouping for photos without a station", () => {
    const pins = groupForMap([{ ...at(0), station: null }, { ...at(2), station: null }, { ...at(0), station: "S01" }], [station]);
    expect(pins.map((p) => p.readings.length)).toEqual([1, 2]);
  });
});
