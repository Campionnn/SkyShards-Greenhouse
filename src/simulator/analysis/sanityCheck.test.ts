import { describe, expect, it } from "vitest";
import type { LayoutSpec } from "../flow/types";
import { seedRng } from "../rng";
import { recomputeEffects } from "../effects/adapter";
import { candidateMutations } from "../spawn/candidates";
import { applyMutationChanceBonus, buildPool, poolDenominator, spawnProbability, type SpawnPool } from "../spawn/pool";
import { locationOpenFor, ringCounts } from "../spawn/eligibility";
import { buildOccupancy } from "../sim/plants";
import type { SimulationState } from "../sim/state";
import { engine, flow, inject, layout, NEVER_ACTIVE, scenario, singlePlot, start, step } from "../testHelpers";
import { sanityCheck } from "./sanityCheck";

const data = engine.data;
const farm = (spec: LayoutSpec, ...cells: [number, number][]): LayoutSpec => ({
  ...spec,
  groundTiles: [...(spec.groundTiles ?? []), ...cells.map(([row, col]) => ({ ground: "farmland", row, col }))],
});
const block3x3 = (r: number, c: number): [number, number][] => Array.from({ length: 9 }, (_, i) => [r + Math.floor(i / 3), c + (i % 3)]);
const quiet = { activity: NEVER_ACTIVE };

const check = (s: SimulationState, row: number, col: number) => sanityCheck(s, data, 1, row, col);
const ids = (es: { mutationId: string }[]) => es.map((e) => e.mutationId);
const entry = (s: SimulationState, row: number, col: number, id: string) => check(s, row, col).entries.find((e) => e.mutationId === id)!;

describe("sanityCheck: what a cell offers", () => {
  it("a Gloomgourd ring (pumpkin + melon): Gloomgourd can spawn, at weight / floor", () => {
    const s = start(singlePlot(farm(layout([["pumpkin", 4, 3], ["melon", 4, 5]]), [4, 4]), quiet));
    const r = check(s, 4, 4);
    expect(r.occupied).toBeNull();
    expect(r.rolls).toBe(true);
    expect(ids(r.canSpawn)).toEqual(["gloomgourd"]);
    const g = r.canSpawn[0];
    expect(g.weight).toBe(30);
    expect(g.chance).toBeCloseTo(30 / 100, 12); // weights sum to 30 < blankFillTo 100
    expect(r.denominator).toBe(100);
    expect(r.anyChance).toBeCloseTo(0.3, 12);
    expect(g.requirements).toEqual([
      { crop: "pumpkin", needed: 1, have: 1, dry: 0 },
      { crop: "melon", needed: 1, have: 1, dry: 0 },
    ]);
    // Listed in data.json order, split without loss.
    const order = data.mutationIds.filter((id) => data.mutations[id].spawnWeight > 0);
    expect(ids(r.entries)).toEqual(order);
    expect(r.canSpawn.length + r.cannot.length).toBe(r.entries.length);
  });

  it("a missing requirement count is reported with what the ring has", () => {
    const s = start(singlePlot(farm(layout([["wheat", 4, 3]]), [4, 4]), quiet));
    const e = entry(s, 4, 4, "dustgrain");
    expect(e.canSpawn).toBe(false);
    expect(e.requirements).toEqual([{ crop: "wheat", needed: 2, have: 1, dry: 0 }]);
    expect(e.blockers[0]).toMatchObject({ kind: "requirement", crop: "wheat", needed: 2, have: 1 });
    expect(e.missingCount).toBe(1);
    // With two wheat it can.
    const two = start(singlePlot(farm(layout([["wheat", 4, 3], ["wheat", 4, 5]]), [4, 4]), quiet));
    expect(ids(check(two, 4, 4).canSpawn)).toContain("dustgrain");
  });

  it("a kind that isn't on the plot at all is outside the pool, and still explained", () => {
    const s = start(singlePlot(farm(layout([["wheat", 4, 3]]), [4, 4]), quiet));
    const e = entry(s, 4, 4, "gloomgourd");
    expect(e.pool).toBe("no");
    expect(e.canSpawn).toBe(false);
    expect(e.requirements.map((r) => [r.crop, r.have])).toEqual([["pumpkin", 0], ["melon", 0]]);
  });

  it("wrong ground lists the cells and the ground needed", () => {
    // Ashwreath needs soul sand; the cell is farmland. Two nether wart + two fire stand around it.
    const base = farm(layout([["nether_wart", 3, 4], ["nether_wart", 3, 5], ["fire", 4, 3], ["fire", 4, 5]]), [4, 4]);
    const s = start(singlePlot(base, quiet));
    const wrong = entry(s, 4, 4, "ashwreath");
    expect(wrong.canSpawn).toBe(false);
    expect(wrong.ground).toMatchObject({ needed: "soul_sand", ok: false, wrong: [{ row: 4, col: 4, have: "farmland" }] });
    expect(wrong.blockers[0]).toMatchObject({ kind: "ground", needed: "soul_sand" });
    expect(wrong.requirements.every((r) => r.have >= r.needed)).toBe(true);
    // Soul sand fixes it.
    const right = start(singlePlot({ ...layout([["nether_wart", 3, 4], ["nether_wart", 3, 5], ["fire", 4, 3], ["fire", 4, 5]]), groundTiles: [{ ground: "soul_sand", row: 4, col: 4 }] }, quiet));
    expect(entry(right, 4, 4, "ashwreath").canSpawn).toBe(true);
    // A change made in play (groundOverrides) wins over the painted ground.
    right.plots[0].groundOverrides["4,4"] = "end_stone";
    expect(entry(right, 4, 4, "ashwreath").ground.wrong).toEqual([{ row: 4, col: 4, have: "end_stone" }]);
  });

  it("a 2x2 that doesn't fit is out of bounds; one that is covered says what covers it", () => {
    const duskbloomRing: [string, number, number][] = [["moonflower", 8, 7], ["moonflower", 9, 7]];
    const s = start(singlePlot(farm(layout(duskbloomRing), [9, 9], [8, 8], [8, 9], [9, 8]), quiet));
    const edge = entry(s, 9, 9, "noctilume"); // 2x2 anchored at the bottom-right corner
    expect(edge.footprint).toBe("outOfBounds");
    expect(edge.blockers[0]).toEqual({ kind: "outOfBounds" });
    expect(edge.canSpawn).toBe(false);

    const covered = start(singlePlot(farm(layout([["wheat", 5, 5]]), [4, 4], [4, 5], [5, 4], [5, 5]), quiet));
    const e = entry(covered, 4, 4, "noctilume");
    expect(e.footprint).toBe("occupied");
    expect(e.blockedBy).toMatchObject([{ kindId: "wheat", row: 5, col: 5 }]);
    expect(e.blockers[0]).toMatchObject({ kind: "occupied" });
  });

  it("Lonelily is blocked by a dried-out neighbour (it is still there), and its ring is listed", () => {
    const s = start(singlePlot(farm(layout([["wheat", 4, 3]]), [4, 4]), quiet));
    expect(ids(check(s, 4, 4).canSpawn)).not.toContain("lonelily");
    const empty = start(singlePlot(farm(layout([["wheat", 0, 0]]), [4, 4]), quiet));
    expect(ids(check(empty, 4, 4).canSpawn)).toContain("lonelily");

    const dry = start(singlePlot(farm(layout([["wheat", 4, 3]]), [4, 4]), quiet));
    dry.plots[0].plants[0].water = dry.scenario.settings.config.haltWater;
    const e = entry(dry, 4, 4, "lonelily");
    expect(e.canSpawn).toBe(false);
    expect(e.blockers[0]).toMatchObject({ kind: "ringNotEmpty" });
    expect(e.ring).toMatchObject([{ kindId: "wheat", dry: true }]);
  });

  it("a dry wheat doesn't count toward Dustgrain", () => {
    const s = start(singlePlot(farm(layout([["wheat", 4, 3], ["wheat", 4, 5]]), [4, 4]), quiet));
    expect(entry(s, 4, 4, "dustgrain").canSpawn).toBe(true);
    s.plots[0].plants.find((p) => p.col === 5)!.water = s.scenario.settings.config.haltWater;
    const e = entry(s, 4, 4, "dustgrain");
    expect(e.canSpawn).toBe(false);
    expect(e.requirements).toEqual([{ crop: "wheat", needed: 2, have: 1, dry: 1 }]);
  });

  it("Godseed lists the effects the spot doesn't receive", () => {
    const s = start(singlePlot(farm(layout([["wheat", 0, 0]]), ...block3x3(4, 4)), quiet));
    const e = entry(s, 4, 4, "godseed");
    expect(e.canSpawn).toBe(false);
    expect(e.missingEffects).toEqual(data.specialEffectSets.godseed);
    expect(e.blockers[0]).toMatchObject({ kind: "missingEffects", effects: data.specialEffectSets.godseed });
    expect(ids(check(s, 4, 4).entries)).not.toContain("wheat"); // crops are never listed
  });

  it("a slot's target that is not otherwise a candidate is still evaluated", () => {
    // Chloronite's kinds (coalroot, thornshade) are not on the plot, so it is no coarse candidate.
    const s = start(singlePlot(layout([["wheat", 4, 3]], [["chloronite", 4, 4]]), quiet));
    const r = check(s, 4, 4);
    expect(r.slotTarget).toBe("chloronite");
    const e = r.entries.find((x) => x.mutationId === "chloronite")!;
    expect(e.pool).toBe("slotTarget");
    expect(e.canSpawn).toBe(false);
    expect(e.requirements.map((q) => [q.crop, q.have])).toEqual([["coalroot", 0], ["thornshade", 0]]);
    // A target that has no spawn weight at all (Shellfruit) is listed for its slot too.
    const shell = start(singlePlot(layout([], [["shellfruit", 4, 4]]), quiet));
    expect(ids(check(shell, 4, 4).entries)).toContain("shellfruit");
    expect(ids(check(start(singlePlot(farm(layout(), [4, 4]), quiet)), 4, 4).entries)).not.toContain("shellfruit");
  });

  it("an occupied cell reports its occupant and what could spawn once it is free", () => {
    const s = start(singlePlot(farm(layout([["pumpkin", 4, 3], ["melon", 4, 5], ["wheat", 4, 4]])), quiet));
    const r = check(s, 4, 4);
    expect(r.occupied).toMatchObject({ kindId: "wheat", row: 4, col: 4, dry: false });
    expect(ids(r.canSpawn)).toEqual(["gloomgourd"]); // computed with the wheat removed from occupancy
    // Not the occupant itself counted toward anything: a wheat-only ring has no Dustgrain.
    const t = start(singlePlot(farm(layout([["wheat", 4, 3], ["wheat", 4, 4]])), quiet));
    expect(entry(t, 4, 4, "dustgrain").requirements).toEqual([{ crop: "wheat", needed: 2, have: 1, dry: 0 }]);
    // Anchoring a 2x2 on a cell covered by a plant that began earlier: removes that plant too.
    const covered = start(singlePlot(farm(layout([["wheat", 5, 5]])), quiet));
    expect(check(covered, 5, 5).occupied?.kindId).toBe("wheat");
  });

  it("'slots only' spawn mode: a cell that isn't a slot doesn't roll at all", () => {
    const s = start(singlePlot(farm(layout([["pumpkin", 4, 3], ["melon", 4, 5]], [["gloomgourd", 0, 0]]), [4, 4]), { ...quiet, config: { spawnCells: "slotsOnly" } }));
    const off = check(s, 4, 4);
    expect(off.rolls).toBe(false);
    expect(off.noRollReason).toMatch(/slot/i);
    expect(check(s, 0, 0).rolls).toBe(true);
  });

  it("Bioanalysis scales the weights, as the spawn roll does", () => {
    const sc = singlePlot(farm(layout([["pumpkin", 4, 3], ["melon", 4, 5]]), [4, 4]), { ...quiet, stats: { mutationChanceBonus: 0.15 } });
    const g = entry(start(sc), 4, 4, "gloomgourd");
    expect(g.weight).toBeCloseTo(30 * 1.15, 12);
    expect(g.chance).toBeCloseTo((30 * 1.15) / 100, 12);
  });

  it("the denominator is the weight sum once it passes the floor", () => {
    const sc = singlePlot(farm(layout([["pumpkin", 4, 3], ["melon", 4, 5]]), [4, 4]), { ...quiet, config: { blankFillTo: 10 } });
    const r = check(start(sc), 4, 4);
    expect(r.denominator).toBe(30);
    expect(r.canSpawn[0].chance).toBe(1);
    expect(r.anyChance).toBe(1);
  });

  it("throws for an unknown plot or an off-plot cell", () => {
    const s = start(singlePlot(layout(), quiet));
    expect(() => sanityCheck(s, data, 9, 0, 0)).toThrow(RangeError);
    expect(() => sanityCheck(s, data, 1, 10, 0)).toThrow(RangeError);
  });
});

describe("sanityCheck is read-only", () => {
  it("does not change the state (no effects written, no RNG drawn)", () => {
    const s = start(singlePlot(farm(layout([["pumpkin", 4, 3], ["melon", 4, 5], ["wheat", 4, 4], ["wheat", 0, 0]], [["godseed", 7, 7]]), [5, 5]), quiet));
    const before = JSON.stringify(s);
    for (const [r, c] of [[4, 4], [5, 5], [7, 7], [9, 9], [0, 1]]) check(s, r, c);
    expect(JSON.stringify(s)).toBe(before);
    // Also after some run: held effects are not recomputed on the live plants.
    const ran = engine.run(s, 3).state;
    const ranBefore = JSON.stringify(ran);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) check(ran, r, c);
    expect(JSON.stringify(ran)).toBe(ranBefore);
  });

  it("does not change the result of the run that follows it", () => {
    const s = start(singlePlot(farm(layout([["pumpkin", 4, 3], ["melon", 4, 5]], [["gloomgourd", 4, 4]])), quiet));
    const plain = JSON.stringify(engine.run(s, 5).state);
    check(s, 4, 4);
    expect(JSON.stringify(engine.run(s, 5).state)).toBe(plain);
  });
});

/**
 * The key property: the check agrees with what the spawn roll does. Slots-only
 * mode with the checked cell as the only slot means that cell is the only one
 * rolling, and a floor of 1 means the roll always lands on a pool member.
 */
describe("sanityCheck agrees with phaseSpawn", () => {
  const cases: { name: string; spec: LayoutSpec; row: number; col: number; extra?: (s: SimulationState) => void }[] = [
    { name: "gloomgourd ring", spec: layout([["pumpkin", 4, 3], ["melon", 4, 5], ["wheat", 0, 0]], [["gloomgourd", 4, 4]]), row: 4, col: 4 },
    { name: "two of everything common", spec: layout([["pumpkin", 4, 3], ["melon", 4, 5], ["potato", 3, 4], ["carrot", 5, 4], ["wheat", 3, 3], ["wheat", 5, 5]], [["gloomgourd", 4, 4]]), row: 4, col: 4 },
    { name: "a rival: slot target is dustgrain but gloomgourd is also eligible", spec: layout([["pumpkin", 4, 3], ["melon", 4, 5], ["wheat", 3, 4], ["wheat", 5, 4]], [["dustgrain", 4, 4]]), row: 4, col: 4 },
    { name: "unmet slot target", spec: layout([["wheat", 4, 3]], [["chloronite", 4, 4]]), row: 4, col: 4 },
    { name: "lonelily in an empty ring", spec: layout([["wheat", 0, 0]], [["lonelily", 5, 5]]), row: 5, col: 5 },
    {
      name: "lonelily blocked by a dry neighbour",
      spec: layout([["wheat", 4, 3]], [["lonelily", 4, 4]]),
      row: 4,
      col: 4,
      extra: (s) => {
        s.plots[0].plants[0].water = s.scenario.settings.config.haltWater;
      },
    },
    {
      name: "dry wheat not counting toward dustgrain",
      spec: layout([["wheat", 4, 3], ["wheat", 4, 5]], [["dustgrain", 4, 4]]),
      row: 4,
      col: 4,
      extra: (s) => {
        s.plots[0].plants[1].water = s.scenario.settings.config.haltWater;
      },
    },
    { name: "a 3x3 target (godseed) that is short of effects", spec: layout([["wheat", 0, 0]], [["godseed", 4, 4]]), row: 4, col: 4 },
  ];

  for (const { name, spec, row, col, extra } of cases) {
    it(name, () => {
      // Bioanalysis on, to prove the same scaling is used by both.
      const s = start(
        singlePlot(spec, { ...quiet, config: { spawnCells: "slotsOnly", blankFillTo: 1 }, stats: { mutationChanceBonus: 0.1 } })
      );
      extra?.(s);
      const r = check(s, row, col);

      // 1. Against the engine's own pool builder (spawn/pool.ts) fed by the engine's own ring counts and openness test.
      const plot = structuredClone(s.plots[0]);
      const occ = buildOccupancy(plot);
      const effects = recomputeEffects(plot, s.scenario.settings.config);
      const candidates = candidateMutations(new Set(plot.plants.map((p) => p.kindId)), data);
      const target = plot.slots.find((x) => x.row === row && x.col === col);
      const members = target && !candidates.includes(data.mutations[target.mutationId]) ? [...candidates, data.mutations[target.mutationId]] : candidates;
      const enginePool: SpawnPool = { ids: [], weights: [] };
      for (const m of members) {
        if (!locationOpenFor(plot, occ, row, col, m)) continue;
        const one = buildPool([m], ringCounts(occ, row, col, m.size, s.scenario.settings.config), s.scenario.settings.config, (x) =>
          x.special === "all_positive_crop_effects" ? effects.isSpecialEligible(x.id, [row, col], x.size) : false
        );
        enginePool.ids.push(...one.ids);
        enginePool.weights.push(...one.weights);
      }
      const boosted = applyMutationChanceBonus(enginePool, s.scenario.settings.playerStats.mutationChanceBonus);
      expect(ids(r.canSpawn)).toEqual(boosted.ids);
      const denominator = poolDenominator(boosted.weights, s.scenario.settings.config.blankFillTo);
      expect(r.denominator).toBeCloseTo(denominator, 9);
      r.canSpawn.forEach((e, i) => {
        expect(e.weight).toBeCloseTo(boosted.weights[i], 9);
        expect(e.chance).toBeCloseTo(spawnProbability(boosted, e.mutationId, s.scenario.settings.config.blankFillTo), 12);
      });
      for (const e of r.cannot) expect(e.chance).toBe(0);

      // 2. Against real spawn rolls: whatever the roll lands on is something the check said can spawn.
      const allowed = new Set(ids(r.canSpawn));
      const tally: Record<string, number> = {};
      const N = 150;
      for (let seed = 1; seed <= N; seed++) {
        const t = structuredClone(s);
        t.rng = seedRng(seed);
        const out = engine.run(t, 1).state;
        const spawned = out.plots[0].plants.filter((p) => p.origin === "spawned" && p.row === row && p.col === col);
        if (allowed.size === 0) {
          expect(spawned).toEqual([]);
          continue;
        }
        // The floor is 1 and the weights sum to more, so every roll spawns something.
        expect(spawned).toHaveLength(1);
        expect(allowed.has(spawned[0].kindId)).toBe(true);
        tally[spawned[0].kindId] = (tally[spawned[0].kindId] ?? 0) + 1;
      }
      // Their frequencies follow the reported weights (same pool, scaled to the floor-free denominator).
      const total = r.totalWeight;
      for (const e of r.canSpawn) {
        const expected = (e.weight / total) * N;
        const seen = tally[e.mutationId] ?? 0;
        expect(Math.abs(seen - expected)).toBeLessThanOrEqual(5 * Math.sqrt(expected * (1 - e.weight / total)) + 2);
      }
    });
  }

});

describe("sanityCheck on a multi-plot scenario", () => {
  it("reads only the plot it is asked about", () => {
    const sc = scenario([
      flow([step("a", farm(layout([["pumpkin", 4, 3], ["melon", 4, 5]]), [4, 4]))]),
      flow([step("a", farm(layout([["wheat", 0, 0]]), [4, 4]))]),
    ], quiet);
    const s = start(sc);
    inject(s, 2, "pumpkin", 1, 1, "planted");
    expect(ids(sanityCheck(s, data, 1, 4, 4).canSpawn)).toEqual(["gloomgourd"]);
    expect(ids(sanityCheck(s, data, 2, 4, 4).canSpawn)).toEqual(["lonelily"]);
  });
});
