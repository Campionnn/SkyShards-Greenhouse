import { describe, expect, it } from "vitest";
import { armorRareCrops, overbloomMultiplier, rollRareCount } from "../economy/rareCrops";
import { npcPriceSource } from "../economy/prices";
import type { SimConfig } from "../config";
import { seedRng } from "../rng";
import { engine, flow, inject, layout, scenario, step, start } from "../testHelpers";
import type { PlayerStats, TimedEvent } from "./state";

const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);

/** Harvest one fully grown spawned plant (default Ashwreath, common, multiplier 0.15) with the given stats. */
function harvestOne(seed: number, stats: Partial<PlayerStats>, config: Partial<SimConfig> = {}, kindId = "ashwreath") {
  const s = start(scenario([flow([step("a", layout())])], { seed, config, stats }));
  const p = inject(s, 1, kindId, 5, 5, "spawned", { lockedEffects: [], fullyGrownAtCycle: 0 });
  p.stage = p.readyStage;
  const r = engine.run(s, 1);
  const h = ofKind(r.events, "harvested").find((e) => e.kindId === kindId);
  if (!h) throw new Error(`${kindId} was not harvested`);
  return { h, r };
}

describe("loot multipliers (August 20 patch) scale the armor Rare Crop chances", () => {
  it("data.json carries the patch-note multiplier of every harvestable crop and mutation", () => {
    const d = engine.data;
    expect(d.mutations.ashwreath.multiplier).toBe(0.15);
    expect(d.mutations.snoozling.multiplier).toBe(21);
    expect(d.mutations.stoplight_petal.multiplier).toBe(25);
    expect(d.mutations.all_in_aloe.multiplier).toBe(0.7);
    expect(d.crops.wheat.multiplier).toBe(0.18);
    expect(d.crops.red_mushroom.multiplier).toBe(0.08);
    expect(d.crops.brown_mushroom.multiplier).toBe(0.08);
    expect(d.crops.fire.multiplier).toBe(1); // never harvested: no multiplier in data.json
    for (const m of Object.values(d.mutations)) expect(m.multiplier, m.id).toBeGreaterThan(0);
  });

  it("Tater 4/4 at Overbloom 400: Ashwreath rolls Cropie at 0.15 x 20% x 5 = 15%, not 100%", () => {
    let cropies = 0;
    const n = 600;
    for (let seed = 1; seed <= n; seed++) cropies += harvestOne(seed, { armorSet: "tater", overbloom: 400 }).h.drops.cropie ?? 0;
    expect(cropies / n).toBeGreaterThan(0.11);
    expect(cropies / n).toBeLessThan(0.19);
  });

  it("a base crop uses its own multiplier: Wheat at 0.18 x 20% x 5 = 18% Cropie", () => {
    let cropies = 0;
    const n = 600;
    for (let seed = 1; seed <= n; seed++) {
      const s = start(scenario([flow([step("a", layout())])], { seed, stats: { armorSet: "tater", overbloom: 400 }, policies: { baseCropUpkeep: "harvestWhenGrown" } }));
      inject(s, 1, "wheat", 5, 5, "planted", { stage: 8, readyStage: 8, lockedEffects: [], fullyGrownAtCycle: 0 });
      const r = engine.run(s, 1);
      const h = ofKind(r.events, "harvested").find((e) => e.kindId === "wheat");
      expect(h).toBeDefined();
      cropies += h!.drops.cropie ?? 0;
    }
    expect(cropies / n).toBeGreaterThan(0.14);
    expect(cropies / n).toBeLessThan(0.22);
  });

  it("a big multiplier is capped at one item per roll by default: Stoplight Petal 25 x 20% = 500% gives exactly 1 Cropie", () => {
    for (let seed = 1; seed <= 50; seed++) expect(harvestOne(seed, { armorSet: "tater" }, {}, "stoplight_petal").h.drops.cropie).toBe(1);
  });

  it("uncapped (capRareCrops off): 500% gives 5 Cropie", () => {
    for (let seed = 1; seed <= 20; seed++) expect(harvestOne(seed, { armorSet: "tater" }, { capRareCrops: false }, "stoplight_petal").h.drops.cropie).toBe(5);
  });

  it("Ethereal Vine is not scaled by the multiplier: Snoozling (21, rare 25%) still drops a vine about 25% of the time", () => {
    let vines = 0;
    const n = 600;
    for (let seed = 1; seed <= n; seed++) vines += harvestOne(seed, {}, {}, "snoozling").h.drops.ethereal_vine ?? 0;
    expect(vines / n).toBeGreaterThan(0.2);
    expect(vines / n).toBeLessThan(0.3);
  });
});

describe("armor Rare Crops", () => {
  it("each set rolls its own drop; Fermento and Helianthus combine all tiers", () => {
    expect(armorRareCrops("none", false)).toEqual([]);
    expect(armorRareCrops("tater", false)).toEqual(["cropie"]);
    expect(armorRareCrops("cropie", false)).toEqual(["squash"]);
    expect(armorRareCrops("squash", false)).toEqual(["fermento"]);
    expect(armorRareCrops("helianthus", false)).toEqual(["cropie", "squash", "fermento", "helianthus"]);
    expect(armorRareCrops("helianthus", true)).toEqual(["fermento", "helianthus"]);
    expect(armorRareCrops("tater", true)).toEqual(["cropie"]);
  });

  it("Overbloom: chance x (1 + OB/100)", () => {
    expect(overbloomMultiplier(0)).toBe(1);
    expect(overbloomMultiplier(186)).toBeCloseTo(2.86);
  });

  it("uncapped chances above 100% give a guaranteed item plus a fractional roll; capped gives at most one", () => {
    const rng = seedRng(1);
    const counts = Array.from({ length: 2000 }, () => rollRareCount(rng, 1.75, false));
    expect(counts.every((n) => n === 1 || n === 2)).toBe(true);
    const twos = counts.filter((n) => n === 2).length / counts.length;
    expect(twos).toBeGreaterThan(0.7);
    expect(twos).toBeLessThan(0.8);
    expect(rollRareCount(rng, 1.75, true)).toBe(1);
    expect(rollRareCount(rng, 0, false)).toBe(0);
  });

  it("no armor and no Overbloom: only Ethereal Vine can appear as a Rare Crop", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { h } = harvestOne(seed, {});
      for (const item of ["cropie", "squash", "fermento", "helianthus"]) expect(h.drops[item]).toBeUndefined();
    }
  });

  it("Helianthus 4/4 at Overbloom 400 on Thornshade (multiplier 2) guarantees Cropie (20% x 2 x 5 = 200%, capped to 1) and books Rare Crop revenue", () => {
    let helianthus = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { h, r } = harvestOne(seed, { armorSet: "helianthus", overbloom: 400 }, { armorRareCropBug: false }, "thornshade");
      expect(h.drops.cropie).toBe(1);
      expect(h.drops.squash).toBe(1); // 12% x 2 x 5 = 120%: capped to one
      helianthus += h.drops.helianthus ?? 0;
      expect(r.summary.rareCrops.cropie).toBe(1);
      expect(r.summary.revenue.rareCrops).toBeGreaterThanOrEqual(25_000);
    }
    // 1.6% x 2 x 5 = 16% per harvest.
    expect(helianthus).toBeGreaterThan(18);
    expect(helianthus).toBeLessThan(48);
  });

  it("harvest yield does NOT scale the Ethereal Vine count (current game): a guaranteed vine at yield 1.5 always drops exactly 1", () => {
    // Common Ashwreath: Ethereal Vine 0.15 x Overbloom 600 (x7) = 105%, capped to a guaranteed vine by capRareCrops.
    const counts = Array.from({ length: 200 }, (_, i) =>
      harvestOne(i + 1, { overbloom: 600, plantYieldUpgrade: 0.5 }, { capRareCrops: true }).h.drops.ethereal_vine,
    );
    expect(counts.every((n) => n === 1)).toBe(true);
  });

  it("legacyMutationYield: harvest yield scales the Ethereal Vine count: a guaranteed vine at yield 1.5 gives 1, or 2 about half the time", () => {
    const counts = Array.from({ length: 400 }, (_, i) =>
      harvestOne(i + 1, { overbloom: 600, plantYieldUpgrade: 0.5 }, { capRareCrops: true, legacyMutationYield: true }).h.drops.ethereal_vine,
    );
    expect(counts.every((n) => n === 1 || n === 2)).toBe(true);
    const twos = counts.filter((n) => n === 2).length / counts.length;
    expect(twos).toBeGreaterThan(0.4);
    expect(twos).toBeLessThan(0.6);
  });

  it("harvest yield does NOT scale the armor set's Rare Crop count: a guaranteed Cropie at yield 1.5 always drops exactly 1", () => {
    // Thornshade (multiplier 2): Cropie 20% x 2 x Overbloom 150 (x2.5) = 100%.
    const counts = Array.from({ length: 200 }, (_, i) => harvestOne(i + 1, { armorSet: "tater", overbloom: 150, plantYieldUpgrade: 0.5 }, {}, "thornshade").h.drops.cropie);
    expect(counts.every((n) => n === 1)).toBe(true);
  });

  it("the armor bug (on by default) stops Cropie and Squash under Helianthus", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { h } = harvestOne(seed, { armorSet: "helianthus", overbloom: 400 });
      expect(h.drops.cropie).toBeUndefined();
      expect(h.drops.squash).toBeUndefined();
    }
  });

  it("Rare Crop revenue reconciles into profit", () => {
    const { r } = harvestOne(3, { armorSet: "helianthus", overbloom: 186 });
    const s = r.summary;
    expect(s.profit).toBe(s.revenue.crops + s.revenue.rareDrops + s.revenue.rareCrops + s.revenue.mutationItems - s.costs.replacements - s.costs.supplies);
  });
});

describe("NPC prices", () => {
  it("rare items use wiki NPC prices", () => {
    const p = npcPriceSource(engine.data);
    expect(p.price("helianthus")).toBe(500_000);
    expect(p.price("cropie")).toBe(25_000);
    expect(p.price("ethereal_vine")).toBe(20_000);
    expect(p.price("wheat")).toBe(2.5);
    expect(p.price("chloronite")).toBe(0);
  });
});

describe("adding items to a live run", () => {
  it("changes the inventory without moving time, is not produced or revenue, and never goes below 0", () => {
    const s = engine.run(start(scenario([flow([step("a", layout([["wheat", 0, 0]]))])])), 3).state;
    const next = engine.addItems(s, { chloronite: 5, fermento: -3 });
    expect(next.cycle).toBe(s.cycle);
    expect(next.inventory.chloronite).toBe(5);
    expect(next.inventory.fermento).toBe(0);
    expect(next.summary.injected.chloronite).toBe(5);
    expect(next.ledger.chloronite.produced).toBe(0);
    expect(next.summary.coinsRealised).toBe(s.summary.coinsRealised);
    expect(s.inventory.chloronite).toBeUndefined(); // pure
    // Continuing from the injected state is still deterministic.
    expect(JSON.stringify(engine.run(next, 5).state)).toBe(JSON.stringify(engine.run(next, 5).state));
  });
});
