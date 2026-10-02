import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../config";
import { defaultGameData } from "../data/default";
import { seedRng } from "../rng";
import { engine, flow, layout, scenario, step, start } from "../testHelpers";
import { candidateMutations } from "./candidates";
import type { RingCounts } from "./eligibility";
import { effectiveWeight, fullWeightMultiplicity, multiplicity } from "./multiplicity";
import { applyMutationChanceBonus, buildPool, poolDenominator, rollPool, spawnProbability, type SpawnPool } from "./pool";

// Ported from SkyShards-API tests/test_spawn_weights.py, plus the assertions
// IMPLEMENTATION_TS §9.2 says the source suite does not pin.

const data = defaultGameData();
const M = data.mutations;
const ceiling = DEFAULT_CONFIG;
const support = { ...DEFAULT_CONFIG, weightModel: "support" as const };
/** A ring of plain requirement counts with no dried-out plants (so occupied iff any count > 0). */
const rc = (counts: Record<string, number>): RingCounts => ({ counts, ringOccupied: Object.values(counts).some((n) => n > 0) });
const pool = (entries: Record<string, number>): SpawnPool => ({ ids: Object.keys(entries), weights: Object.values(entries) });

describe("pool denominator", () => {
  it("floors at 100 and otherwise is the weight sum", () => {
    expect(poolDenominator([25], 100)).toBe(100);
    expect(poolDenominator([60, 75], 100)).toBe(135);
  });

  it("P(a) = 0.25 for {a:25, b:30}, not 25/55", () => {
    expect(spawnProbability(pool({ a: 25, b: 30 }), "a", 100)).toBe(0.25);
  });

  it("probabilities sum to 1 when saturated", () => {
    const p = pool({ a: 60, b: 75 });
    expect(spawnProbability(p, "a", 100)).toBeCloseTo(60 / 135);
    expect(spawnProbability(p, "a", 100) + spawnProbability(p, "b", 100)).toBeCloseTo(1);
  });

  it("dilution: a competitor lowers the target's chance once the pool is saturated", () => {
    expect(spawnProbability(pool({ a: 60, b: 75 }), "a", 100)).toBeLessThan(spawnProbability(pool({ a: 60 }), "a", 100));
  });

  it("property: probabilities at one location never exceed 1", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 8 }), (ws) => {
        const p: SpawnPool = { ids: ws.map((_, i) => `m${i}`), weights: ws };
        const total = p.ids.reduce((acc, id) => acc + spawnProbability(p, id, 100), 0);
        return total <= 1 + 1e-9;
      })
    );
  });
});

describe("one roll over the whole pool", () => {
  it("a lone weight-25 candidate spawns 25% of the time and blanks otherwise", () => {
    const rng = seedRng(7);
    const p = pool({ chloronite: 25 });
    let hits = 0;
    const n = 40_000;
    for (let i = 0; i < n; i++) if (rollPool(p, rng, 100)) hits++;
    expect(hits / n).toBeGreaterThan(0.24);
    expect(hits / n).toBeLessThan(0.26);
  });

  it("any candidate can win, in proportion to its weight", () => {
    const rng = seedRng(11);
    const p = pool({ a: 60, b: 75 });
    const wins: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i++) wins[rollPool(p, rng, 100)!]++;
    expect(wins.a / 20_000).toBeCloseTo(60 / 135, 1);
  });
});

describe("multiplicity", () => {
  it("is 1 for an eligible non-scaling mutation, however many extra sets surround it", () => {
    expect(multiplicity(M.gloomgourd, rc({ pumpkin: 1, melon: 1 }))).toBe(1);
    expect(multiplicity(M.gloomgourd, rc({ pumpkin: 2, melon: 2 }))).toBe(1);
    expect(multiplicity(M.gloomgourd, rc({ pumpkin: 4, melon: 4 }))).toBe(1);
    expect(multiplicity(M.gloomgourd, rc({ pumpkin: 1 }))).toBe(0);
  });

  it("Lonelily needs an empty ring", () => {
    expect(multiplicity(M.lonelily, rc({}))).toBe(1);
    expect(multiplicity(M.lonelily, rc({ wheat: 1 }))).toBe(0);
  });

  it("Lonelily reads plain occupancy: a ring holding only a dried-out plant (no counts) still blocks it", () => {
    expect(multiplicity(M.lonelily, { counts: {}, ringOccupied: true })).toBe(0);
    // ...while requirement-based mutations only see the counts.
    expect(multiplicity(M.dustgrain, { counts: { wheat: 1 }, ringOccupied: true })).toBe(0);
  });

  it("Godseed is ineligible by default and eligible only on the effect test", () => {
    expect(multiplicity(M.godseed, rc({}), undefined)).toBe(0);
    expect(multiplicity(M.godseed, rc({}), true)).toBe(1);
  });

  it("Ashwreath's fire is inert: 4 wart + 1 fire is not eligible, extra fire changes nothing", () => {
    expect(multiplicity(M.ashwreath, rc({ nether_wart: 4, fire: 1 }))).toBe(0);
    expect(multiplicity(M.ashwreath, rc({ nether_wart: 2, fire: 2 }))).toBe(1);
    expect(multiplicity(M.ashwreath, rc({ nether_wart: 2, fire: 5 }))).toBe(1);
  });

  it("Ashwreath weight scales 15 / 22.5 / 30 with 2 / 3 / 4 wart, and clamps", () => {
    expect(fullWeightMultiplicity(M.ashwreath)).toBe(3);
    expect(effectiveWeight(M.ashwreath, rc({ nether_wart: 2, fire: 2 }), ceiling)).toBe(15);
    expect(effectiveWeight(M.ashwreath, rc({ nether_wart: 3, fire: 2 }), ceiling)).toBe(22.5);
    expect(effectiveWeight(M.ashwreath, rc({ nether_wart: 4, fire: 2 }), ceiling)).toBe(30);
    expect(effectiveWeight(M.ashwreath, rc({ nether_wart: 6, fire: 2 }), ceiling)).toBe(30);
  });

  it("requirement counts are CELLS: a 3x3 Snoozling contributes 9", () => {
    // Puffercloud needs snoozling x2 - one 3x3 Snoozling touching the ring with 2+ cells satisfies it.
    expect(multiplicity(M.puffercloud, rc({ snoozling: 2, do_not_eat_shroom: 6 }))).toBe(1);
  });
});

describe("weight models (Q4)", () => {
  it("ceiling: a 2-crop mutation is at full weight once its requirements hold", () => {
    expect(effectiveWeight(M.gloomgourd, rc({ pumpkin: 1, melon: 1 }), ceiling)).toBe(30);
  });

  it("property (ceiling): extra matching cells never change a 2-crop mutation's weight", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), (p, m) => {
        return effectiveWeight(M.gloomgourd, rc({ pumpkin: p, melon: m }), ceiling) === 30;
      })
    );
  });

  it("support: 25% per matching cell, capped at full weight", () => {
    expect(effectiveWeight(M.gloomgourd, rc({ pumpkin: 1, melon: 1 }), support)).toBe(15);
    expect(effectiveWeight(M.gloomgourd, rc({ pumpkin: 2, melon: 2 }), support)).toBe(30);
    expect(effectiveWeight(M.ashwreath, rc({ nether_wart: 2, fire: 2 }), support)).toBe(15); // agrees with the staff example
    expect(effectiveWeight(M.lonelily, rc({}), support)).toBe(6);
  });
});

describe("Bioanalysis accessory (mutation chance bonus)", () => {
  it("scales the mutation arm by 1 + bonus while the pool is under the floor", () => {
    // Gloomgourd alone at a location: weight 30, so P(mutate) = 30/100.
    const base = buildPool([M.gloomgourd], rc({ pumpkin: 1, melon: 1 }), ceiling);
    expect(spawnProbability(base, "gloomgourd", 100)).toBe(0.3);
    expect(spawnProbability(applyMutationChanceBonus(base, 0.05), "gloomgourd", 100)).toBeCloseTo(0.315); // Talisman
    expect(spawnProbability(applyMutationChanceBonus(base, 0.1), "gloomgourd", 100)).toBeCloseTo(0.33); // Ring
    expect(spawnProbability(applyMutationChanceBonus(base, 0.15), "gloomgourd", 100)).toBeCloseTo(0.345); // Artifact
  });

  it("leaves the relative odds between mutations untouched", () => {
    const base = pool({ a: 30, b: 15 });
    const odds = (p: SpawnPool) => spawnProbability(p, "a", 100) / spawnProbability(p, "b", 100);
    expect(odds(applyMutationChanceBonus(base, 0.15))).toBeCloseTo(odds(base));
  });

  it("is a no-op at 0, and cannot push a saturated pool past 1", () => {
    const base = pool({ a: 60, b: 75 });
    expect(applyMutationChanceBonus(base, 0)).toBe(base);
    const boosted = applyMutationChanceBonus(base, 0.15);
    // Above the floor every roll already spawns something, so the scale cancels out.
    expect(spawnProbability(boosted, "a", 100)).toBeCloseTo(60 / 135);
    expect(boosted.ids.reduce((acc, id) => acc + spawnProbability(boosted, id, 100), 0)).toBeCloseTo(1);
  });

  it("property: under the floor P(mutate) grows by exactly the bonus", () => {
    const sum = (p: SpawnPool) => p.ids.reduce((acc, id) => acc + spawnProbability(p, id, 100), 0);
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 4 }),
        fc.constantFrom(0.05, 0.1, 0.15),
        (ws, bonus) => {
          const base: SpawnPool = { ids: ws.map((_, i) => `m${i}`), weights: ws };
          return Math.abs(sum(applyMutationChanceBonus(base, bonus)) - sum(base) * (1 + bonus)) < 1e-9;
        }
      )
    );
  });

  it("the engine reads the stat: a 15% bonus spawns strictly more over one run", () => {
    // One labelled slot is the only cell that rolls, so the spawn count is a
    // clean read on the pool's mutation arm. Fully grown spawns are harvested
    // each session (the defaults), which frees the slot again.
    const spec = layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]);
    const spawned = (bonus: number) => {
      const sc = scenario([flow([step("only", spec)])], {
        seed: 3,
        config: { spawnCells: "slotsOnly" },
        stats: { mutationChanceBonus: bonus },
      });
      return engine.run(start(sc), 3000).summary.spawned.gloomgourd ?? 0;
    };
    const base = spawned(0);
    const artifact = spawned(0.15);
    expect(base).toBeGreaterThan(100);
    expect(artifact).toBeGreaterThan(base);
    expect(artifact / base).toBeGreaterThan(1.05); // ~1.15, a generous band for one seed
    expect(artifact / base).toBeLessThan(1.3);
  });
});

describe("candidate mutations", () => {
  const names = (kinds: string[]) => candidateMutations(new Set(kinds), data).map((m) => m.id);

  it("{pumpkin, melon} -> gloomgourd and lonelily (plus godseed, decided per location by effects)", () => {
    expect(names(["pumpkin", "melon"])).toEqual(["gloomgourd", "lonelily", "godseed"]);
  });

  it("{wheat} -> dustgrain and lonelily", () => {
    expect(names(["wheat"])).toEqual(["dustgrain", "lonelily", "godseed"]);
  });

  it("Shellfruit and Jerryflower never appear", () => {
    const all = names([...data.cropIds, ...data.mutationIds]);
    expect(all).not.toContain("shellfruit");
    expect(all).not.toContain("jerryflower");
  });

  it("Lonelily never shares a location with a requirement-based target, so it cannot dilute one", () => {
    // Lonelily needs an EMPTY ring; any mutation with requirements needs a non-empty one.
    const p = buildPool([M.gloomgourd, M.lonelily], rc({ pumpkin: 1, melon: 1 }), ceiling);
    expect(p.ids).toEqual(["gloomgourd"]);
    expect(spawnProbability(p, "gloomgourd", 100)).toBe(0.3);
  });
});
