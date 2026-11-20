import { describe, expect, it } from "vitest";
import { effectiveList } from "../effects/adapter";
import { FARMING_XP_PER_MULTIPLIER, harvestFarmingXp, harvestSowdust, SOWDUST_CROP_MULTIPLIER, xpEffectFactor } from "../economy/sowdust";
import { ALWAYS_SPAWN, engine, flow, layout, scenario, start, step } from "../testHelpers";
import type { PlayerStats, Scenario, TimedEvent } from "./state";

// Sowdust and Farming XP (economy/sowdust.ts), booked per harvest in sim/harvest.ts.

const harvests = (events: TimedEvent[]) => events.filter((e): e is Extract<TimedEvent, { kind: "harvested" }> => e.kind === "harvested");
const total = (rec: Record<string, number> | undefined) => Object.values(rec ?? {}).reduce((a, b) => a + b, 0);

describe("harvestSowdust (wiki Greenhouse formula)", () => {
  it("5 × round(base / (5 × multiplier)) × (1 + fortune / 100), per crop item", () => {
    // Wheat crop: 72 / 5 = 14.4 → 14 → 70.
    expect(harvestSowdust({ wheat: 72, seeds: 1 }, () => 0)).toEqual({ wheat: 70 });
    expect(harvestSowdust({ wheat: 72, seeds: 1 }, () => 100)).toEqual({ wheat: 140 });
    // Lonelily: potato 525/15 = 35 → 175; carrot 613/17.5 = 35.03 → 175; pumpkin 298/4.25 = 70.1 → 350.
    expect(harvestSowdust({ potato: 525, carrot: 613, pumpkin: 298 }, () => 0)).toEqual({ potato: 175, carrot: 175, pumpkin: 350 });
    // Per-item fortune.
    const s = harvestSowdust({ potato: 525, carrot: 613 }, (item) => (item === "potato" ? 300 : 50));
    expect(s.potato).toBeCloseTo(700);
    expect(s.carrot).toBeCloseTo(262.5);
  });

  it("rounds half up", () => {
    // 22.5 / 5 = 4.5 → 5 → 25.
    expect(harvestSowdust({ wheat: 22.5 }, () => 0)).toEqual({ wheat: 25 });
    expect(harvestSowdust({ wheat: 22.4 }, () => 0)).toEqual({ wheat: 20 });
  });

  it("seeds, rare crops, mutation items and zero counts give nothing; negative fortune counts as 0", () => {
    expect(harvestSowdust({ seeds: 100, cropie: 5, ashwreath: 1, wheat: 0 }, () => 0)).toEqual({});
    expect(harvestSowdust({ wheat: 2 }, () => 0)).toEqual({}); // 2 / 5 = 0.4 → 0
    expect(harvestSowdust({ wheat: 72 }, () => -50)).toEqual({ wheat: 70 });
  });

  it("covers the 14 greenhouse crop items", () => {
    expect(Object.keys(SOWDUST_CROP_MULTIPLIER).sort()).toEqual(
      ["brown_mushroom", "cactus", "carrot", "cocoa_beans", "melon", "moonflower", "nether_wart", "potato", "pumpkin", "red_mushroom", "sugar_cane", "sunflower", "wheat", "wild_rose"],
    );
  });

  it("every mutation's bundle at fortune 0 gives 400 × its loot multiplier, except where the per-item rounding bites", () => {
    // The wiki rounds per item, so small bundles drift from 400 × multiplier by up to 5 per item.
    const rounded: Record<string, number> = { scourroot: 70, shadevine: 100, witherbloom: 90, godseed: 3190 };
    for (const [id, def] of Object.entries(engine.data.mutations)) {
      const got = total(harvestSowdust(def.drops, () => 0));
      if (Object.keys(def.drops).length === 0) expect(got, id).toBe(0);
      else expect(got, id).toBeCloseTo(rounded[id] ?? 400 * def.multiplier, 6);
    }
  });
});

describe("Farming XP", () => {
  it("1600 × the loot multiplier (Wheat 288, Stoplight Petal 40,000)", () => {
    expect(FARMING_XP_PER_MULTIPLIER).toBe(1600);
    expect(harvestFarmingXp(engine.data.crops.wheat.multiplier, [], 0)).toBeCloseTo(288);
    expect(harvestFarmingXp(engine.data.mutations.stoplight_petal.multiplier, [], 0)).toBeCloseTo(40000);
  });

  it("XP effects: +20% / +30% (Improved replaces), −20% XP Loss, additive", () => {
    expect(xpEffectFactor([])).toBe(1);
    expect(xpEffectFactor(["xp_boost"])).toBeCloseTo(1.2);
    expect(xpEffectFactor(["improved_xp_boost"])).toBeCloseTo(1.3);
    expect(xpEffectFactor(["xp_boost", "improved_xp_boost"])).toBeCloseTo(1.3);
    expect(xpEffectFactor(["xp_loss"])).toBeCloseTo(0.8);
    expect(xpEffectFactor(["improved_xp_boost", "xp_loss"])).toBeCloseTo(1.1);
    expect(xpEffectFactor(new Set(["xp_boost", "xp_loss"]))).toBeCloseTo(1);
    expect(xpEffectFactor(["harvest_boost", "harvest_loss"])).toBe(1);
  });

  it("Immunity blocks XP Loss (effects arrive post-Immunity)", () => {
    expect(xpEffectFactor(effectiveList(["immunity", "xp_loss"]))).toBe(1);
    expect(xpEffectFactor(effectiveList(["immunity", "xp_loss", "xp_boost"]))).toBeCloseTo(1.2);
    expect(xpEffectFactor(effectiveList(["xp_loss"]))).toBeCloseTo(0.8);
  });

  it("Farming Wisdom × (1 + w/100); the bundle multiplier scales it; 0 bundle → 0", () => {
    expect(harvestFarmingXp(1, [], 50)).toBeCloseTo(2400);
    expect(harvestFarmingXp(1, [], undefined)).toBeCloseTo(1600);
    expect(harvestFarmingXp(1, [], -10)).toBeCloseTo(1600);
    expect(harvestFarmingXp(3, ["improved_xp_boost"], 100, 2)).toBeCloseTo(1600 * 3 * 2 * 1.3 * 2);
    expect(harvestFarmingXp(0.7, [], 0, 0)).toBe(0);
    expect(harvestFarmingXp(0, [], 0)).toBe(0);
  });
});

/** A wheat field with Dustgrain slots in the gaps (its bundle is wheat too), harvested when fully grown. */
function wheatField(stats: Partial<PlayerStats>, seed = 7): Scenario {
  const plants: [string, number, number][] = [];
  const slots: [string, number, number][] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) ((r + c) % 3 !== 0 ? plants : slots).push([(r + c) % 3 !== 0 ? "wheat" : "dustgrain", r, c]);
  return scenario([flow([step("a", layout(plants, slots))])], {
    seed,
    stats: { farmingFortune: 200, ...ALWAYS_SPAWN, ...stats },
    policies: { baseCropUpkeep: "harvestWhenGrown" },
  });
}

describe("Sowdust and Farming XP in a run", () => {
  const run = (sc: Scenario, cycles = 60) => engine.run(start(sc), cycles);

  it("a fresh state starts at zero", () => {
    const s = start(wheatField({}));
    expect(s.summary.sowdust).toEqual({});
    expect(s.summary.farmingXp).toBe(0);
  });

  it("accumulates per harvest: wheat 70 and Dustgrain 100 per bundle × (1 + FF/100)", () => {
    const r = run(wheatField({}));
    const wheat = r.summary.harvested.wheat ?? 0;
    const dust = r.summary.harvested.dustgrain ?? 0;
    expect(wheat).toBeGreaterThan(0);
    expect(dust).toBeGreaterThan(0);
    expect(Object.keys(r.summary.sowdust!)).toEqual(["wheat"]);
    expect(r.summary.sowdust!.wheat).toBeCloseTo((wheat * 70 + dust * 100) * 3, 6);
    expect(r.summary.farmingXp!).toBeGreaterThan(0);
  });

  it("per-crop fortune and the chosen tool scale Sowdust like the drops", () => {
    const plain = run(wheatField({}));
    const boosted = run(wheatField({ cropFortune: { wheat: 100 }, tools: [{ name: "Hoe", farmingFortune: 50, fortune: { wheat: 50 } }] }));
    expect(boosted.summary.harvested).toEqual(plain.summary.harvested);
    expect(boosted.summary.sowdust!.wheat).toBeCloseTo((plain.summary.sowdust!.wheat * (1 + 400 / 100)) / (1 + 200 / 100), 6);
  });

  it("Farming Wisdom scales XP only; nothing else in the run changes", () => {
    const plain = run(wheatField({}));
    const wise = run(wheatField({ farmingWisdom: 50 }));
    expect(wise.summary.farmingXp!).toBeCloseTo(plain.summary.farmingXp! * 1.5, 6);
    expect(JSON.stringify({ ...wise.summary, farmingXp: 0 })).toBe(JSON.stringify({ ...plain.summary, farmingXp: 0 }));
    expect(JSON.stringify(wise.events)).toBe(JSON.stringify(plain.events));
    expect(JSON.stringify(wise.state.inventory)).toBe(JSON.stringify(plain.state.inventory));
  });

  it("XP Loss from Nether Wart lowers the wheat's XP; a Potato's Immunity blocks it", () => {
    const xpOf = (withPotato: boolean) => {
      const plants: [string, number, number][] = [["wheat", 5, 5], ["nether_wart", 5, 6]];
      if (withPotato) plants.push(["potato", 5, 4]);
      const sc = scenario([flow([step("a", layout(plants))])], {
        config: { waterLossMin: 0, waterLossMax: 0 },
        policies: { baseCropUpkeep: "harvestWhenGrown" },
      });
      const r = engine.run(start(sc), 30);
      const hs = harvests(r.events);
      const wheatHarvests = hs.filter((h) => h.kindId === "wheat").length;
      expect(wheatHarvests).toBeGreaterThan(0);
      // Wart and potato hold only Harvest Boost from the wheat: plain XP.
      const others = hs.filter((h) => h.kindId !== "wheat").reduce((a, h) => a + 1600 * (h.kindId === "nether_wart" ? 0.09 : 0.125), 0);
      return { perWheat: (r.summary.farmingXp! - others) / wheatHarvests };
    };
    expect(xpOf(false).perWheat).toBeCloseTo(288 * 0.8, 6);
    expect(xpOf(true).perWheat).toBeCloseTo(288, 6);
  });

  it("an old state without the fields gets them on the next harvest", () => {
    const s = engine.run(start(wheatField({})), 5).state;
    delete s.summary.sowdust;
    delete s.summary.farmingXp;
    const r = engine.run(s, 30);
    expect(r.summary.sowdust!.wheat).toBeGreaterThan(0);
    expect(r.summary.farmingXp!).toBeGreaterThan(0);
  });

  it("stays deterministic and splittable: run(s,100) == run(run(s,50),50), for two seeds", () => {
    for (const seed of [3, 11]) {
      const s0 = start(wheatField({ farmingWisdom: 25, cropFortune: { wheat: 30 } }, seed));
      const whole = engine.run(s0, 100, { retainEvents: "none" }).state;
      const split = engine.run(engine.run(s0, 50, { retainEvents: "none" }).state, 50, { retainEvents: "none" }).state;
      expect(JSON.stringify(split)).toBe(JSON.stringify(whole));
      expect(whole.summary.farmingXp!).toBeGreaterThan(0);
      expect(JSON.stringify(engine.run(s0, 100, { retainEvents: "none" }).state)).toBe(JSON.stringify(whole));
    }
  });
});
