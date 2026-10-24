import { describe, expect, it } from "vitest";
import { groupByPlace } from "./grouping";

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
