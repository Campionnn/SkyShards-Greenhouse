import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { defaultGameData } from "../data/default";
import { cycleSeconds, effectiveUniqueCrops, uniqueCropYieldBonus, upgradeTerm } from "../growth/clock";
import { bestTool, FORTUNE_CROPS, fortuneCropOf, hasPerCropFortune, itemFortune, type FarmingToolStats } from "./fortune";
import { npcPriceSource, valueOf } from "./prices";
import { chloroniteDropCount, farmingFortuneMultiplier, greenhouseYieldSum, harvestYield, jellybeanMultiplier, yieldScaledCount } from "./yield";

const data = defaultGameData();
const prices = npcPriceSource(data);

describe("yield", () => {
  it("Farming Fortune 260 -> 3x guaranteed + 60% of a 4th = 3.6 expected (the page's own example)", () => {
    expect(farmingFortuneMultiplier(260)).toBeCloseTo(3.6);
    expect(farmingFortuneMultiplier(0)).toBe(1);
  });

  it("yield arithmetic (unique-crop cap of 10): melon 320 x 2.60 x 1.75 = 1456, with Evergreen +60% = 2329", () => {
    // A fixed FF multiplier (2.60) pins the product, floor and Evergreen arithmetic.
    const sum = greenhouseYieldSum(new Set(["improved_harvest_boost"]), 0.2, uniqueCropYieldBonus(12));
    expect(sum).toBeCloseTo(1.75);
    expect(harvestYield({ melon: 320 }, 2.6, sum, 0).melon).toBe(1456);
    expect(harvestYield({ melon: 320 }, 2.6, sum, 0.6).melon).toBe(2329);
  });

  it("Gloomgourd §5: bundle 34 pumpkin + 160 melon at x2.60 x1.86, Evergreen +60% applies to mutation bundles too", () => {
    const drops = harvestYield(data.mutations.gloomgourd.drops, 2.6, 1.86, 0.6);
    expect(drops).toEqual({ pumpkin: 263, melon: 1238 }); // 34*2.6*1.86*1.6=263.08 -> 263; 160*2.6*1.86*1.6=1238.02 -> 1238
    expect(valueOf(drops, prices)).toBe(263 * 10 + 1238 * 2);
  });

  it("improved harvest boost overrides the base one instead of stacking", () => {
    expect(greenhouseYieldSum(new Set(["harvest_boost", "improved_harvest_boost"]), 0, 0)).toBeCloseTo(1.3);
    expect(greenhouseYieldSum(new Set(["harvest_boost", "harvest_loss"]), 0, 0)).toBeCloseTo(1.0);
  });

  it("property: drops are monotonic in Farming Fortune", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1500 }), fc.integer({ min: 0, max: 300 }), (ff, extra) => {
        const a = harvestYield({ wheat: 72 }, farmingFortuneMultiplier(ff), 1.2, 0).wheat ?? 0;
        const b = harvestYield({ wheat: 72 }, farmingFortuneMultiplier(ff + extra), 1.2, 0).wheat ?? 0;
        return b >= a;
      })
    );
  });

  it("mutation items are NPC-only: worth 0; crops use sell_price; seeds 3", () => {
    expect(prices.price("chloronite")).toBe(0);
    expect(prices.price("pumpkin")).toBe(10);
    expect(prices.price("seeds")).toBe(3);
  });

  it("Chloronite item count follows the Mining Fortune ladder", () => {
    expect(chloroniteDropCount(100)).toBe(1);
    expect(chloroniteDropCount(500)).toBe(2);
    expect(chloroniteDropCount(2500)).toBe(4);
  });

  it("Magic Jellybean: +1 item per 12 stages from 12, capped at 10", () => {
    expect([11, 12, 24, 120].map((s) => jellybeanMultiplier(s))).toEqual([0, 1, 2, 10]);
  });

  it("yieldScaledCount: 1.86 total yield on a base-1 mutation (e.g. Ashwreath) -> guaranteed 1, 86% chance of a 2nd", () => {
    expect(yieldScaledCount(1, 1.86)).toEqual({ whole: 1, frac: expect.closeTo(0.86, 9) });
  });

  it("yieldScaledCount stacks on top of Chloronite's / Jellybean's own base count", () => {
    // Chloronite at 2000 MF (base 4) with 1.86 yield -> expected 7.44: guaranteed 7, 44% chance of an 8th.
    expect(yieldScaledCount(chloroniteDropCount(2000), 1.86)).toEqual({ whole: 7, frac: expect.closeTo(0.44, 9) });
    // Magic Jellybean base 2 (stage 24) with 1.86 yield -> expected 3.72: guaranteed 3, 72% chance of a 4th.
    expect(yieldScaledCount(jellybeanMultiplier(24), 1.86)).toEqual({ whole: 3, frac: expect.closeTo(0.72, 9) });
  });

  it("yieldScaledCount at yield 1 (no bonuses) reproduces the base count exactly, no roll", () => {
    expect(yieldScaledCount(1, 1)).toEqual({ whole: 1, frac: 0 });
    expect(yieldScaledCount(4, 1)).toEqual({ whole: 4, frac: 0 });
  });
});

describe("per-crop fortune", () => {
  const hoe: FarmingToolStats = { name: "Wheat Hoe", fortune: { wheat: 300, carrot: 50 } };
  const dicer: FarmingToolStats = { name: "Melon Dicer", fortune: { melon: 250, pumpkin: 250 } };
  const price = (item: string) => prices.price(item);

  it("fortuneCropOf maps mushrooms and seeds, keeps base crops, and returns null for anything else", () => {
    expect(fortuneCropOf("red_mushroom")).toBe("mushroom");
    expect(fortuneCropOf("brown_mushroom")).toBe("mushroom");
    expect(fortuneCropOf("seeds")).toBe("wheat");
    for (const c of FORTUNE_CROPS) if (c !== "mushroom") expect(fortuneCropOf(c)).toBe(c);
    expect(fortuneCropOf("mushroom")).toBe("mushroom");
    expect(fortuneCropOf("chloronite")).toBeNull();
    expect(fortuneCropOf("all_in_aloe_fragment")).toBeNull();
  });

  it("itemFortune = general + crop-specific + the tool's fortune on that crop; non-crops get the general value", () => {
    const stats = { farmingFortune: 1000, cropFortune: { wheat: 85, mushroom: 60 }, tools: [hoe] };
    expect(itemFortune(stats, "wheat", hoe)).toBe(1385);
    expect(itemFortune(stats, "seeds", hoe)).toBe(1385);
    expect(itemFortune(stats, "wheat", null)).toBe(1085);
    expect(itemFortune(stats, "red_mushroom", hoe)).toBe(1060);
    expect(itemFortune(stats, "carrot", hoe)).toBe(1050);
    expect(itemFortune(stats, "melon", dicer)).toBe(1250);
    expect(itemFortune(stats, "chloronite", hoe)).toBe(1000);
    expect(itemFortune({ farmingFortune: 500 }, "wheat", null)).toBe(500);
  });

  it("bestTool picks the tool adding the most coins for the bundle; ties keep the first; no tools -> null", () => {
    expect(bestTool({ wheat: 10 }, [dicer, hoe], price)).toBe(hoe);
    expect(bestTool({ pumpkin: 34, melon: 160 }, [hoe, dicer], price)).toBe(dicer);
    // No crop the tools cover: all-zero gain keeps the first listed tool.
    expect(bestTool({ cactus: 10 }, [dicer, hoe], price)).toBe(dicer);
    const twin = { ...hoe, name: "Twin" };
    expect(bestTool({ wheat: 10 }, [hoe, twin], price)).toBe(hoe);
    expect(bestTool({ wheat: 10 }, [], price)).toBeNull();
    expect(bestTool({ wheat: 10 }, undefined, price)).toBeNull();
  });

  it("bestTool weighs coins, not drop counts: few valuable drops beat many cheap ones", () => {
    const cheap: FarmingToolStats = { name: "cheap", fortune: { melon: 100 } }; // melon 2 coins
    const dear: FarmingToolStats = { name: "dear", fortune: { pumpkin: 100 } }; // pumpkin 10 coins
    expect(bestTool({ melon: 40, pumpkin: 10 }, [cheap, dear], price)).toBe(dear); // 40*2 = 80 < 10*10 = 100
  });

  it("hasPerCropFortune: only a non-zero crop value or a tool turns the per-crop path on", () => {
    expect(hasPerCropFortune({ farmingFortune: 100 })).toBe(false);
    expect(hasPerCropFortune({ farmingFortune: 100, cropFortune: {} })).toBe(false);
    expect(hasPerCropFortune({ farmingFortune: 100, cropFortune: { wheat: 0 } })).toBe(false);
    expect(hasPerCropFortune({ farmingFortune: 100, tools: [] })).toBe(false);
    expect(hasPerCropFortune({ farmingFortune: 100, cropFortune: { wheat: 5 } })).toBe(true);
    expect(hasPerCropFortune({ farmingFortune: 100, tools: [{ name: "x", fortune: {} }] })).toBe(true);
  });

  it("harvestYield with a per-item multiplier scales each item by its own fortune", () => {
    const stats = { farmingFortune: 100, cropFortune: { pumpkin: 100 } };
    const ff = (item: string) => farmingFortuneMultiplier(itemFortune(stats, item, null));
    // pumpkin: 34 x 3 x 1.5 = 153; melon: 160 x 2 x 1.5 = 480.
    expect(harvestYield({ pumpkin: 34, melon: 160 }, ff, 1.5, 0)).toEqual({ pumpkin: 153, melon: 480 });
  });

  it("harvestYield: a constant per-item function gives the number form's result on the reference bundle", () => {
    // Floating-point grouping differs between the two forms, so only pinned values are compared;
    // the engine keeps the number form whenever no per-crop term is set (sim/fortune.test.ts).
    const drops = data.mutations.gloomgourd.drops;
    expect(harvestYield(drops, () => 2.6, 1.86, 0.6)).toEqual(harvestYield(drops, 2.6, 1.86, 0.6));
  });
});

describe("growth stage clock", () => {
  it("upgrade tier 9 jumps to +50% (not 45%)", () => {
    expect(upgradeTerm(8)).toBeCloseTo(0.4);
    expect(upgradeTerm(9)).toBe(0.5);
  });

  it("the wiki formula at every maximum, unique crops capped at 10, gives ~6302 s", () => {
    expect(cycleSeconds({ cropGrowth: 210, speedAttribute: 10, growthUpgradeTier: 9 }, 12)).toBeCloseTo(
      14400 / (1 + 0.025 * 10 + 0.0025 * 210 + 0.001 * 10 + 0.5),
      0
    );
  });

  it("unique crops count 10 at most", () => {
    expect(cycleSeconds({ cropGrowth: 0, speedAttribute: 0, growthUpgradeTier: 0 }, 14)).toBeCloseTo(14400 / 1.25);
  });

  it("the yield bonus at the cap is 0.25 (10 x 2.5%)", () => {
    expect(uniqueCropYieldBonus(10)).toBeCloseTo(0.25);
    expect(uniqueCropYieldBonus(999)).toBeCloseTo(0.25); // clamped
  });
});

describe("Flora shard and effectiveUniqueCrops", () => {
  it("6 standing + Flora 4 = 10", () => {
    expect(effectiveUniqueCrops(6, 4)).toBe(10);
  });

  it("6 standing + Flora 10 caps at 10", () => {
    expect(effectiveUniqueCrops(6, 10)).toBe(10);
  });

  it("a missing Flora counts as 0", () => {
    expect(effectiveUniqueCrops(6, undefined)).toBe(6);
  });

  it("Flora 10 makes the cycle length independent of the base crops standing", () => {
    const stats = { cropGrowth: 0, speedAttribute: 0, growthUpgradeTier: 0 };
    const at0 = cycleSeconds(stats, effectiveUniqueCrops(0, 10));
    const at6 = cycleSeconds(stats, effectiveUniqueCrops(6, 10));
    const at12 = cycleSeconds(stats, effectiveUniqueCrops(12, 10));
    expect(at0).toBe(at6);
    expect(at6).toBe(at12);
  });
});
