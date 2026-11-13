import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { recipeOf, requirementLayout, ringCells, ringSentence } from "./articleModel";

const data = JSON.parse(readFileSync("public/greenhouse/data.json", "utf8")) as GreenhouseDataJSON;
const sizeOf = (id: string) => data.mutations[id]?.size ?? data.crops[id]?.size ?? 1;
const layoutOf = (id: string) => requirementLayout(data, data.mutations[id].size, recipeOf(data, id).needs);

/** Ring cells of `id`'s picture filled by each ingredient: what the game counts. */
function ringCounts(id: string): Record<string, number> {
  const l = layoutOf(id);
  const t = l.target;
  const ring = new Set(ringCells(t.size).map((c) => `${c.row + t.row - 1},${c.col + t.col - 1}`));
  const counts: Record<string, number> = {};
  for (const c of l.ring) if (c.id) counts[c.id] = (counts[c.id] ?? 0) + 1;
  for (const b of l.bigs)
    for (let r = 0; r < b.size; r++) for (let c = 0; c < b.size; c++) if (ring.has(`${b.row + r},${b.col + c}`)) counts[b.id] = (counts[b.id] ?? 0) + 1;
  return counts;
}

describe("requirementLayout", () => {
  it("every recipe's picture fills exactly its counts of ring cells, inside a 10×10 greenhouse", () => {
    for (const [id, m] of Object.entries(data.mutations)) {
      if (!m.requirements.length) continue;
      const want = Object.fromEntries(m.requirements.map((r) => [r.crop, r.count]));
      expect(ringCounts(id), id).toEqual(want);
      const l = layoutOf(id);
      expect(l.rows <= 10 && l.cols <= 10, id).toBe(true);
    }
  });

  it("a multi-cell ingredient uses as few plants as cover its cells: Plantboy Advance needs 2 Snoozling", () => {
    expect(layoutOf("plantboy_advance").plants).toEqual({ snoozling: 2, thunderling: 6 });
    expect(layoutOf("puffercloud").plants.snoozling).toBe(1);
    expect(layoutOf("all_in_aloe").plants.plantboy_advance).toBe(1);
    for (const b of layoutOf("stoplight_petal").bigs) expect(b.size).toBe(sizeOf(b.id));
  });

  it("names plants and cells when they differ", () => {
    expect(recipeOf(data, "plantboy_advance").needs).toEqual([
      { id: "snoozling", count: 2, cells: 6 },
      { id: "thunderling", count: 6, cells: 6 },
    ]);
    expect(ringSentence(data, "plantboy_advance", recipeOf(data, "plantboy_advance").needs)).toBe(
      "PlantBoy Advance with 2 Snoozling covering 6 cells and 6 Thunderling around it",
    );
  });
});
