import { describe, expect, it } from "vitest";
import data from "../../public/greenhouse/data.json";
import { ALL_KIND_IDS, ALL_MUTATION_IDS, allItemIds } from "../components/simulator/format";
import { RARITY_ORDER, rarityRank, sortByRarity } from "./rarity";

const rarityOf = (id: string) => (data.mutations as Record<string, { rarity: string }>)[id]?.rarity ?? null;

/** True when each rarity forms one contiguous run, in RARITY_ORDER. */
function isGrouped(ids: readonly string[]): boolean {
  const ranks = ids.map((id) => rarityRank(rarityOf(id)));
  return ranks.every((r, i) => i === 0 || ranks[i - 1] <= r);
}

describe("sortByRarity", () => {
  it("puts crops first, then common to legendary, keeping data order within a rarity", () => {
    const sorted = sortByRarity(Object.keys(data.mutations), rarityOf);
    expect(isGrouped(sorted)).toBe(true);
    expect(sorted.filter((id) => rarityOf(id) === "rare").at(-1)).toBe("turtlellini");
    expect(sorted.filter((id) => rarityOf(id) === "epic").at(-1)).toBe("zombud");
    expect(rarityRank(null)).toBeLessThan(rarityRank(RARITY_ORDER[0]));
  });

  it("data.json itself is out of rarity order, so lists must be sorted", () => {
    expect(isGrouped(Object.keys(data.mutations))).toBe(false);
  });

  it("the simulator's mutation pickers are grouped by rarity", () => {
    expect(isGrouped(ALL_MUTATION_IDS)).toBe(true);
    expect(isGrouped(ALL_KIND_IDS)).toBe(true);
    expect(isGrouped(allItemIds().filter((id) => id in data.crops || id in data.mutations))).toBe(true);
  });
});
