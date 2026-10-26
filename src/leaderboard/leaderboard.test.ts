import { describe, expect, it } from "vitest";
import { createEngine } from "../simulator/engine";
import { DEFAULT_CONFIG } from "../simulator/config";
import { DEFAULT_POLICIES } from "../simulator/flow/policies";
import { defaultSettings } from "../simulator/scenario";
import { flow, layout, scenario, step, TIMER_ONLY } from "../simulator/testHelpers";
import { handle } from "./cli";
import { scaleProduced, scaleResult, slack, valueResult, yieldStatsDiffer } from "./pricing";
import { cellResult, median, RunRecorder, runResult, seedSlowing, spreadRatio, trailResult, type RunResult } from "./result";
import {
  applyRules,
  boardFrom,
  checkSubmission,
  clampCycles,
  CUT_STEP,
  debugApiErrors,
  END_WINDOW,
  endCycles,
  IRONMAN_FREE_ITEMS,
  parseSubmission,
  ruleConfig,
  ruleDifferences,
  ruleScenario,
  runKindFrom,
  submissionFile,
  submissionFromScenario,
  TRAIL_MIN,
  TRAIL_SHARE,
} from "./rules";
import { EVERY, nearestEvery, nearestTier, TIER_STATS, tierStats, YIELD_STATS } from "./tiers";
import { outlierCheck, referenceValue, runOnce, verifyJob } from "./verify";

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
    const sc = ruleScenario(parsed.submission!, { runKind: "strict", tier: "max", every: 1, seed: 123 });
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
    const strict = ruleScenario(s, { runKind: "strict", tier: "max", every: 2, seed: 1 });
    expect(strict.settings.config.freePlacedItems).toEqual([...IRONMAN_FREE_ITEMS]);
    expect(strict.settings.profile).toBeUndefined();
    expect(strict.settings.activity).toEqual({ kind: "everyN", n: 2, offset: 0 });
    const normal = ruleScenario(s, { runKind: "normal", tier: "low", every: 1, seed: 1 });
    expect(normal.settings.config.freePlacedItems).toBeUndefined();
    expect(normal.settings.profile).toBe("normal");
    expect(normal.settings.playerStats).toEqual(tierStats("low"));
  });

  it("run kinds: strict pays the setup from stock, borrow may owe, normal is today's normal board", () => {
    // Strict: from nothing. The setup is paid from the empty stock and nothing is ever borrowed.
    expect(ruleConfig("strict")).toEqual({ ...DEFAULT_CONFIG, freePlacedItems: [...IRONMAN_FREE_ITEMS], setupFromStock: true, leaderboardRules: true });
    // Borrow: with starting items. Any mutation item may be placed before it is owned.
    expect(ruleConfig("borrow")).toEqual({ ...DEFAULT_CONFIG, freePlacedItems: [...IRONMAN_FREE_ITEMS], bootstrapDebt: true, allowMutationDebt: true, leaderboardRules: true });
    // Normal: exactly the pre-v2 normal-board config, plus only the rules flag (the debug APIs and hidden credit settings).
    expect(ruleConfig("normal")).toEqual({ ...DEFAULT_CONFIG, leaderboardRules: true });
    expect(Object.keys(ruleConfig("normal"))).toEqual([...Object.keys(DEFAULT_CONFIG), "leaderboardRules"]);
    const normal = ruleScenario(submissionFromScenario(twoStep()), { runKind: "normal", tier: "max", every: 1, seed: 9 }).settings;
    expect(normal.profile).toBe("normal");
    expect(normal.reserve).toBeUndefined();
  });

  it("board names: the old 'ironman' is from nothing; requests may send a board or a run kind", () => {
    expect(boardFrom("ironman")).toBe("ironman_strict");
    expect(boardFrom("ironman_borrow")).toBe("ironman_borrow");
    expect(boardFrom("normal")).toBe("normal");
    expect(boardFrom("nope")).toBeNull();
    expect(runKindFrom("borrow")).toBe("borrow");
    expect(runKindFrom("ironman")).toBe("strict");
    expect(runKindFrom("ironman_borrow")).toBe("borrow");
    expect(runKindFrom(undefined)).toBeNull();
  });

  it("the end window constants are the API's (leaderboard/config.py)", () => {
    expect({ END_WINDOW, CUT_STEP, TRAIL_SHARE, TRAIL_MIN }).toEqual({ END_WINDOW: 1.25, CUT_STEP: 25, TRAIL_SHARE: 0.2, TRAIL_MIN: 0.6 });
    expect(endCycles(2000)).toBe(2500);
    expect(endCycles(4999)).toBe(6249);
    expect(endCycles(5000)).toBe(6250);
  });

  it("step-level policies are cleaned like plot policies", () => {
    const sc = twoStep();
    sc.plots[0].flow.steps[0].policies = { spawnedHarvest: "beforeDecay", watering: "sometimes", evil: 1, gateInteractions: { vacuumRat: false, nope: true } } as never;
    sc.plots[0].flow.steps[1].policies = { bogus: 2 } as never;
    const parsed = parseSubmission(submissionFile(submissionFromScenario(sc)));
    const [a, b] = parsed.submission!.plots[0].flow.steps;
    expect(a.policies).toEqual({ spawnedHarvest: "beforeDecay", gateInteractions: { vacuumRat: false } });
    expect(b.policies).toBeUndefined();
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

  it("checkSubmission refuses the debug script APIs, naming the script and line", () => {
    const sc = twoStep();
    sc.script = { source: "// tech\nfor (const k of CROPS) forceEffects(k, ['immunity'])" };
    const bad = checkSubmission(submissionFromScenario(sc), engine.data);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/Controller script, line 2: forceEffects\(\) is a debugging tool and isn't allowed on the leaderboard/);
    const plot = twoStep();
    plot.plots[0].script = { source: "function onSession() { unforceEffects(); resetForcedEffects() }" };
    expect(debugApiErrors(submissionFromScenario(plot))).toEqual([expect.stringMatching(/^Plot 1 script, line 1: unforceEffects\(\), resetForcedEffects\(\) are debugging tools and aren't allowed on the leaderboard/)]);
    // In an exit condition too; a disabled script and a property of the same name are fine.
    const cond = twoStep();
    cond.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: "forceEffects('wheat', []) || true" }] }];
    expect(debugApiErrors(submissionFromScenario(cond))[0]).toMatch(/step 1 \(one\) exit condition/);
    const off = twoStep();
    off.plots[0].script = { source: "forceEffects('wheat', [])", enabled: false };
    off.script = { source: "let o = { forceEffects: 1 }; log(o.forceEffects)" };
    expect(checkSubmission(submissionFromScenario(off), engine.data).ok).toBe(true);
  });

  it("must-fix: the red team's forceEffects attack ('fxall') is refused at check and gains nothing at run time", () => {
    const sc = twoStep();
    sc.script = { source: 'for (const k of [...CROPS, ...MUTATIONS]) forceEffects(k, ["immunity", "improved_harvest_boost", "bonus_drops"]);' };
    const sub = submissionFromScenario(sc);
    expect(checkSubmission(sub, engine.data).errors.some((e) => /forceEffects\(\) is a debugging tool/.test(e))).toBe(true);
    const r = handle({ mode: "check", payload: submissionFile(sub) }) as { ok: boolean; errors: string[] };
    expect(r.ok).toBe(false);
    // Even if it got past the check, the run fails instead of scoring the forced effects.
    const o = runOnce(engine, sub, "borrow", "max", 1, 5, 40, { wallMs: 60_000 });
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/debugging tool/);
  });

  it("applyRules and ruleDifferences agree", () => {
    const sc = twoStep();
    expect(ruleDifferences(sc, "strict").length).toBeGreaterThan(0);
    const ruled = applyRules(sc, "strict", 3, 42);
    expect(ruleDifferences(ruled, "strict")).toEqual([]);
    expect(ruled.plots).toBe(sc.plots);
    expect(ruled.settings.seed).toBe(42);
    expect(ruled.settings.activity).toEqual({ kind: "everyN", n: 3, offset: 0 });
    expect(ruleDifferences(ruled, "normal")).toEqual(["advanced setting \"freePlacedItems\" differs", "advanced setting \"setupFromStock\" differs", "profile is not normal"]);
    expect(ruleDifferences(applyRules(sc, "borrow", 1, 1), "borrow")).toEqual([]);
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

  const npc = (r: RunResult) => valueResult(engine.data, r, "ironman_strict").profitPerDay;

  it("must-fix: a cell is its median seed's counts, never a per-item mix of seeds", () => {
    // Disjoint farms per seed (the "Frankenstein median" attack): per-item medians would give
    // wheat 1000 and potato 1000, more than any real seed.
    const a = result({ wheat: 1000, potato: 10 });
    const b = result({ wheat: 10, potato: 1000 });
    const c = result({ wheat: 600, potato: 600 });
    const cell = cellResult([a, b, c], npc);
    const values = [a, b, c].map(npc).sort((x, y) => x - y);
    expect(npc(cell)).toBe(values[1]);
    expect([a, b, c].map((r) => JSON.stringify(r.produced))).toContain(JSON.stringify(cell.produced));
    // Lower middle for an even count; ties keep the earlier seed.
    const tie = cellResult([result({ wheat: 5 }, { uptime: 0.1 }), result({ wheat: 5 }, { uptime: 0.2 }), result({ wheat: 9 }), result({ wheat: 1 })], npc);
    expect(tie.uptime).toBe(0.1);
    expect(() => cellResult([], npc)).toThrow();
  });

  it("still producing: a cell whose seeds mostly slow down is scored at the median seed's trailing rate", () => {
    const trail = (wheat: number) => ({ from: 4000, produced: { wheat }, consumed: {}, bought: {}, shortfall: {}, bySource: {} });
    const steady = result({ wheat: 100 }, { trail: trail(95) });
    expect(seedSlowing(steady, npc)).toBe(false);
    const collapse = (w: number, t: number) => result({ wheat: w }, { trail: trail(t) });
    expect(seedSlowing(collapse(100, 59), npc)).toBe(true);
    expect(seedSlowing(collapse(100, 60), npc)).toBe(false);
    expect(seedSlowing(result({ wheat: 100 }), npc)).toBe(false); // no trail data
    const cell = cellResult([collapse(100, 20), collapse(110, 30), steady], npc);
    expect(cell.slowing).toBe(true);
    expect(cell.produced).toEqual({ wheat: 30 });
    expect(cell.trail).toBeUndefined();
    // A minority of slowing seeds doesn't change the cell.
    const fine = cellResult([collapse(100, 20), steady, result({ wheat: 120 }, { trail: trail(118) })], npc);
    expect(fine.slowing).toBeUndefined();
    expect(fine.produced).toEqual({ wheat: 100 });
    expect(trailResult(collapse(100, 20)).produced).toEqual({ wheat: 20 });
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
    const iron = valueResult(engine.data, r, "ironman_strict");
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

  it("scales per crop: crop bonus, best tool per source, mutation items untouched", () => {
    const ff = YIELD_STATS.farmingFortune;
    const m = (x: number) => 1 + x / 100;
    const produced = { wheat: 1000, seeds: 50, carrot: 400, chloronite: 2, red_mushroom: 10 };
    // No per-crop terms: identical to the single-multiplier path.
    expect(scaleProduced(engine.data, produced, { ...YIELD_STATS, cropFortune: {}, tools: [] })).toEqual(produced);
    expect(yieldStatsDiffer({ ...YIELD_STATS, cropFortune: {}, tools: [] })).toBe(false);
    expect(yieldStatsDiffer({ ...YIELD_STATS, cropFortune: { wheat: 0 } })).toBe(false);
    expect(yieldStatsDiffer({ ...YIELD_STATS, cropFortune: { wheat: 100 } })).toBe(true);
    expect(yieldStatsDiffer({ ...YIELD_STATS, tools: [{ name: "Hoe", fortune: { wheat: 1 } }] })).toBe(true);
    expect(yieldStatsDiffer({ ...YIELD_STATS, tools: [{ name: "Hoe", fortune: { wheat: 1 } }] }, { ...YIELD_STATS, tools: [{ name: "Hoe", fortune: { wheat: 1 } }] })).toBe(false);

    // Crop bonus: wheat and seeds (Wheat Fortune) and mushrooms (Mushroom Fortune), nothing else.
    const bonus = scaleProduced(engine.data, produced, { ...YIELD_STATS, cropFortune: { wheat: 100, mushroom: 50 } });
    expect(bonus.wheat).toBeCloseTo((1000 * m(ff + 100)) / m(ff));
    expect(bonus.seeds).toBeCloseTo((50 * m(ff + 100)) / m(ff));
    expect(bonus.red_mushroom).toBeCloseTo((10 * m(ff + 50)) / m(ff));
    expect(bonus.carrot).toBeCloseTo(400);
    expect(bonus.chloronite).toBe(2);

    // Tools without bySource: each item gets the tool with the most fortune on its crop.
    const tools = [
      { name: "Wheat Hoe", fortune: { wheat: 300 } },
      { name: "Carrot Hoe", fortune: { carrot: 200, wheat: 10 } },
    ];
    const noSource = scaleProduced(engine.data, produced, { ...YIELD_STATS, tools });
    expect(noSource.wheat).toBeCloseTo((1000 * m(ff + 300)) / m(ff));
    expect(noSource.carrot).toBeCloseTo((400 * m(ff + 200)) / m(ff));
    expect(noSource.chloronite).toBe(2);

    // With bySource: one tool per source bundle. The chloronite harvests drop wheat and carrots;
    // carrots are worth more there, so that source uses the Carrot Hoe for its wheat too.
    const bySource = { wheat: { wheat: 800, seeds: 50 }, chloronite: { wheat: 200, carrot: 400, chloronite: 2 } };
    const priced = { ...YIELD_STATS, tools };
    const price = (item: string) => (item === "carrot" ? 100 : 1);
    const per = scaleProduced(engine.data, produced, priced, YIELD_STATS, { bySource, price });
    const wheatScaled = (800 * m(ff + 300)) / m(ff) + (200 * m(ff + 10)) / m(ff);
    expect(per.wheat).toBeCloseTo((1000 * wheatScaled) / 1000);
    expect(per.carrot).toBeCloseTo((400 * m(ff + 200)) / m(ff));
    expect(per.seeds).toBeCloseTo((50 * m(ff + 300)) / m(ff)); // seeds count as wheat
    expect(per.chloronite).toBe(2);
    // scaleResult scales bySource with the same tools, and its totals match produced.
    const r = scaleResult(engine.data, result(produced, { bySource }), priced, YIELD_STATS, { price });
    expect(r.bySource!.chloronite.carrot).toBeCloseTo(per.carrot);
    expect(r.bySource!.wheat.wheat + r.bySource!.chloronite.wheat).toBeCloseTo(per.wheat);
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
    const o = runOnce(engine, submission, "strict", "max", 1, 5, 40, { wallMs: 60_000 });
    const st = o.result!.stepTime!;
    const shares = Object.values(st["1"]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(Object.keys(st["1"]).sort()).toEqual(["one", "two"]);
    const sc = twoStep();
    sc.settings.policies = { ...sc.settings.policies, baseCropUpkeep: "harvestWhenGrown" };
    const r = runOnce(engine, submissionFromScenario(sc), "strict", "max", 1, 5, 40, { wallMs: 60_000 }).result!;
    expect(r.bySource!.potato.potato).toBeGreaterThan(0);
    // A cell keeps both nested maps (it is one seed's result).
    const m = cellResult([r, r, r], (x) => valueResult(engine.data, x, "ironman_strict").profitPerDay);
    expect(m.bySource).toEqual(r.bySource);
    expect(m.stepTime).toEqual(r.stepTime);
  });

  it("runOnce runs the author's length plus the end window and scores the window mean", () => {
    const sc = twoStep();
    sc.settings.policies = { ...sc.settings.policies, baseCropUpkeep: "harvestWhenGrown" };
    const sub = submissionFromScenario(sc);
    const o = runOnce(engine, sub, "strict", "max", 1, 5, 40, { wallMs: 60_000 });
    expect(o.ok).toBe(true);
    expect(o.result!.cycles).toBe(50);
    expect(o.result!.window).toEqual({ from: 40, to: 50, cuts: 1 });
    expect(o.result!.days).toBeGreaterThan(0);
    expect(o.result!.effort.sessions).toBe(50);
    // Step one leaves after 5 cycles for the potato step, which stays: potatoes are harvested and replanted.
    expect(o.result!.produced.potato).toBeGreaterThan(0);
    expect(o.result!.effort.byKind.harvest).toBeGreaterThan(0);
    expect(o.result!.effort.byKind.replant).toBeGreaterThan(0);

    // The window mean, by hand: cut points every CUT_STEP cycles from C to the end.
    const C = 100;
    const res = runOnce(engine, sub, "strict", "max", 1, 5, C, { wallMs: 60_000 }).result!;
    expect(res.window).toEqual({ from: 100, to: 125, cuts: 2 });
    let state = engine.initState(ruleScenario(sub, { runKind: "strict", tier: "max", every: 1, seed: 5 })).state;
    const rates: number[] = [];
    for (const t of [100, 125]) {
      state = engine.run(state, t - state.cycle).state;
      rates.push(state.ledger.potato.produced / (state.elapsedSeconds / 86400));
    }
    expect(res.produced.potato).toBeCloseTo((rates[0] + rates[1]) / 2, 9);
    // The trailing 20% rates are measured over [100, 125].
    expect(res.trail!.from).toBe(100);
  });

  it("strict runs pay the starting layout from the empty stock; borrow runs record what they owe; normal runs neither", () => {
    // A placed chloronite with nothing that grows it back.
    const sc = scenario([flow([step("one", layout([["chloronite", 5, 5], ["wheat", 0, 0]]))], false)]);
    const sub = submissionFromScenario(sc);
    const strict = runOnce(engine, sub, "strict", "max", 1, 5, 20, { wallMs: 60_000 }).result!;
    expect(strict.startItems).toBeUndefined();
    expect(strict.consumed.chloronite).toBeUndefined();
    expect(strict.shortfall.chloronite).toBeGreaterThan(0);
    expect(strict.starved).toEqual([{ plot: 1, step: "one", item: "chloronite", cells: 1 }]);
    expect(strict.ramp!.complete).toBeNull();
    const borrow = runOnce(engine, sub, "borrow", "max", 1, 5, 20, { wallMs: 60_000 }).result!;
    expect(borrow.startItems).toEqual({ chloronite: 1 });
    expect(borrow.usedUp).toEqual({ chloronite: 1 });
    expect(borrow.sessionOnly).toEqual([]);
    expect(borrow.starved).toEqual([]);
    expect(borrow.ramp!.complete).toBe(0);
    const normal = runOnce(engine, sub, "normal", "max", 1, 5, 20, { wallMs: 60_000 }).result!;
    expect(normal.startItems).toBeUndefined();
    expect(normal.built).toEqual({ chloronite: 1 });
    expect(normal.starved).toEqual([]);
    // Base crops only: nothing owed, nothing starved.
    const free = runOnce(engine, submission, "borrow", "max", 1, 5, 20, { wallMs: 60_000 }).result!;
    expect(free).toMatchObject({ startItems: {}, usedUp: {}, upkeep: {}, starved: [] });
  });

  it("upkeep: debt that keeps growing is upkeep per day, not starting items or a one-off use", () => {
    // A chloronite that decays and is re-placed on credit every time, never grown: the owed amount
    // grows all run. The player needs 1 to start with and then supplies the upkeep; nothing else.
    const sc = scenario([flow([step("one", layout([["chloronite", 5, 5], ["wheat", 0, 0]]))], false)]);
    const o = runOnce(TIMER_ONLY, submissionFromScenario(sc), "borrow", "max", 1, 5, 400, { wallMs: 60_000 });
    const r = o.result!;
    expect(r.upkeep!.chloronite * r.days).toBeGreaterThan(3); // re-placed several times
    expect(r.startItems!.chloronite).toBeGreaterThanOrEqual(1);
    expect(r.startItems!.chloronite).toBeLessThan(2.5);
    expect(r.usedUp!.chloronite ?? 0).toBeLessThan(2.5);
    // The strict run of the same flow: one empty cell is below the can't-start threshold.
    expect(runOnce(TIMER_ONLY, submissionFromScenario(sc), "strict", "max", 1, 5, 400, { wallMs: 60_000 }).result!.cantStart).toBeUndefined();
  });

  it("cantStart: a strict run with a plot of empty cells for items it never grows", () => {
    const cells: [string, number, number][] = [];
    for (let c = 0; c < 6; c++) cells.push(["chloronite", 9, c]);
    const sc = scenario([flow([step("one", layout([...cells, ["wheat", 0, 0]]))], false)]);
    const strict = runOnce(engine, submissionFromScenario(sc), "strict", "max", 1, 5, 40, { wallMs: 60_000 }).result!;
    expect(strict.cantStart).toEqual({ plot: 1, cells: 6, items: ["chloronite"] });
    // A flow that starts (base crops only) has none; borrowing runs never have one.
    expect(runOnce(engine, submission, "strict", "max", 1, 5, 40, { wallMs: 60_000 }).result!.cantStart).toBeUndefined();
    expect(runOnce(engine, submissionFromScenario(sc), "borrow", "max", 1, 5, 40, { wallMs: 60_000 }).result!.cantStart).toBeUndefined();
  });

  it("startItems counts an item borrowed and given back within one session ('returned each session')", () => {
    const sc = scenario([flow([step("one", layout([["wheat", 0, 0]]))], false)]);
    sc.plots[0].script = { source: "function onSession() { if (plot.place('blastberry', 5, 5)) plot.breakAt(5, 5) }" };
    const r = runOnce(engine, submissionFromScenario(sc), "borrow", "max", 1, 5, 40, { wallMs: 60_000 }).result!;
    expect(r.startItems).toEqual({ blastberry: 1 });
    expect(r.sessionOnly).toEqual(["blastberry"]);
    expect(r.usedUp).toEqual({});
    // Strict: nothing to borrow, so the script places nothing.
    expect(runOnce(engine, submissionFromScenario(sc), "strict", "max", 1, 5, 40, { wallMs: 60_000 }).result!.startItems).toBeUndefined();
  });

  it("the recorder reads the state only: a recorded run equals an unrecorded one", () => {
    const sc = twoStep();
    sc.settings.policies = { ...sc.settings.policies, baseCropUpkeep: "harvestWhenGrown" };
    const ruled = ruleScenario(submissionFromScenario(sc), { runKind: "borrow", tier: "max", every: 2, seed: 3 });
    const plain = engine.run(engine.initState(ruled).state, 120).state;
    const s0 = engine.initState(ruled).state;
    const rec = new RunRecorder(engine.data, { from: 100, to: 120 });
    rec.observe(s0);
    const watched = engine.run(s0, 120, { onCycle: (s) => rec.observe(s) }).state;
    expect(JSON.stringify(watched)).toBe(JSON.stringify(plain));
    expect(rec.result(watched, true).window!.cuts).toBe(1);
    // Without a recorder (one cut at the end): totals per day.
    const days = plain.elapsedSeconds / 86400;
    expect(plain.ledger.potato.produced).toBeGreaterThan(0);
    expect(runResult(plain, true, engine.data).produced.potato).toBeCloseTo(plain.ledger.potato.produced / days, 9);
  });

  it("the same seed gives the same result; a different seed may differ", () => {
    const a = runOnce(engine, submission, "strict", "max", 1, 5, 40, { wallMs: 60_000 });
    const b = runOnce(engine, submission, "strict", "max", 1, 5, 40, { wallMs: 60_000 });
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  });

  it("fails a run over the wall-clock cap", () => {
    let t = 0;
    const o = runOnce(engine, submission, "strict", "max", 1, 5, 400, { wallMs: 10, now: () => (t += 100) });
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/took longer/);
  });

  it("fails a run over the CPU cap, independent of wall time", () => {
    let cpu = 0;
    const o = runOnce(engine, submission, "strict", "max", 1, 5, 400, { wallMs: 1e9, cpuMs: 150, cpuNow: () => (cpu += 100) });
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/CPU time/);
    const fine = runOnce(engine, submission, "strict", "max", 1, 5, 400, { wallMs: 1e9, cpuMs: 1e9 });
    expect(fine.ok).toBe(true);
    // Measured (the run can finish within one tick of a coarse OS CPU clock, so it may read 0).
    expect(fine.cpuMs).not.toBeNull();
    expect(fine.cpuMs).toBeGreaterThanOrEqual(0);
  });

  it("fails a run over the script step cap, independent of the machine", () => {
    const sc = twoStep();
    sc.script = { source: "function onTick() { let n = 0; for (let i = 0; i < 1000; i++) { n += i } }" };
    const sub = submissionFromScenario(sc);
    const capped = runOnce(engine, sub, "strict", "max", 1, 5, 400, { wallMs: 1e9, scriptSteps: 50_000 });
    expect(capped.ok).toBe(false);
    expect(capped.error).toMatch(/steps/);
    // Deterministic: it fails at the same cycle every time.
    expect(runOnce(engine, sub, "strict", "max", 1, 5, 400, { wallMs: 1e9, scriptSteps: 50_000 }).error).toBe(capped.error);
    expect(runOnce(engine, sub, "strict", "max", 1, 5, 40, { wallMs: 1e9 }).ok).toBe(true);
    // The runtime counts steps in the state, the same across a split run.
    const state = engine.initState(ruleScenario(sub, { runKind: "strict", tier: "max", every: 1, seed: 5 })).state;
    const whole = engine.run(state, 20).state.scripts!.steps!;
    const split = engine.run(engine.run(state, 10).state, 10).state.scripts!.steps!;
    expect(whole).toBeGreaterThan(20_000);
    expect(split).toBe(whole);
  });

  it("fails a run a script halts", () => {
    const sc = twoStep();
    sc.script = { source: "function onTick() { if (cycle >= 3) pause('stop') }" };
    const o = runOnce(engine, submissionFromScenario(sc), "strict", "max", 1, 5, 40, { wallMs: 60_000 });
    expect(o.ok).toBe(false);
    expect(o.error).toMatch(/script/);
  });

  it("verifyJob runs every cell and the outlier check compares seeds per frequency", () => {
    const outcomes = verifyJob(engine, {
      submission,
      runKind: "strict",
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
    const check = outlierCheck(engine, outcomes, "strict", {}, 2);
    expect(Object.keys(check.ratios).map(Number).sort()).toEqual([1, 3]);
    expect(check.ok).toBe(true);
    const strict = outlierCheck(engine, outcomes, "strict", {}, 0.5);
    expect(strict.ok).toBe(false);
    expect(referenceValue(engine, outcomes[0].result!, "borrow")).toBe(referenceValue(engine, outcomes[0].result!, "strict"));
  });
});

describe("cli", () => {
  it("version, check and verify modes", () => {
    const v = handle({ mode: "version" }) as { every: number[]; tiers: string[]; runKinds: string[] };
    expect(v.every).toEqual([...EVERY]);
    expect(v.runKinds).toEqual(["strict", "borrow", "normal"]);
    const file = submissionFile(submissionFromScenario(twoStep()));
    const c = handle({ mode: "check", payload: file }) as { ok: boolean };
    expect(c.ok).toBe(true);
    const lines: string[] = [];
    const r = handle({ mode: "verify", payload: file, runKind: "normal", tier: "mid", cycles: 1, runs: [{ every: 2, seed: 9, seedIndex: 0 }] }, (l) => lines.push(l)) as {
      runKind: string;
      results: { ok: boolean; result: RunResult }[];
      outlier: { ok: boolean };
    };
    // cycles are clamped up to the minimum (2000), then the end window: 2500 simulated cycles.
    expect(r.runKind).toBe("normal");
    expect(r.results[0].ok).toBe(true);
    expect(r.results[0].result.cycles).toBe(2500);
    expect(r.results[0].result.window).toEqual({ from: 2000, to: 2500, cuts: 21 });
    expect(lines).toEqual(["progress 1/1"]);
    // Old requests send a board: "ironman" is the strict run.
    const old = handle({ mode: "verify", payload: file, board: "ironman", tier: "max", cycles: 2000, runs: [] }) as { runKind: string };
    expect(old.runKind).toBe("strict");
    expect(() => handle({ mode: "verify", payload: file, runKind: "x" as never, tier: "max", runs: [] })).toThrow(/runKind/);
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
