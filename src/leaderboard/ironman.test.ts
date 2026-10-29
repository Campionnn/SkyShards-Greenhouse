import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEngine } from "../simulator/engine";
import type { SimulationState } from "../simulator/sim/state";
import { flow, layout, scenario, step, TIMER_ONLY } from "../simulator/testHelpers";
import { builderScenario, ownsKit } from "./builder/builder";
import { countSnapshot, RunRecorder, stitch, type CountSnapshot } from "./result";
import { CUT_STEP, endCycles, parseSubmission, ruleScenario, STITCH_TOLERANCE, submissionFromScenario, type Submission } from "./rules";
import { BUILDER_STEPS_PER_CYCLE, ironmanOutlierChecks, referenceValue, runIronman, runOnce, stitchCheckOf, verifyIronmanJob } from "./verify";

/**
 * Leaderboard v3's ironman run (docs/plans/leaderboard-v3.md §3): the borrow run, the builder
 * making the starting items, and the "from nothing" timeline, stitched or real.
 */

const engine = createEngine();
const npc = (r: Parameters<typeof referenceValue>[1]) => referenceValue(engine, r, "strict");

function fixture(name: string): { submission: Submission; cycles: number } {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").replace(/^\uFEFF/, ""));
  const parsed = parseSubmission(raw);
  if (!parsed.submission) throw new Error(parsed.errors.join("; "));
  // The aloe flow's scripts used forceEffects (refused under the rules): the plan's acceptance runs it without them.
  for (const p of parsed.submission.plots) if (p.script && /forceEffects/.test(p.script.source)) delete p.script;
  return { submission: parsed.submission, cycles: 2000 };
}

/** A flow whose rich step places one Chloronite (nothing grows it back): its kit is 1 Chloronite. Base crops are harvested. */
function chloroniteFlow(script?: string): Submission {
  const rich: [string, number, number][] = [];
  for (let r = 0; r < 10; r += 2) for (let c = 0; c < 10; c += 2) rich.push(["potato", r, c]);
  const sc = scenario([flow([step("rich", layout([["chloronite", 9, 9], ...rich])), step("poor", layout([["potato", 0, 0]]))], false)], { policies: { baseCropUpkeep: "harvestWhenGrown" } });
  if (script) sc.plots[0].script = { source: script };
  return submissionFromScenario(sc);
}

/** Leaves its rich step for good once the Chloronite stock reads below `threshold`: under borrowing it is -1, with the kit 0. */
const branchesOnStock = (threshold: number) => `let poor = false;\nfunction onSession() { if (!poor && inventory.get("chloronite") < ${threshold}) { poor = true; plot.goto("poor"); } }`;

const baseCrops = () => submissionFromScenario(scenario([flow([step("one", layout([["wheat", 0, 0], ["carrot", 0, 2]]))])], { policies: { baseCropUpkeep: "harvestWhenGrown" } }));

describe("recorder snapshots and the stitched timeline", () => {
  it("snapshot mode keeps the counts at the chosen cycles and leaves the result unchanged", () => {
    const sub = baseCrops();
    const sc = ruleScenario(sub, { runKind: "borrow", tier: "max", every: 2, seed: 3 });
    const run = (rec: RunRecorder) => {
      const s0 = engine.initState(sc).state;
      rec.observe(s0);
      return engine.run(s0, 150, { onCycle: (s) => rec.observe(s) }).state;
    };
    const plain = new RunRecorder(engine.data, { from: 100, to: 150 });
    const snap = new RunRecorder(engine.data, { from: 100, to: 150, snapshotAt: (c) => c % 25 === 0 });
    const a = run(plain);
    const b = run(snap);
    expect(JSON.stringify(snap.result(b, true))).toBe(JSON.stringify(plain.result(a, true)));
    expect([...snap.snapshots().keys()]).toEqual([0, 25, 50, 75, 100, 125, 150]);
    expect(snap.snapshots().get(150)).toEqual(countSnapshot(b));
  });

  it("stitch of a run with no builder part reproduces the run's own window means and trail", () => {
    const sub = baseCrops();
    const rec = new RunRecorder(engine.data, { from: 100, to: endCycles(100), snapshotAt: () => true });
    const s0 = engine.initState(ruleScenario(sub, { runKind: "borrow", tier: "max", every: 1, seed: 9 })).state;
    rec.observe(s0);
    const end = engine.run(s0, endCycles(100), { onCycle: (s) => rec.observe(s) }).state;
    const own = rec.result(end, true);
    const { cycles: _c, days: _d, window: _w, produced: _p, consumed: _co, bought: _b, shortfall: _s, bySource: _bs, trail: _t, ...rest } = own;
    void [_c, _d, _w, _p, _co, _b, _s, _bs, _t];
    const s = stitch({ from: 100, to: endCycles(100), prep: { kit: {}, cycles: 0, days: 0, done: true, mode: "stitched" }, prepEnd: null, flowAt: (n) => rec.snapshots().get(n), rest });
    expect(s.window).toEqual(own.window);
    expect(s.produced.wheat).toBeCloseTo(own.produced.wheat, 9);
    expect(s.trail!.from).toBe(own.trail!.from);
    expect(s.trail!.produced.wheat).toBeCloseTo(own.trail!.produced.wheat, 9);
    expect(s.days).toBeCloseTo(own.days, 9);
  });

  it("stitch joins the builder's counts to the flow's: counts(t) = prep + flow(t − T*), days(t) = prep days + flow days", () => {
    const at = (cycle: number, seconds: number, wheat: number): CountSnapshot => ({ cycle, seconds, produced: { wheat }, consumed: {}, bought: {}, shortfall: {}, bySource: { wheat: { wheat } } });
    const day = 86400;
    // Builder: 25 cycles, 1 day, 10 wheat. Flow: 1 wheat per cycle, a day per 25 cycles.
    const s = stitch({
      from: 50,
      to: 75,
      prep: { kit: { zombud: 1 }, cycles: 25, days: 1, done: true, mode: "stitched" },
      prepEnd: at(25, day, 10),
      flowAt: (n) => at(n, (n / 25) * day, n),
      rest: { built: {}, uptime: 1, sustainable: true, effort: { sessions: 0, avg: 0, peak: 0, byKind: {} }, halted: false },
    });
    // t = 50: (10 + 25) / 2 days; t = 75: (10 + 50) / 3 days.
    expect(s.window).toEqual({ from: 50, to: 75, cuts: 2 });
    expect(s.produced.wheat).toBeCloseTo((35 / 2 + 60 / 3) / 2, 9);
    expect(s.bySource!.wheat.wheat).toBeCloseTo((35 / 2 + 60 / 3) / 2, 9);
    expect(s.days).toBe(3);
    expect(s.prep).toEqual({ kit: { zombud: 1 }, cycles: 25, days: 1, done: true, mode: "stitched" });
    expect(() => stitch({ from: 50, to: 75, prep: s.prep!, prepEnd: at(25, day, 10), flowAt: () => undefined, rest: { built: {}, uptime: 1, sustainable: true, effort: s.effort, halted: false } })).toThrow(/no counts/);
  });
});

describe("runIronman: from nothing and with the starting items", () => {
  it("an empty kit: no builder, from nothing = with the starting items", () => {
    const o = runIronman(engine, baseCrops(), "max", 1, 4, 100, { wallMs: 60_000, check: true });
    expect(o.ok).toBe(true);
    expect(o.result!.startItems).toEqual({});
    expect(o.fromNothing!.prep).toEqual({ kit: {}, cycles: 0, days: 0, done: true, mode: "stitched" });
    expect(o.fromNothing!.produced).toEqual(o.result!.produced);
    expect(o.stitchCheck).toBeUndefined();
    // The borrow part is exactly v2's borrow run.
    expect(JSON.stringify(o.result)).toBe(JSON.stringify(runOnce(engine, baseCrops(), "borrow", "max", 1, 4, 100, { wallMs: 60_000 }).result));
  });

  it("the timeline by hand: the builder to T*, then the flow from exactly the kit under the strict rules", () => {
    const sub = chloroniteFlow();
    const C = 200;
    const total = endCycles(C);
    const o = runIronman(engine, sub, "max", 1, 2, C, { wallMs: 60_000, mode: "real" });
    expect(o.ok).toBe(true);
    const prep = o.fromNothing!.prep!;
    expect(prep.kit).toEqual({ chloronite: 1 });
    expect(prep.mode).toBe("real");
    expect(prep.done).toBe(true);
    expect(prep.cycles % CUT_STEP).toBe(0);
    // The builder from nothing until it owns the kit, then on to the next multiple of CUT_STEP.
    let b: SimulationState = engine.initState(builderScenario(prep.kit, { tier: "max", every: 1, seed: 2 })).state;
    let T = 0;
    while (!ownsKit(b.inventory, prep.kit)) b = engine.run(b, 1).state;
    T = Math.ceil(b.cycle / CUT_STEP) * CUT_STEP;
    b = engine.run(b, T - b.cycle).state;
    expect(T).toBe(prep.cycles);
    expect(b.elapsedSeconds / 86400).toBeCloseTo(prep.days, 9);
    // The flow, strict, starting with exactly the kit.
    let f = engine.initState(ruleScenario(sub, { runKind: "strict", tier: "max", every: 1, seed: 2 }, prep.kit)).state;
    expect(f.inventory.chloronite).toBe(0); // the setup placed the one Chloronite from the kit
    const rates: number[] = [];
    for (let t = C; t <= total; t += CUT_STEP) {
      f = engine.run(f, t - T - f.cycle).state;
      const potato = (b.ledger.potato?.produced ?? 0) + (f.ledger.potato?.produced ?? 0);
      rates.push(potato / ((b.elapsedSeconds + f.elapsedSeconds) / 86400));
    }
    expect(o.fromNothing!.window).toEqual({ from: C, to: total, cuts: rates.length });
    expect(o.fromNothing!.produced.potato).toBeCloseTo(rates.reduce((a, x) => a + x, 0) / rates.length, 6);
    // It carries the kit's details (the page's starting-items line reads them from either cell).
    expect(o.fromNothing!.startItems).toEqual(o.result!.startItems);
  });

  it("stitched = real when the flow doesn't read its stock; deterministic", () => {
    const sub = chloroniteFlow(branchesOnStock(-5));
    const a = runIronman(engine, sub, "max", 1, 1, 200, { wallMs: 60_000, check: true });
    expect(a.stitchCheck).toMatchObject({ ok: true });
    expect(a.stitchCheck!.diff).toBeLessThan(1e-9);
    expect(a.fromNothing!.prep!.mode).toBe("stitched");
    const b = runIronman(engine, sub, "max", 1, 1, 200, { wallMs: 60_000, check: true });
    expect(JSON.stringify(b.fromNothing)).toBe(JSON.stringify(a.fromNothing));
    // From nothing never beats with the starting items here (the builder's days are counted).
    expect(npc(a.fromNothing!)).toBeGreaterThan(0);
  });

  it("a script that branches on negative stock fails the sampled check, and the whole job runs real", () => {
    const sub = chloroniteFlow(branchesOnStock(0));
    const o = runIronman(engine, sub, "max", 1, 1, 200, { wallMs: 60_000, check: true });
    expect(o.stitchCheck!.ok).toBe(false);
    expect(o.stitchCheck!.diff).toBeGreaterThan(STITCH_TOLERANCE);
    expect(o.fromNothing!.prep!.mode).toBe("real");
    expect(npc(o.fromNothing!)).toBeCloseTo(o.stitchCheck!.real, 3);
    const job = verifyIronmanJob(engine, {
      submission: sub,
      tier: "max",
      cycles: 200,
      wallMsPerRun: 60_000,
      runs: [
        { every: 1, seed: 2, seedIndex: 1 },
        { every: 1, seed: 1, seedIndex: 0, check: true },
        { every: 2, seed: 3, seedIndex: 0, check: true },
      ],
    });
    expect(job.map((x) => x.seedIndex)).toEqual([1, 0, 0]);
    expect(job.map((x) => x.fromNothing!.prep!.mode)).toEqual(["real", "real", "real"]);
    // A job asked to run real does so without checking.
    const forced = verifyIronmanJob(engine, { submission: chloroniteFlow(branchesOnStock(-5)), tier: "max", cycles: 200, wallMsPerRun: 60_000, stitch: "real", runs: [{ every: 1, seed: 1, seedIndex: 0, check: true }] });
    expect(forced[0].fromNothing!.prep!.mode).toBe("real");
    expect(forced[0].stitchCheck).toBeUndefined();
    expect(stitchCheckOf(100, 101).ok).toBe(true);
    expect(stitchCheckOf(100, 102).ok).toBe(false);
    expect(stitchCheckOf(0, 0)).toMatchObject({ diff: 0, ok: true });
    expect(stitchCheckOf(0, 5).ok).toBe(false);
  });

  it("a flow with upkeep always runs real", () => {
    // A Chloronite that decays (timer only) and is re-placed on credit every time: the owed amount grows all run.
    const sub = submissionFromScenario(scenario([flow([step("one", layout([["chloronite", 5, 5], ["wheat", 0, 0]]))], false)]));
    const o = runIronman(TIMER_ONLY, sub, "max", 1, 5, 400, { wallMs: 60_000 });
    expect(o.ok).toBe(true);
    expect(Object.values(o.result!.upkeep ?? {}).some((v) => v > 0)).toBe(true);
    expect(o.fromNothing!.prep!.mode).toBe("real");
    expect(o.fromNothing!.upkeep).toEqual(o.result!.upkeep);
  });

  it("a kit the builder can't make by the author's length: the builder alone is the timeline (done false)", () => {
    // Zombud needs the Devourer chain's Fleshtrap: not in 20 cycles.
    const sub = submissionFromScenario(scenario([flow([step("one", layout([["zombud", 5, 5], ["wheat", 0, 0]]))], false)]));
    const C = 20;
    const o = runIronman(engine, sub, "max", 1, 5, C, { wallMs: 60_000 });
    expect(o.ok).toBe(true);
    expect(o.fromNothing!.prep).toMatchObject({ kit: { zombud: 1 }, done: false, cycles: endCycles(C) });
    expect(o.fromNothing!.window).toEqual({ from: C, to: endCycles(C), cuts: 1 });
    expect(o.fromNothing!.stepTime).toBeUndefined();
    expect(o.fromNothing!.produced.zombud ?? 0).toBe(0);
  });

  it("the builder has its own script step cap: it never counts towards the author's", () => {
    const sub = chloroniteFlow();
    // The author's flow has no script: a cap of 1 step passes, though the builder used millions.
    const o = runIronman(engine, sub, "max", 1, 1, 200, { wallMs: 60_000, scriptSteps: 1 });
    expect(o.ok).toBe(true);
    const capped = runIronman(engine, sub, "max", 1, 1, 200, { wallMs: 60_000, builderSteps: 10_000 });
    expect(capped.ok).toBe(false);
    expect(capped.error).toMatch(/starting-items builder used more than 10,000 script steps/);
    expect(capped.fromNothing).toBeNull();
    expect(BUILDER_STEPS_PER_CYCLE).toBeGreaterThan(100_000);
  });

  it("the outlier check covers both ironman variants", () => {
    const outcomes = [1, 2, 3].map((seed, i) => ({ ...runIronman(engine, chloroniteFlow(), "max", 1, seed, 200, { wallMs: 60_000 }), seedIndex: i }));
    const checks = ironmanOutlierChecks(engine, outcomes, 2);
    expect(checks.ironman.ok).toBe(true);
    expect(checks.ironman_kit.ok).toBe(true);
    expect(Object.keys(checks.ironman.ratios)).toEqual(["1"]);
  });
});

describe("runIronman on real flows (plan §9.2)", () => {
  const cases: [string, string][] = [
    ["Jellybean + Shadevine (o4GE)", "o4GE-jellybean-shadevine.json"],
    ["MAGA Jellybean + Shadevine", "maga-jellybean-shadevine.json"],
    ["the aloe flow", "aloe-flow.json"],
  ];
  for (const [name, file] of cases) {
    it(`${name}: stitched = real within ${STITCH_TOLERANCE * 100}% at every 1, and from nothing ≤ with the starting items`, { timeout: 120_000 }, () => {
      const { submission, cycles } = fixture(file);
      const o = runIronman(engine, submission, "max", 1, 1, cycles, { wallMs: 600_000, check: true });
      expect(o.ok).toBe(true);
      expect(o.stitchCheck).toBeDefined();
      expect(o.stitchCheck!.diff).toBeLessThanOrEqual(STITCH_TOLERANCE);
      expect(o.fromNothing!.prep!.mode).toBe("stitched");
      expect(o.fromNothing!.prep!.done).toBe(true);
      expect(Object.keys(o.fromNothing!.prep!.kit).length).toBeGreaterThan(0);
      expect(npc(o.fromNothing!)).toBeLessThanOrEqual(referenceValue(engine, o.result!, "borrow"));
    });
  }

  it("an upkeep flow (the chorus test) runs real, and makes less from nothing than with the starting items", { timeout: 120_000 }, () => {
    const { submission, cycles } = fixture("chorus-test.json");
    const o = runIronman(engine, submission, "max", 1, 1, cycles, { wallMs: 600_000, check: true });
    expect(o.ok).toBe(true);
    expect(o.fromNothing!.prep!.mode).toBe("real");
    expect(o.stitchCheck).toBeUndefined();
    expect(npc(o.fromNothing!)).toBeLessThan(referenceValue(engine, o.result!, "borrow"));
  });
});
