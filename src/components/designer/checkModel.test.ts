import { describe, expect, it } from "vitest";
import type { DesignerPlacement, MutationValidationInfo } from "../../context";
import { at, buildRows, type TargetCheck } from "./checkModel";

const target = (id: string, cropId: string, row: number, col: number): DesignerPlacement => ({ id, cropId, cropName: cropId[0].toUpperCase() + cropId.slice(1), size: 1, position: [row, col], isMutation: true });
const ok: MutationValidationInfo = { isValid: true, missingRequirements: [], satisfiedRequirements: [], effectRequirements: [], ringBlocked: false };
const bad: MutationValidationInfo = { ...ok, isValid: false };
const check = (t: DesignerPlacement, v: MutationValidationInfo, short: string | null = null): TargetCheck => ({ target: t, v, short });

describe("checkModel", () => {
  it("says where a placement is, 1-based (like the grid's tooltip)", () => {
    expect(at({ position: [4, 5] })).toBe("row 5, col 6");
    expect(at({ position: [0, 0] })).toBe("row 1, col 1");
  });

  it("lists invalid targets one by one in grid order, then one row per valid mutation, most first", () => {
    const rows = buildRows([
      check(target("a", "choconut", 2, 2), ok),
      check(target("b", "noctilume", 6, 1), bad, "9 missing"),
      check(target("c", "gloomgourd", 1, 1), ok),
      check(target("d", "choconut", 2, 3), ok),
      check(target("e", "chocoberry", 4, 5), bad, "4 missing"),
    ]);
    expect(rows.map((r) => [r.name, r.valid, r.items.length, r.short])).toEqual([
      ["Chocoberry", false, 1, "4 missing"],
      ["Noctilume", false, 1, "9 missing"],
      ["Choconut", true, 2, null],
      ["Gloomgourd", true, 1, null],
    ]);
    // Invalid rows are keyed by the placement (one each); valid rows by the mutation (a group).
    expect(rows[0].key).toBe("e");
    expect(rows[2].key).toBe("valid:choconut");
  });

  it("has no rows without targets", () => {
    expect(buildRows([])).toEqual([]);
  });
});
