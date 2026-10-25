import { describe, expect, it } from "vitest";
import type { Station, Watercourse } from "../types";
import { layoutRiverPlan } from "./riverPlan";

const station = (code: string, watercourseId: number | null, order: number): Station => ({
  code,
  name: code,
  watercourse: null,
  watercourseId,
  order,
  lat: 0,
  lng: 0,
});

const watercourses: Watercourse[] = [
  { id: 1, name: "Le Saurat", tributaryOf: null, confluencePosition: null },
  { id: 2, name: "Rau de la Castelle", tributaryOf: 1, confluencePosition: 0.4 },
  { id: 3, name: "Rau du Haut", tributaryOf: 2, confluencePosition: null },
];

describe("layoutRiverPlan", () => {
  const layout = layoutRiverPlan(
    [station("S01", 1, 1), station("S02", 1, 2), station("S03", 2, 1), station("S04", 2, 2), station("S05", 3, 1), station("S09", null, 0)],
    watercourses,
  );

  it("puts the main river's stations on the trunk, upstream first", () => {
    expect(layout.trunk.name).toBe("Le Saurat");
    expect(layout.positions.S01.x).toBeLessThan(layout.positions.S02.x);
    expect(layout.positions.S01.onTrunk).toBe(true);
  });

  it("hangs a tributary's stations at its confluence, nearest first", () => {
    const [branch] = layout.branches;
    expect(branch.name).toBe("Rau de la Castelle");
    expect(branch.stations[0]).toBe("S04");
    expect(layout.positions.S03.x).toBe(branch.x);
  });

  it("folds sub-tributaries into their branch and reports stations it cannot place", () => {
    expect(layout.branches[0].stations).toContain("S05");
    expect(layout.unplaced).toEqual(["S09"]);
  });

  it("keeps branches whose confluences are close apart, alternating sides", () => {
    const close: Watercourse[] = [1, 2, 3].map((id) => ({ id: id + 10, name: `R${id}`, tributaryOf: 1, confluencePosition: 0.5 }));
    const plan = layoutRiverPlan([station("S01", 1, 1), station("S02", 1, 2), ...[1, 2, 3].map((id) => station(`B${id}`, id + 10, 1))], [watercourses[0], ...close]);
    const [a, b, c] = plan.branches;
    expect(a.direction).not.toBe(b.direction);
    expect(c.direction).toBe(a.direction);
    expect(c.x - a.x).toBeGreaterThanOrEqual(240);
  });
});
