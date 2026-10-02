import { describe, expect, it } from "vitest";
import { armorRareCrops, overbloomMultiplier, rollRareCount } from "../economy/rareCrops";
import { npcPriceSource } from "../economy/prices";
import { seedRng } from "../rng";
import { engine, flow, inject, layout, scenario, step, start } from "../testHelpers";
import type { PlayerStats, TimedEvent } from "./state";

const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);

/** Harvest one fully grown spawned Ashwreath (common) with the given stats. */
function harvestOne(seed: number, stats: Partial<PlayerStats>, config: Record<string, unknown> = {}) {
  const s = start(scenario([flow([step("a", layout())])], { seed, config: { spawnCells: "slotsOnly", ...config }, stats }));
  inject(s, 1, "ashwreath", 5, 5, "spawned", { lockedEffects: [], fullyGrownAtCycle: 0 });
  const r = engine.run(s, 1);
  return { h: ofKind(r.events, "harvested").find((e) => e.kindId === "ashwreath")!, r };
}

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

  it("Helianthus 4/4 at Overbloom 400 guarantees Cropie (20% x 5 = 100%) on every harvest and books Rare Crop revenue", () => {
    let helianthus = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { h, r } = harvestOne(seed, { armorSet: "helianthus", overbloom: 400 });
      expect(h.drops.cropie).toBe(1);
      expect([undefined, 1]).toContain(h.drops.squash); // 12% x 5 = 60%: at most one
      helianthus += h.drops.helianthus ?? 0;
      expect(r.summary.rareCrops.cropie).toBe(1);
      expect(r.summary.revenue.rareCrops).toBeGreaterThanOrEqual(25_000);
    }
    // 1.6% x 5 = 8% per harvest.
    expect(helianthus).toBeGreaterThan(4);
    expect(helianthus).toBeLessThan(35);
  });

  it("harvest yield scales ONLY the Ethereal Vine count: a guaranteed vine at yield 1.5 gives 1, or 2 about half the time", () => {
    // Common Ashwreath: Ethereal Vine 0.15 x Overbloom 600 (x7) = 105%, capped to a guaranteed vine by capRareCropChance.
    const counts = Array.from({ length: 400 }, (_, i) =>
      harvestOne(i + 1, { overbloom: 600, plantYieldUpgrade: 0.5 }, { capRareCropChance: true }).h.drops.ethereal_vine,
    );
    expect(counts.every((n) => n === 1 || n === 2)).toBe(true);
    const twos = counts.filter((n) => n === 2).length / counts.length;
    expect(twos).toBeGreaterThan(0.4);
    expect(twos).toBeLessThan(0.6);
  });

  it("harvest yield does NOT scale the armor set's Rare Crop count: a guaranteed Cropie at yield 1.5 always drops exactly 1", () => {
    const counts = Array.from({ length: 200 }, (_, i) => harvestOne(i + 1, { armorSet: "tater", overbloom: 400, plantYieldUpgrade: 0.5 }).h.drops.cropie);
    expect(counts.every((n) => n === 1)).toBe(true);
  });

  it("the armor bug toggle stops Cropie and Squash under Helianthus", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { h } = harvestOne(seed, { armorSet: "helianthus", overbloom: 400 }, { armorRareCropBug: true });
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
  it("rare items default to wiki NPC prices; overrides win", () => {
    const p = npcPriceSource(engine.data);
    expect(p.price("helianthus")).toBe(275_000);
    expect(p.price("cropie")).toBe(25_000);
    expect(p.price("ethereal_vine")).toBe(20_000);
    expect(p.price("wheat")).toBe(6);
    expect(p.price("chloronite")).toBe(0);
    expect(npcPriceSource(engine.data, { helianthus: 1 }).price("helianthus")).toBe(1);
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
