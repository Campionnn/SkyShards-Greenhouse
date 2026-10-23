import { describe, expect, it } from "vitest";
import { createEngine } from "../simulator/engine";
import { DEFAULT_CONFIG } from "../simulator/config";
import { DEFAULT_POLICIES } from "../simulator/flow/policies";
import { defaultSettings } from "../simulator/scenario";
import { flow, layout, scenario, step } from "../simulator/testHelpers";
import { handle } from "./cli";
import { scaleProduced, slack, valueResult, yieldStatsDiffer } from "./pricing";
import { cellSolvent, median, medianResult, spreadRatio, type RunResult } from "./result";
import {
  applyRules,
  checkSubmission,
  clampCycles,
  IRONMAN_FREE_ITEMS,
  PAYBACK_CYCLES,
  parseSubmission,
  ruleDifferences,
  ruleScenario,
  submissionFile,
  submissionFromScenario,
} from "./rules";
import { EVERY, nearestEvery, nearestTier, TIER_STATS, tierStats, YIELD_STATS } from "./tiers";
import { outlierCheck, runOnce, verifyJob } from "./verify";

const engine = createEngine();

const twoStep = () =>
  scenario([flow([step("one", layout([["wheat", 0, 0], ["carrot", 0, 2]]), [{ kind: "cycles", n: 5 }]), step("two", layout([["potato", 0, 0]]))], true)], {
    inventory: { chloronite: 5 },
    stats: { farmingFortune: 0 },
    config: { waterLossMin: 1 },
  });

describe("rules: parse and normalise a submission", () => {
  it("keeps plots, policies and scripts; drops everything else", () => {
    const sc = twoStep();
    sc.settings.policies = { ...sc.settings.policies, spawnedHarvest: "beforeDecay" };
    sc.script = { source: "function onTick() {}" };
    const file = submissionFile(submissionFromScenario(sc));
    expect(file.version).toBe(2);
    expect(Object.keys(file.settings)).toEqual(["policies"]);
    expect(file.script?.source).toContain("onTick");

    const parsed = parseSubmission(file);
    expect(parsed.errors).toEqual([]);
    expect(parsed.submission!.plots).toHaveLength(1);
    expect(parsed.submission!.policies.spawnedHarvest).toBe("beforeDecay");
    expect(parsed.submission!.policies.watering).toBe("toMax");
  });

  it("ignores stats, inventory, seed and config sections of a v2 export, and unknown policy keys", () => {
    const raw = {
      kind: "skyshards-greenhouse-flows",
      version: 2,
      plots: twoStep().plots,
      startingInventory: { chloronite: 99 },
      settings: { seed: 7, playerStats: { cropGrowth: 0 }, config: { allowMutationDebt: true }, policies: { spawnedHarvest: "never", bogus: 1, watering: "sometimes" } },
    };
    const parsed = parseSubmission(raw);
    expect(parsed.submission).not.toBeNull();
    const sc = ruleScenario(parsed.submission!, { board: "ironman", tier: "max", every: 1, seed: 123 });
    expect(sc.startingInventory).toEqual({});
    expect(sc.settings.seed).toBe(123);
    expect(sc.settings.playerStats.cropGrowth).toBe(210);
    expect(sc.settings.config.allowMutationDebt).toBe(false);
    expect(sc.settings.policies.spawnedHarvest).toBe("never");
    expect(sc.settings.policies.watering).toBe("toMax");
    expect((sc.settings.policies as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("rejects a file without plots or with a bad step", () => {
    expect(parseSubmission({ plots: [] }).errors[0]).toMatch(/No plots/);
    expect(parseSubmission("nope").errors[0]).toMatch(/flows file/);
    const bad = parseSubmission({ plots: [{ id: 1, flow: { steps: [{ id: "s", layout: {} }] } }] });
    expect(bad.submission).toBeNull();
    expect(bad.errors[0]).toMatch(/exits list/);
  });

  it("ironman runs get free dead plants and fermento; normal runs get the Bazaar profile", () => {
    const s = submissionFromScenario(twoStep());
    const iron = ruleScenario(s, { board: "ironman", tier: "max", every: 2, seed: 1 });
    expect(iron.settings.config.freePlacedItems).toEqual([...IRONMAN_FREE_ITEMS]);
    expect(iron.settings.profile).toBeUndefined();
    expect(iron.settings.activity).toEqual({ kind: "everyN", n: 2, offset: 0 });
    const normal = ruleScenario(s, { board: "normal", tier: "low", every: 1, seed: 1 });
    expect(normal.settings.config.freePlacedItems).toBeUndefined();
    expect(normal.settings.profile).toBe("normal");
    expect(normal.settings.playerStats).toEqual(tierStats("low"));
    // Only the free items and the starting layout on credit differ between the boards' configs.
    expect(iron.settings.config.bootstrapDebt).toBe(true);
    expect(normal.settings.config.bootstrapDebt).toBe(false);
    const ironRest = { ...iron.settings.config, bootstrapDebt: false };
    delete ironRest.freePlacedItems;
    expect(ironRest).toEqual({ ...DEFAULT_CONFIG });
  });

  it("checkSubmission passes a valid flow and reports validation errors", () => {
    const ok = checkSubmission(submissionFromScenario(twoStep()), engine.data);
    expect(ok.ok).toBe(true);
    expect(ok.plots).toBe(1);
    const sc = twoStep();
    sc.plots[0].flow.steps[0].exits = [{ when: [{ kind: "cycles", n: 1 }], to: "missing" }];
    const bad = checkSubmission(submissionFromScenario(sc), engine.data);
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("applyRules and ruleDifferences agree", () => {
    const sc = twoStep();
    expect(ruleDifferences(sc, "ironman").length).toBeGreaterThan(0);
    const ruled = applyRules(sc, "ironman", 3, 42);
    expect(ruleDifferences(ruled, "ironman")).toEqual([]);
    expect(ruled.plots).toBe(sc.plots);
    expect(ruled.settings.seed).toBe(42);
    expect(ruled.settings.activity).toEqual({ kind: "everyN", n: 3, offset: 0 });
    expect(ruleDifferences(ruled, "normal")).toEqual(["advanced setting \"bootstrapDebt\" differs", "advanced setting \"freePlacedItems\" differs", "profile is not normal"]);
  });

  it("clamps the cycle count", () => {
    expect(clampCycles(undefined)).toBe(2000);
    expect(clampCycles(10)).toBe(2000);
    expect(clampCycles(99999)).toBe(5000);
    expect(clampCycles(3210.7)).toBe(3210);
  });
});

describe("tiers", () => {
  it("picks the nearest tier and frequency", () => {
    expect(nearestTier(TIER_STATS.max)).toBe("max");
    expect(nearestTier(TIER_STATS.low)).toBe("low");
    expect(nearestTier({ ...TIER_STATS.mid, cropGrowth: 110 })).toBe("mid");
    expect(nearestEvery(5)).toBe(4);
    expect(nearestEvery(100)).toBe(12);
    expect(nearestEvery(1)).toBe(1);
  });

  it("tier stats combine the tier's sim stats with the max yield stats", () => {
    const s = tierStats("mid");
    expect(s.cropGrowth).toBe(100);
    expect(s.farmingFortune).toBe(YIELD_STATS.farmingFortune);
    expect(s.armorSet).toBe("helianthus");
    expect(defaultSettings().playerStats).toEqual(tierStats("max"));
  });
});

const result = (produced: Record<string, number>, extra: Partial<RunResult> = {}): RunResult => ({
  cycles: 100,
  days: 10,
  produced,
  consumed: {},
  bought: {},
  built: {},
  shortfall: {},
  uptime: 1,
  sustainable: true,
  effort: { sessions: 100, avg: 5, peak: 20, byKind: { harvest: 3 } },
  halted: false,
  ...extra,
});

describe("results: median and spread", () => {
  it("median is the lower middle value", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([])).toBe(0);
  });

  it("medianResult is component-wise, so one lucky seed never defines a count", () => {
    const m = medianResult([result({ wheat: 10, cropie: 1 }), result({ wheat: 12 }), result({ wheat: 11, cropie: 1000 }, { sustainable: false, halted: true })]);
    expect(m.produced).toEqual({ wheat: 11, cropie: 1 });
    expect(m.sustainable).toBe(false);
    expect(m.halted).toBe(true);
    expect(m.effort.byKind.harvest).toBe(3);
  });

  it("a cell is solvent when most seeds paid back; payback medians count 'never' as infinite", () => {
    const paid = (cycle: number | null) => result({}, { peakDebt: { chloronite: 4 }, paybackCycle: cycle, solvent: cycle !== null && cycle <= PAYBACK_CYCLES });
    expect(cellSolvent([paid(400), paid(900), paid(null)])).toBe(true);
    expect(cellSolvent([paid(400), paid(null), paid(1200)])).toBe(false);
    expect(cellSolvent([result({}), result({})])).toBe(true); // no debt data: solvent
    const m = medianResult([paid(400), paid(null), paid(null)]);
    expect(m.paybackCycle).toBeNull();
    expect(m.solvent).toBe(false);
    expect(m.peakDebt).toEqual({ chloronite: 4 });
    expect(medianResult([paid(400), paid(600), paid(null)]).paybackCycle).toBe(600);
    expect(medianResult([result({})]).solvent).toBeUndefined();
  });

  it("spreadRatio is best over median", () => {
    expect(spreadRatio([10, 10, 10])).toBe(1);
    expect(spreadRatio([10, 10, 30])).toBe(3);
    expect(spreadRatio([0, 0, 5])).toBe(Infinity);
    expect(spreadRatio([])).toBe(1);
  });
});

describe("pricing", () => {
  it("values ironman at NPC prices (mutation items 0) and normal at Bazaar prices minus purchases", () => {
    const r = result({ wheat: 100, chloronite: 2 }, { bought: { dead_plant: 4 }, built: { fermento: 2 } });
    const iron = valueResult(engine.data, r, "ironman");
    expect(iron.profitPerDay).toBe(100 * engine.data.crops.wheat.sellPrice);
    expect(iron.boughtPerDay).toBe(0);
    const quotes = {
      chloronite: { lowestSellOffer: 1_000_000, highestBuyOrder: 900_000 },
      dead_plant: { lowestSellOffer: 600, highestBuyOrder: 500 },
      fermento: { lowestSellOffer: 300_000, highestBuyOrder: 250_000 },
    };
    const normal = valueResult(engine.data, r, "normal", quotes, { buy: "instant", sell: "instant", taxPercent: 0 });
    expect(normal.revenuePerDay).toBeCloseTo(100 * engine.data.crops.wheat.sellPrice + 2 * 900_000);
    expect(normal.boughtPerDay).toBe(4 * 600);
    expect(normal.buildCost).toBe(2 * 300_000);
    expect(normal.profitPerDay).toBeCloseTo(normal.revenuePerDay - 2400);
  });

  it("scales crop bundles for yield stats and zeroes armor rare crops the viewer's set can't drop", () => {
    const produced = { wheat: 100, chloronite: 2, helianthus: 1, ethereal_vine: 1 };
    const same = scaleProduced(engine.data, produced, YIELD_STATS);
    expect(same).toEqual(produced);
    const none = scaleProduced(engine.data, produced, { ...YIELD_STATS, farmingFortune: 0, overbloom: 0, armorSet: "none" });
    expect(none.wheat).toBeCloseTo(100 / (1 + 3059.2 / 100));
    expect(none.chloronite).toBe(2);
    expect(none.helianthus).toBeUndefined();
    expect(none.ethereal_vine).toBeCloseTo(1 / 2.86);
    expect(yieldStatsDiffer(YIELD_STATS)).toBe(false);
    expect(yieldStatsDiffer({ ...YIELD_STATS, evergreenChip: 0 })).toBe(true);
  });

  it("slack weights the points just after k the most and ignores points outside (k, 2k]", () => {
    const values: Record<number, number> = { 1: 100, 2: 95, 3: 90, 4: 85, 6: 80, 8: 70, 12: 50 };
    const at = (e: number) => values[e];
    // k = 4: j = 6 (λ = 0.75) and 8 (λ = 0.25), r(j) = value(j) / value(4).
    expect(slack(4, at, EVERY)).toBeCloseTo((0.75 * (80 / 85) + 0.25 * (70 / 85)) / 1);
    expect(slack(12, at, EVERY)).toBeNull();
    expect(slack(1, at, EVERY)).toBeCloseTo(0.95);
    expect(slack(1, () => 0, EVERY)).toBeNull();
  });
});

describe("verify", () => {
  const submission = submissionFromScenario(twoStep());

  it("results record money by source and each step's share of the run", () => {
    const o = runOnce(engine, submission, "ironman", "max", 1, 5, 40, { wallMs: 60_000 });
    const st = o.result!.stepTime!;
    const shares = Object.values(st["1"]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(Object.keys(st["1"]).sort()).toEqual(["one", "two"]);
    const sc = twoStep();
    sc.settings.policies = { ...sc.settings.policies, baseCropUpkeep: "harvestWhenGrown" };
    const r = runOnce(engine, submissionFromScenario(sc), "ironman", "max", 1, 5, 40, { wallMs: 60_000 }).result!;
    expect(r.bySource!.potato.potato).toBeGreaterThan(0);
    // The medians keep both nested maps.
    const m = medianResult([r, r, r]);
    expect(m.bySource!.potato.potato).toBeCloseTo(r.bySource!.potato.potato);
    expect(m.stepTime).toEqual(r.stepTime);
  });

  it("runOnce produces a result with per-day counts and effort", () => {
    const sc = twoStep();
    sc.settings.policies = { ...sc.settings.policies, baseCropUpkeep: "harvestWhenGrown" };
    const o = runOnce(engine, submissionFromScenario(sc), "ironman", "max", 1, 5, 40, { wallMs: 60_000 });
    expect(o.ok).toBe(true);
    expect(o.result!.cycles).toBe(40);
    expect(o.result!.days).toBeGreaterThan(0);
    expect(o.result!.effort.sessions).toBe(40);
    // Step one leaves after 5 cycles for the potato step, which stays: potatoes are harvested and replanted.
    expect(o.result!.produced.potato).toBeGreaterThan(0);
    expect(o.result!.effort.byKind.harvest).toBeGreaterThan(0);
    expect(o.result!.effort.byKind.replant).toBeGreaterThan(0);
  });

  it("ironman results carry the starting layout's debt; normal ones don't", () => {
    // A placed chloronite with nothing that grows it back: borrowed at setup, never paid back.
    const sc = scenario([flow([step("one", layout([["chloronite", 5, 5], ["wheat", 0, 0]]))], false)]);
    const iron = runOnce(engine, submissionFromScenario(sc), "ironman", "max", 1, 5, 20, { wallMs: 60_000 }).result!;
    expect(iron.peakDebt).toEqual({ chloronite: 1 });
    expect(iron.paybackCycle).toBeNull();
    expect(iron.solvent).toBe(false);
    const normal = runOnce(engine, submissionFromScenario(sc), "normal", "max", 1, 5, 20, { wallMs: 60_000 }).result!;
    expect(normal.paybackCycle).toBeUndefined();
    expect(normal.solvent).toBeUndefined();
    // Base crops only: nothing borrowed, paid back at cycle 0.
    const free = runOnce(engine, submission, "ironman", "max", 1, 5, 20, { wallMs: 60_000 }).result!;
    expect(free).toMatchObject({ peakDebt: {}, paybackCycle: 0, solvent: true });
  });

  it("the same seed gives the same result; a different seed may differ", () => {
    const a = runOnce(engine, submission, "ironman", "max", 1, 5, 40, { wallMs: 60_000 });
    const b = runOnce(engine, submission, "ironman", "max", 1, 5, 40, { wallMs: 60_000 });
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  });

  it("fails a run over the wall-clock cap", () => {
    let t = 0;
    const o = runOnce(engine, submission, "ironman", "max", 1, 5, 400, { wallMs: 10, now: () => (t += 100) });
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/took longer/);
  });

  it("fails a run over the CPU cap, independent of wall time", () => {
    let cpu = 0;
    const o = runOnce(engine, submission, "ironman", "max", 1, 5, 400, { wallMs: 1e9, cpuMs: 150, cpuNow: () => (cpu += 100) });
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/CPU time/);
    const fine = runOnce(engine, submission, "ironman", "max", 1, 5, 400, { wallMs: 1e9, cpuMs: 1e9 });
    expect(fine.ok).toBe(true);
    // Measured (the run can finish within one tick of a coarse OS CPU clock, so it may read 0).
    expect(fine.cpuMs).not.toBeNull();
    expect(fine.cpuMs).toBeGreaterThanOrEqual(0);
  });

  it("fails a run over the script step cap, independent of the machine", () => {
    const sc = twoStep();
    sc.script = { source: "function onTick() { let n = 0; for (let i = 0; i < 1000; i++) { n += i } }" };
    const sub = submissionFromScenario(sc);
    const capped = runOnce(engine, sub, "ironman", "max", 1, 5, 400, { wallMs: 1e9, scriptSteps: 50_000 });
    expect(capped.ok).toBe(false);
    expect(capped.error).toMatch(/steps/);
    // Deterministic: it fails at the same cycle every time.
    expect(runOnce(engine, sub, "ironman", "max", 1, 5, 400, { wallMs: 1e9, scriptSteps: 50_000 }).error).toBe(capped.error);
    expect(runOnce(engine, sub, "ironman", "max", 1, 5, 40, { wallMs: 1e9 }).ok).toBe(true);
    // The runtime counts steps in the state, the same across a split run.
    const state = engine.initState(ruleScenario(sub, { board: "ironman", tier: "max", every: 1, seed: 5 })).state;
    const whole = engine.run(state, 20).state.scripts!.steps!;
    const split = engine.run(engine.run(state, 10).state, 10).state.scripts!.steps!;
    expect(whole).toBeGreaterThan(20_000);
    expect(split).toBe(whole);
  });

  it("fails a run a script halts", () => {
    const sc = twoStep();
    sc.script = { source: "function onTick() { if (cycle >= 3) pause('stop') }" };
    const o = runOnce(engine, submissionFromScenario(sc), "ironman", "max", 1, 5, 40, { wallMs: 60_000 });
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/script/);
  });

  it("verifyJob runs every cell and the outlier check compares seeds per frequency", () => {
    const outcomes = verifyJob(engine, {
      submission,
      board: "ironman",
      tier: "max",
      cycles: 30,
      runs: [
        { every: 1, seed: 1, seedIndex: 0 },
        { every: 1, seed: 2, seedIndex: 1 },
        { every: 3, seed: 3, seedIndex: 0 },
      ],
      wallMsPerRun: 60_000,
    });
    expect(outcomes.map((o) => o.seedIndex)).toEqual([0, 1, 0]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    const check = outlierCheck(engine, outcomes, "ironman", {}, 2);
    expect(Object.keys(check.ratios).map(Number).sort()).toEqual([1, 3]);
    expect(check.ok).toBe(true);
    const strict = outlierCheck(engine, outcomes, "ironman", {}, 0.5);
    expect(strict.ok).toBe(false);
  });
});

describe("cli", () => {
  it("version, check and verify modes", () => {
    const v = handle({ mode: "version" }) as { every: number[]; tiers: string[] };
    expect(v.every).toEqual([...EVERY]);
    const file = submissionFile(submissionFromScenario(twoStep()));
    const c = handle({ mode: "check", payload: file }) as { ok: boolean };
    expect(c.ok).toBe(true);
    const lines: string[] = [];
    const r = handle({ mode: "verify", payload: file, board: "normal", tier: "mid", cycles: 1, runs: [{ every: 2, seed: 9, seedIndex: 0 }] }, (l) => lines.push(l)) as {
      results: { ok: boolean; result: RunResult }[];
      outlier: { ok: boolean };
    };
    // cycles are clamped up to the minimum: the run is 2000 cycles... too slow for a unit test? No: 1 plot of 2 crops is fast.
    expect(r.results[0].ok).toBe(true);
    expect(r.results[0].result.cycles).toBe(2000);
    expect(lines).toEqual(["progress 1/1"]);
    expect(() => handle({ mode: "verify", payload: file, board: "x" as never, tier: "max", runs: [] })).toThrow(/board/);
    expect(() => handle({ mode: "nope" as never })).toThrow(/unknown mode/);
  });

  it("a check of a broken payload reports errors instead of throwing", () => {
    const c = handle({ mode: "check", payload: { plots: [] } }) as { ok: boolean; errors: string[] };
    expect(c.ok).toBe(false);
    expect(c.errors.length).toBe(1);
  });
});

describe("policies defaults are the engine's", () => {
  it("submissionFromScenario of default settings yields DEFAULT_POLICIES", () => {
    expect(submissionFromScenario(twoStep()).policies).toEqual(DEFAULT_POLICIES);
  });
});
