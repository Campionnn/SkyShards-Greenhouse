import { describe, expect, it } from "vitest";
import { createEngine } from "../../simulator/engine";
import type { SimulationState } from "../../simulator/sim/state";
import { CUT_STEP } from "../rules";
import { BUILDER_SUPPLIES, builderFor, builderScenario, builderSeed, builderSubmission, kitEmpty, kitOf, ownsKit, readBuilderLines, rewriteBuilderScript, type Kit } from "./builder";

const engine = createEngine();

/** Run the builder until it owns the kit (or `max` cycles); the cycles it took, its days, and the plots that farmed Jellybeans at once. */
function build(kit: Kit, every: number, seed: number, max: number) {
  let state: SimulationState = engine.initState(builderScenario(kit, { tier: "max", every, seed })).state;
  let jellyPlots = 0;
  while (!ownsKit(state.inventory, kit) && state.cycle < max) {
    const r = engine.run(state, Math.min(100, max - state.cycle), {
      retainEvents: "none",
      onCycle: (s) => {
        jellyPlots = Math.max(jellyPlots, s.flows.filter((f) => s.scenario.plots.find((p) => p.id === f.plotId)!.flow.steps[f.stepIndex].id === "jelly").length);
        return ownsKit(s.inventory, kit);
      },
    });
    state = r.state;
    expect(state.scripts?.halt ?? null).toBeNull();
  }
  return { done: ownsKit(state.inventory, kit), cycles: state.cycle, days: state.elapsedSeconds / 86400, jellyPlots, state };
}

describe("builder: the frozen Rose Dragon flow", () => {
  it("every plot script has a `const D` and a `const KNOBS` line that parse", () => {
    const sub = builderSubmission();
    expect(sub.plots.map((p) => p.id)).toEqual([1, 2, 3]);
    for (const p of sub.plots) {
      const { D, KNOBS } = readBuilderLines(p.script!.source);
      expect(Object.keys(D.legendaries as object).sort()).toEqual(["all_in_aloe", "devourer", "glasscorn", "phantomleaf", "timestalk"]);
      expect(KNOBS.single).toEqual(["jelly", "choco", "aloe"]);
    }
  });

  it("the D line round-trips: the goal is the kit, marks are raised to it, Jellybeans may farm on several plots; nothing else changes", () => {
    const src = builderSubmission().plots[1].script!.source;
    const before = readBuilderLines(src);
    const kit: Kit = { duskbloom: 41, zombud: 2, cindershade: 3, shadevine: 7, devourer: 1 };
    const out = rewriteBuilderScript(src, kit);
    const after = readBuilderLines(out);
    expect(after.D.goal).toEqual(kit);
    expect(after.D.legendaries).toEqual({ devourer: 1 });
    const low = before.D.low as Record<string, number>;
    const high = before.D.high as Record<string, number>;
    expect((after.D.low as Record<string, number>).duskbloom).toBe(Math.max(low.duskbloom, 41));
    expect((after.D.high as Record<string, number>).duskbloom).toBe(Math.max(high.duskbloom, 41));
    expect((after.D.low as Record<string, number>).zombud).toBe(low.zombud); // already above the kit
    expect((after.D.low as Record<string, number>).chloronite).toBe(low.chloronite); // not in the kit: unchanged
    expect(after.KNOBS.single).toEqual(["choco", "aloe"]);
    for (const k of Object.keys(before.D)) if (!["goal", "legendaries", "low", "high"].includes(k)) expect(after.D[k]).toEqual(before.D[k]);
    for (const k of Object.keys(before.KNOBS)) if (k !== "single") expect(after.KNOBS[k]).toEqual(before.KNOBS[k]);
    // Only the two generated lines differ.
    const a = src.split("\n");
    const b = out.split("\n");
    expect(b).toHaveLength(a.length);
    expect(a.filter((l, i) => l !== b[i]).map((l) => l.slice(0, 13))).toEqual(["const KNOBS =", "const D = {\"g"]);
    // A JSON value that looks like a replacement pattern is written verbatim.
    expect(readBuilderLines(rewriteBuilderScript(src, { "$&": 1 })).D.goal).toEqual({ "$&": 1 });
    expect(() => rewriteBuilderScript("let x = 1;", kit)).toThrow(/const D/);
  });

  it("builderFor rewrites every plot; the scenario is strict, with free supplies in stock and its own seed", () => {
    const kit: Kit = { zombud: 2 };
    const sub = builderFor(kit);
    for (const p of sub.plots) expect(readBuilderLines(p.script!.source).D.goal).toEqual(kit);
    // The frozen copy itself is untouched.
    expect(readBuilderLines(builderSubmission().plots[0].script!.source).D.legendaries).toMatchObject({ devourer: 2 });
    const sc = builderScenario(kit, { tier: "max", every: 3, seed: 7 });
    expect(sc.startingInventory).toEqual(BUILDER_SUPPLIES);
    expect(sc.settings.seed).toBe(builderSeed(7));
    expect(builderSeed(7)).not.toBe(7);
    expect(sc.settings.config.setupFromStock).toBe(true);
    expect(sc.settings.config.allowMutationDebt).toBe(false);
    expect(sc.settings.activity).toEqual({ kind: "everyN", n: 3, offset: 0 });
  });

  it("kitOf rounds each item up and drops nothing-owed items; an empty kit is empty", () => {
    expect(kitOf({ magic_jellybean: 43.304, chloronite: 48, cindershade: 10.806, zombud: 0, bad: Number.NaN })).toEqual({ chloronite: 48, cindershade: 11, magic_jellybean: 44 });
    expect(kitOf({ duskbloom: 41.0000000001 })).toEqual({ duskbloom: 41 });
    expect(kitEmpty(kitOf({}))).toBe(true);
    expect(kitEmpty(kitOf(undefined))).toBe(true);
    expect(ownsKit({ a: 2, b: 5 }, { a: 2, b: 4 })).toBe(true);
    expect(ownsKit({ a: 1 }, { a: 2 })).toBe(false);
    expect(ownsKit({}, {})).toBe(true);
  });

  it("MAGA's kit (2 Zombud, 3 Cindershade, ...) is made from nothing in about 4 days online every cycle", () => {
    const kit: Kit = { cindershade: 3, duskbloom: 41, dustgrain: 6, shadevine: 7, zombud: 2 };
    const seeds = [1, 2, 3].map((seed) => build(kit, 1, seed, 1000));
    for (const r of seeds) {
      expect(r.done).toBe(true);
      expect(r.days).toBeGreaterThan(2.5);
      expect(r.days).toBeLessThan(7);
      // Made, not handed over: nothing of the kit was in stock at the start.
      expect(r.state.ledger.zombud.produced).toBeGreaterThanOrEqual(2);
    }
    const days = seeds.map((r) => r.days).sort((a, b) => a - b)[1];
    expect(days).toBeGreaterThan(3);
    expect(days).toBeLessThan(5.5);
    expect(CUT_STEP).toBe(25);
  });

  it("the aloe flow's kit (117 Jellybeans) farms Jellybeans on several plots and takes about 12 days, not 23", () => {
    const kit: Kit = { dustgrain: 14, gloomgourd: 44, magic_jellybean: 117, shadevine: 10 };
    const r = build(kit, 1, 1, 1000);
    expect(r.done).toBe(true);
    expect(r.jellyPlots).toBeGreaterThanOrEqual(2);
    expect(r.days).toBeGreaterThan(8);
    expect(r.days).toBeLessThan(17);
  });
});
