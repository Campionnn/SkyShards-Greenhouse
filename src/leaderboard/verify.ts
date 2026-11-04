import type { Engine } from "../simulator/engine";
import { DEFAULT_BAZAAR_PRICING, type BazaarQuote } from "../simulator/economy/bazaar";
import type { ItemId } from "../simulator/data/types";
import type { Scenario, SimulationState } from "../simulator/sim/state";
import { builderScenario, kitEmpty, kitOf, ownsKit, type Kit } from "./builder/builder";
import { valueResult } from "./pricing";
import { countSnapshot, RunRecorder, spreadRatio, stitch, timelineCycles, trailResult, trailStart, type CountSnapshot, type PrepInfo, type RecorderPlan, type RunResult, type TimelineRest } from "./result";
import { CUT_STEP, endCycles, ruleScenario, STITCH_TOLERANCE, TRAIL_MIN, type RuleKind, type Submission } from "./rules";
import type { TierId } from "./tiers";

/**
 * Verification runs (docs/plans/flow-leaderboard.md §6.2, §6.3, docs/plans/leaderboard-boards-v2.md
 * §4.3, docs/plans/leaderboard-v3.md §3): simulate a submission under the rules for a list of
 * (every, seed) cells and summarise each as a `RunResult`. Each run goes `endCycles(cycles)`
 * cycles: the author's length plus the secret end window the score is averaged over. A normal job
 * is one engine set-up (`verifyJob`); an ironman job is the borrow run plus the "from nothing"
 * timeline (`verifyIronmanJob`). Framework-free so the CLI bundle and the page's local test both
 * use it.
 */

export interface VerifyRun {
  every: number;
  seed: number;
  seedIndex: number;
}

export interface VerifyJob {
  submission: Submission;
  /** The engine set-up every run uses. */
  rules: RuleKind;
  tier: TierId;
  /** The author's length C (already clamped); each run simulates `endCycles(C)`. */
  cycles: number;
  runs: VerifyRun[];
  /** Wall-clock backstop per run (catches a stuck process); a run over it fails. */
  wallMsPerRun: number;
  /**
   * CPU-time backstop per run, where the runtime can measure it (Node). Generous on purpose: CPU
   * time depends on the machine (a Cloud Run vCPU is about half a VPS core), so it must never be
   * what decides a normal flow. The deciding limit is the deterministic `scriptStepsPerRun`.
   */
  cpuMsPerRun?: number;
  /** Interpreter steps all scripts may use in one run (deterministic: same verdict on every machine); default scriptStepCap(endCycles(cycles)). */
  scriptStepsPerRun?: number;
}

/**
 * Script work a run may do, in interpreter steps per simulated cycle (averaged over the run).
 * Engine work per cycle is bounded by the grid (3 plots, cycles <= MAX_CYCLES), so scripts are
 * the only unbounded part; capping their steps makes "too slow" a property of the flow, not of
 * the machine verifying it. Shared by the CLI and the page's local test.
 */
// ~26M steps/s on a desktop core, ~13M on the VPS, ~6M on a Cloud Run vCPU: 200M steps (2000
// cycles) is ~15 s of script work on the VPS, and 500M (5000 cycles) stays well inside the CPU
// backstop even on Cloud Run.
export const SCRIPT_STEPS_PER_CYCLE = 100_000;
/** The step cap of a run of `cycles` simulated cycles. */
export const scriptStepCap = (cycles: number): number => SCRIPT_STEPS_PER_CYCLE * Math.max(1, Math.floor(cycles));
/** CPU-time backstop (ms) for anything the step cap doesn't cover. */
export const CPU_MS_BACKSTOP = 300_000;
/** Wall-clock backstop (ms) against a stuck process. */
export const WALL_MS_BACKSTOP = 600_000;

export interface VerifyRunOutcome {
  every: number;
  seedIndex: number;
  seed: number;
  ok: boolean;
  error: string | null;
  result: RunResult | null;
  wallMs: number;
  /** CPU time the run used (null where the runtime can't measure it, e.g. a browser). */
  cpuMs: number | null;
}

/** Cycles per `engine.run` slice between clock checks. */
const SLICE = 100;

type CpuUsage = () => { user: number; system: number };

/** Process CPU time in ms (Node), or undefined in a browser. */
function processCpuClock(): (() => number) | undefined {
  const usage = (globalThis as { process?: { cpuUsage?: CpuUsage } }).process?.cpuUsage;
  if (typeof usage !== "function") return undefined;
  return () => {
    const u = usage();
    return (u.user + u.system) / 1000;
  };
}

const seconds = (ms: number) => Math.round(ms / 1000);

export interface RunOnceOptions {
  /** Wall-clock cap. */
  wallMs: number;
  /** CPU-time cap; ignored when there is no CPU clock. */
  cpuMs?: number;
  /** Script step cap (ScriptsState.steps); defaults to scriptStepCap(endCycles(cycles)). */
  scriptSteps?: number;
  now?: () => number;
  /** CPU clock in ms (defaults to the process's, where available). */
  cpuNow?: () => number;
  /** Called after every slice with the cycles done (of `endCycles(cycles)`). */
  onProgress?: (done: number, total: number) => void;
}

/** One clock for a whole seed (the borrow run, the builder and a real run share the backstops). */
interface RunClock {
  now: () => number;
  t0: number;
  cpuUsed: () => number | null;
  wallMs: number;
  cpuMs?: number;
}

function startClock(opts: RunOnceOptions): RunClock {
  const now = opts.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const cpuNow = opts.cpuNow ?? processCpuClock();
  const t0 = now();
  const c0 = cpuNow?.() ?? 0;
  return { now, t0, cpuUsed: () => (cpuNow ? cpuNow() - c0 : null), wallMs: opts.wallMs, cpuMs: opts.cpuMs };
}

/** The backstop a clock is over, as the run's error ("... (done of total cycles)"), or null. */
function backstop(clock: RunClock, progress: string): string | null {
  const cpu = clock.cpuUsed();
  if (clock.cpuMs !== undefined && cpu !== null && cpu > clock.cpuMs) return `used more than ${seconds(clock.cpuMs)} s of CPU time (${progress})`;
  if (clock.now() - clock.t0 > clock.wallMs) return `took longer than ${seconds(clock.wallMs)} s (${progress})`;
  return null;
}

interface Simulated {
  ok: boolean;
  error: string | null;
  /** The run's result (also for a script halt; null when the step cap or a backstop stopped it). */
  result: RunResult | null;
  recorder: RunRecorder | null;
}

/**
 * Simulate a scenario for `total` cycles under a recorder, in SLICE-cycle slices with the caps
 * checked between them: a script halt or truncation fails the run, as does going over the script
 * step cap (deterministic) or a backstop of `clock`. Never throws for a scenario the engine rejects.
 */
function simulate(engine: Engine, scenario: Scenario, plan: RecorderPlan, total: number, clock: RunClock, stepCap: number, onProgress?: (done: number, total: number) => void): Simulated {
  let state: SimulationState;
  try {
    state = engine.initState(scenario).state;
  } catch (e) {
    return { ok: false, error: `invalid scenario: ${e instanceof Error ? e.message : String(e)}`, result: null, recorder: null };
  }
  const recorder = new RunRecorder(engine.data, plan);
  recorder.observe(state);
  const onCycle = (s: SimulationState) => recorder.observe(s);
  let done = 0;
  while (done < total) {
    const n = Math.min(SLICE, total - done);
    // "none": the run reads only the state; events are counted, never built.
    const r = engine.run(state, n, { retainEvents: "none", onCycle });
    state = r.state;
    done += r.cyclesRun;
    onProgress?.(done, total);
    if (r.truncated || state.scripts?.halt) {
      const halt = state.scripts?.halt;
      const why = halt ? `script ${halt.kind}${halt.message ? `: ${halt.message}` : ""} at cycle ${state.cycle}` : `run stopped at cycle ${state.cycle}`;
      return { ok: false, error: why, result: recorder.result(state, engine.analyse(state).sustainable), recorder };
    }
    const steps = state.scripts?.steps ?? 0;
    if (steps > stepCap) return { ok: false, error: `scripts used more than ${stepCap.toLocaleString("en-US")} steps (${done} of ${total} cycles)`, result: null, recorder };
    const over = backstop(clock, `${done} of ${total} cycles`);
    if (over) return { ok: false, error: over, result: null, recorder };
  }
  return { ok: true, error: null, result: recorder.result(state, engine.analyse(state).sustainable), recorder };
}

/**
 * Simulate one cell to the end of its window (or the cap). `cycles` is the author's length C.
 * Never throws for a scenario the engine rejects: returns the error.
 */
export function runOnce(engine: Engine, submission: Submission, rules: RuleKind, tier: TierId, every: number, seed: number, cycles: number, opts: RunOnceOptions): VerifyRunOutcome {
  const clock = startClock(opts);
  const total = endCycles(cycles);
  const sim = simulate(engine, ruleScenario(submission, { rules, tier, every, seed }), { from: Math.max(1, Math.floor(cycles)), to: total }, total, clock, opts.scriptSteps ?? scriptStepCap(total), opts.onProgress);
  return { every, seedIndex: -1, seed, ok: sim.ok, error: sim.error, result: sim.result, wallMs: clock.now() - clock.t0, cpuMs: clock.cpuUsed() };
}

// ---- Leaderboard v3: the ironman run ("from nothing" and "with the starting items") -------------

/**
 * Script work the starting-items builder may do per simulated cycle. It is the site's own script,
 * not the author's: its steps never count towards the flow's cap. It uses ~42k steps per cycle
 * online every cycle (~71k at most in one cycle); this is a safety net against a builder bug.
 */
export const BUILDER_STEPS_PER_CYCLE = 200_000;

/** The sampled stitch check of one run: the stitched and the real "from nothing" values (NPC coins/day). */
export interface StitchCheck {
  stitched: number;
  real: number;
  /** |real − stitched| / stitched (Infinity when stitched ≤ 0 < real; 0 when both ≤ 0). */
  diff: number;
  /** diff ≤ STITCH_TOLERANCE. */
  ok: boolean;
}

/** One seed of an ironman job: the borrow run (`result`, "with the starting items") and the "from nothing" timeline. */
export interface IronmanOutcome extends VerifyRunOutcome {
  /** The "from nothing" timeline (builder first, then the flow from exactly the kit); null when the seed failed. */
  fromNothing: RunResult | null;
  /** Only on a sampled check run whose flow part could be stitched. */
  stitchCheck?: StitchCheck;
}

export interface IronmanOptions extends RunOnceOptions {
  /** "auto": stitch the flow part from the borrow run when that is valid (no upkeep); "real": always run it. */
  mode?: "auto" | "real";
  /** A sampled run (STITCH_SAMPLE): also run the flow part for real and compare (`stitchCheck`). */
  check?: boolean;
  /** The builder's own script step cap; default BUILDER_STEPS_PER_CYCLE × endCycles(cycles). */
  builderSteps?: number;
}

/** `diff` of a stitch check (see StitchCheck). */
export function stitchDiff(stitched: number, real: number): number {
  if (stitched > 0) return Math.abs(real - stitched) / stitched;
  return real > 0 ? Infinity : 0;
}

/** The stitched / real check of two values against STITCH_TOLERANCE. */
export function stitchCheckOf(stitched: number, real: number, tolerance = STITCH_TOLERANCE): StitchCheck {
  const diff = stitchDiff(stitched, real);
  return { stitched, real, diff, ok: diff <= tolerance };
}

/** Whether a borrow result has upkeep (a positive per-day growth of what it owes). */
const hasUpkeep = (r: RunResult): boolean => Object.values(r.upkeep ?? {}).some((v) => v > 0);

/** The borrow result's starting-item fields, which every "from nothing" result carries too. */
function kitFields(r: RunResult): Pick<RunResult, "startItems" | "sessionOnly" | "usedUp" | "upkeep"> {
  const out: Pick<RunResult, "startItems" | "sessionOnly" | "usedUp" | "upkeep"> = {};
  if (r.startItems) out.startItems = { ...r.startItems };
  if (r.sessionOnly) out.sessionOnly = [...r.sessionOnly];
  if (r.usedUp) out.usedUp = { ...r.usedUp };
  if (r.upkeep) out.upkeep = { ...r.upkeep };
  return out;
}

/** A result's non-count fields for a timeline (`stitch`'s `rest`), without `cantStart` (v3 replaces it with `prep.done`). */
function restOf(r: RunResult): TimelineRest {
  const { cycles: _c, days: _d, window: _w, produced: _p, consumed: _co, bought: _b, shortfall: _s, bySource: _bs, trail: _t, prep: _pr, cantStart: _cs, ...rest } = r;
  void [_c, _d, _w, _p, _co, _b, _s, _bs, _t, _pr, _cs];
  return rest;
}

/** The residues mod CUT_STEP of every cycle a timeline may read (its cuts, the trail's start, the end). */
function timelineResidues(from: number, to: number): Set<number> {
  const mod = (n: number) => ((n % CUT_STEP) + CUT_STEP) % CUT_STEP;
  return new Set([mod(from), mod(trailStart(to)), mod(to)]);
}

interface BuilderRun {
  ok: boolean;
  error: string | null;
  /** The cycle the builder first owned the kit (null: not by the limit). */
  owned: number | null;
  /** Simulated days at `owned`. */
  madeDays: number | null;
  /** T*: where the flow starts (a multiple of CUT_STEP), or the timeline's end when not done. */
  cycles: number;
  days: number;
  done: boolean;
  /** Counts at `cycles`. */
  end: CountSnapshot | null;
  /** Counts at the timeline cycles the stitch may read before T*. */
  snaps: Map<number, CountSnapshot>;
  /** The builder's state at `cycles`. */
  state: SimulationState | null;
  /** Not done: the builder's stock of each kit item at C (capped at the kit). */
  have?: Record<string, number>;
}

/**
 * The builder from an empty inventory (builder.ts builderScenario) until it owns `kit` or reaches
 * cycle `C`. Owned at T ≤ C: it keeps running (its goal met, it sits in its done step) to
 * T* = ceil(T / CUT_STEP) × CUT_STEP, where the flow starts. Not owned by C: it stops at C
 * (`done` false; `have` = what it held of the kit then).
 */
function runBuilder(engine: Engine, kit: Kit, spec: { tier: TierId; every: number; seed: number }, C: number, to: number, clock: RunClock, stepCap: number, keep: Set<number>, onProgress?: (done: number) => void): BuilderRun {
  const fail = (error: string): BuilderRun => ({ ok: false, error: `the starting-items builder ${error}`, owned: null, madeDays: null, cycles: 0, days: 0, done: false, end: null, snaps: new Map(), state: null });
  let state: SimulationState;
  try {
    state = engine.initState(builderScenario(kit, spec)).state;
  } catch (e) {
    return fail(`could not start: ${e instanceof Error ? e.message : String(e)}`);
  }
  const snaps = new Map<number, CountSnapshot>();
  const watch = (s: SimulationState) => {
    if (keep.has(((s.cycle % CUT_STEP) + CUT_STEP) % CUT_STEP)) snaps.set(s.cycle, countSnapshot(s));
  };
  watch(state);
  // Only owning the kit by cycle C counts; T* = the next multiple of CUT_STEP.
  let owned: number | null = null;
  let madeDays: number | null = null;
  const tStar = (t: number) => Math.ceil(t / CUT_STEP) * CUT_STEP;
  let limit = C;
  while (state.cycle < limit) {
    const r = engine.run(state, Math.min(SLICE, limit - state.cycle), {
      retainEvents: "none",
      onCycle: (s) => {
        watch(s);
        if (owned === null && s.cycle <= C && ownsKit(s.inventory, kit)) {
          owned = s.cycle;
          madeDays = s.elapsedSeconds / 86400;
          return true; // re-plan the limit: run on to T*
        }
      },
    });
    state = r.state;
    if (state.scripts?.halt) return fail(`stopped: script ${state.scripts.halt.kind}${state.scripts.halt.message ? `: ${state.scripts.halt.message}` : ""} at cycle ${state.cycle}`);
    if (r.cyclesRun === 0) return fail(`stopped at cycle ${state.cycle}`);
    if ((state.scripts?.steps ?? 0) > stepCap) return fail(`used more than ${stepCap.toLocaleString("en-US")} script steps (cycle ${state.cycle})`);
    const over = backstop(clock, `starting-items builder, cycle ${state.cycle}`);
    if (over) return { ...fail(""), error: over };
    onProgress?.(state.cycle);
    // T* never passes the run's end (only possible for lengths under 100 cycles, i.e. tests).
    if (owned !== null) limit = Math.min(tStar(owned), to);
    // Not owned by C: it stops there (the flow can't start in time; nothing of the builder's is scored).
  }
  const done = owned !== null;
  const have: Record<string, number> = {};
  if (!done) for (const item of Object.keys(kit)) have[item] = Math.max(0, Math.min(kit[item], Math.floor(state.inventory[item] ?? 0)));
  return { ok: true, error: null, owned, madeDays, cycles: state.cycle, days: state.elapsedSeconds / 86400, done, end: countSnapshot(state), snaps, state, have };
}

/**
 * One seed of an ironman job (docs/plans/leaderboard-v3.md §3): the borrow run (v2's "with
 * starting items"), then the "from nothing" timeline: the frozen builder makes the borrow run's
 * starting items (kit = ceil(startItems)), then the flow runs from exactly the kit under the
 * strict rules. The flow part is stitched from the borrow run's own snapshots when that is valid
 * (no upkeep: the kit covers the most ever owed, so the placements are the same) and run for real
 * otherwise (or always, with `mode: "real"`). A `check` run does both and reports `stitchCheck`;
 * when the two differ by more than STITCH_TOLERANCE it returns the real one.
 *
 * Caps: the author's script step cap applies to each flow run; the builder has its own
 * (`builderSteps`); the CPU and wall backstops cover the whole seed. Any failure fails the seed
 * (`ok` false, `fromNothing` null). Never throws for a scenario the engine rejects.
 */
export function runIronman(engine: Engine, submission: Submission, tier: TierId, every: number, seed: number, cycles: number, opts: IronmanOptions): IronmanOutcome {
  const clock = startClock(opts);
  const C = Math.max(1, Math.floor(cycles));
  const total = endCycles(C);
  const residues = timelineResidues(C, total);
  // Cycle 0 too: a flow started at the very end (lengths under 100 cycles) reads only it.
  const keep = (c: number) => c === 0 || residues.has(((c % CUT_STEP) + CUT_STEP) % CUT_STEP);
  const flowSteps = opts.scriptSteps ?? scriptStepCap(total);
  // Progress: the borrow run is the first `total`, the builder and the flow part the second.
  const progress = (done: number) => opts.onProgress?.(Math.min(2 * total, done), 2 * total);
  const out = (ok: boolean, error: string | null, result: RunResult | null, fromNothing: RunResult | null, stitchCheck?: StitchCheck): IronmanOutcome => {
    const o: IronmanOutcome = { every, seedIndex: -1, seed, ok, error, result, fromNothing, wallMs: clock.now() - clock.t0, cpuMs: clock.cpuUsed() };
    if (stitchCheck) o.stitchCheck = stitchCheck;
    return o;
  };

  // 1. The borrow run, with snapshots at every cycle a stitched timeline may read.
  const borrow = simulate(engine, ruleScenario(submission, { rules: "borrow", tier, every, seed }), { from: C, to: total, snapshotAt: keep }, total, clock, flowSteps, (d) => progress(d));
  if (!borrow.ok || !borrow.result || !borrow.recorder) return out(false, borrow.error, borrow.result, null);
  const kitResult = borrow.result;
  const kit = kitOf(kitResult.startItems);
  const upkeep = hasUpkeep(kitResult);
  const real = opts.mode === "real" || upkeep;
  const snapsOf = (rec: RunRecorder) => (n: number) => rec.snapshots().get(n);

  // 2. The builder (none for an empty kit).
  let prepRun: BuilderRun | null = null;
  if (!kitEmpty(kit)) {
    const builderCap = opts.builderSteps ?? BUILDER_STEPS_PER_CYCLE * total;
    prepRun = runBuilder(engine, kit, { tier, every, seed }, C, total, clock, builderCap, residues, (c) => progress(total + c));
    if (!prepRun.ok) return out(false, prepRun.error, kitResult, null);
  }
  const T = prepRun ? prepRun.cycles : 0;
  const prep: PrepInfo = { kit, cycles: T, days: prepRun ? prepRun.days : 0, done: prepRun ? prepRun.done : true, mode: "stitched" };
  if (prepRun?.madeDays != null) prep.madeDays = prepRun.madeDays;
  const prepAt = prepRun ? (t: number) => prepRun.snaps.get(t) : undefined;

  const npc = (r: RunResult) => referenceValue(engine, r, "strict");

  // Not done by C: the flow can't start in time. An empty result (nothing of the builder's is
  // scored); the page lists it apart, with what the builder had made by then.
  if (!prep.done && prepRun) {
    const empty: RunResult = { ...restOf(kitResult), ...kitFields(kitResult), cycles: total, days: prepRun.days, window: { from: C, to: total, cuts: 0 }, produced: {}, consumed: {}, bought: {}, shortfall: {}, bySource: {}, built: {} };
    delete empty.stepTime;
    delete empty.starved;
    delete empty.ramp;
    empty.prep = { ...prep, mode: real ? "real" : "stitched", slow: false, have: prepRun.have ?? {} };
    progress(2 * total);
    return out(true, null, kitResult, empty);
  }

  // An empty kit without upkeep: the flow never owes anything, so from nothing = with the starting items.
  if (kitEmpty(kit) && !real) {
    progress(2 * total);
    return out(true, null, kitResult, { ...kitResult, prep: { ...prep, credit: "timeline" } });
  }

  // 3. The flow part from T*: stitched from the borrow run, or a real strict run from exactly the kit.
  // Each gives two results over the same cuts (see `score`): A, the timeline (the builder's days
  // and crops, then the flow), and F, the flow alone at the same ages (no builder at all).
  const NONE: CountSnapshot = { cycle: 0, seconds: 0, produced: {}, consumed: {}, bought: {}, shortfall: {}, bySource: {} };
  const pair = (flowAt: (n: number) => CountSnapshot | undefined, rest: TimelineRest, mode: PrepInfo["mode"]): { A: RunResult; F: RunResult } => {
    const p = { ...prep, mode };
    return {
      A: stitch({ from: C, to: total, prep: p, prepEnd: prepRun?.end ?? null, flowAt, prepAt, rest }),
      F: stitch({ from: C, to: total, prep: p, prepEnd: NONE, flowAt, prepAt: () => NONE, rest }),
    };
  };
  /**
   * Leaderboard v3.1: the seed's "from nothing" result. The timeline A, unless the flow alone F is
   * worth less (the builder out-earns the flow, so its crops mustn't lift it), and never more than
   * "with the starting items" K (whole results, never mixed). `slow`: the trail (the flow's own end
   * rate, the same in A and F) under TRAIL_MIN × the flow's own rate (K's when capped).
   */
  const score = ({ A, F }: { A: RunResult; F: RunResult }): RunResult => {
    const vF = npc(F);
    let chosen = A;
    let credit: PrepInfo["credit"] = "timeline";
    if (vF < npc(A)) {
      chosen = F;
      credit = "flow";
    }
    if (npc(chosen) > npc(kitResult)) {
      chosen = { ...kitResult };
      credit = "kit";
    }
    const base = credit === "kit" ? npc(kitResult) : vF;
    const slow = !!chosen.trail && base > 0 && npc(trailResult(chosen)) < TRAIL_MIN * base;
    return { ...chosen, prep: { ...(A.prep as PrepInfo), credit, slow } };
  };
  const stitched = () => pair(snapsOf(borrow.recorder!), { ...restOf(kitResult), ...kitFields(kitResult) }, "stitched");
  const runReal = (): { ok: true; pair: { A: RunResult; F: RunResult } } | { ok: false; error: string } => {
    const length = total - T;
    const need = timelineCycles(C, total, T);
    const sim = simulate(engine, ruleScenario(submission, { rules: "strict", tier, every, seed }, kit), { from: Math.max(0, C - T), to: length, snapshotAt: (c) => need.has(c) }, length, clock, flowSteps, (d) => progress(total + T + d));
    if (!sim.ok || !sim.result || !sim.recorder) return { ok: false, error: sim.error ?? "the run from the starting items failed" };
    return { ok: true, pair: pair(snapsOf(sim.recorder), { ...restOf(sim.result), ...kitFields(kitResult) }, "real") };
  };

  if (real) {
    const r = runReal();
    progress(2 * total);
    return r.ok ? out(true, null, kitResult, score(r.pair)) : out(false, r.error, kitResult, null);
  }
  const s = stitched();
  if (!opts.check) {
    progress(2 * total);
    return out(true, null, kitResult, score(s));
  }
  const r = runReal();
  progress(2 * total);
  if (!r.ok) return out(false, r.error, kitResult, null);
  // The check compares the flow alone (F): the builder part is the same in both.
  const check = stitchCheckOf(npc(s.F), npc(r.pair.F));
  const real1 = score(r.pair);
  const o = out(true, null, kitResult, check.ok ? score(s) : real1, check);
  if (check.ok) checkedReal.set(o, real1);
  return o;
}

/** A passed check run's real "from nothing" result, kept so a job that turns real later needn't simulate it again. */
const checkedReal = new WeakMap<IronmanOutcome, RunResult>();

/** A run of an ironman job; `check` marks a sampled run (STITCH_SAMPLE). */
export interface IronmanRun extends VerifyRun {
  check?: boolean;
}

export interface IronmanJob extends Omit<VerifyJob, "rules" | "runs"> {
  runs: IronmanRun[];
  /** "real": every run's flow part runs for real (the API asks after a failed check in another lane). */
  stitch?: "auto" | "real";
  builderStepsPerRun?: number;
}

/**
 * Run every seed of an ironman job (outcomes in the request's order). The sampled check runs go
 * first; when one fails, the rest of the job runs real, and any run already stitched is run again
 * for real, so a job is stitched or real as a whole.
 */
export function verifyIronmanJob(engine: Engine, job: IronmanJob, onProgress?: (done: number, total: number) => void): IronmanOutcome[] {
  const order = job.runs.map((r, i) => ({ r, i })).sort((a, b) => Number(!!b.r.check) - Number(!!a.r.check) || a.i - b.i);
  const outcomes: IronmanOutcome[] = new Array(job.runs.length);
  let real = job.stitch === "real";
  const opts = (check: boolean): IronmanOptions => ({ wallMs: job.wallMsPerRun, cpuMs: job.cpuMsPerRun, scriptSteps: job.scriptStepsPerRun, builderSteps: job.builderStepsPerRun, mode: real ? "real" : "auto", check: check && !real });
  let done = 0;
  for (const { r, i } of order) {
    const o = runIronman(engine, job.submission, job.tier, r.every, r.seed, job.cycles, opts(!!r.check));
    o.seedIndex = r.seedIndex;
    outcomes[i] = o;
    if (o.stitchCheck && !o.stitchCheck.ok) real = true;
    onProgress?.(++done, job.runs.length);
  }
  if (real && job.stitch !== "real") {
    // A check failed after some runs were stitched: those runs again, for real (a passed check run
    // already has its real result). Runs without a flow part (no kit, or the builder never
    // finished) have nothing to stitch.
    for (let i = 0; i < outcomes.length; i++) {
      const o = outcomes[i];
      const prep = o.fromNothing?.prep;
      if (!o.ok || !prep || prep.mode !== "stitched" || !prep.done || kitEmpty(prep.kit)) continue;
      const known = checkedReal.get(o);
      if (known) {
        outcomes[i] = { ...o, fromNothing: known };
        continue;
      }
      const r = job.runs[i];
      const again = runIronman(engine, job.submission, job.tier, r.every, r.seed, job.cycles, opts(false));
      again.seedIndex = r.seedIndex;
      outcomes[i] = again;
    }
  }
  return outcomes;
}

/** The outlier check of both ironman variants: "from nothing" (`fromNothing`) and "with the starting items" (`result`). */
export function ironmanOutlierChecks(engine: Engine, outcomes: readonly IronmanOutcome[], ratio: number): { ironman: OutlierCheck; ironman_kit: OutlierCheck } {
  const fromNothing = outcomes.map((o) => ({ ...o, result: o.fromNothing }));
  return { ironman: outlierCheck(engine, fromNothing, "strict", {}, ratio), ironman_kit: outlierCheck(engine, outcomes, "borrow", {}, ratio) };
}

/** Run every cell of a job in order. */
export function verifyJob(engine: Engine, job: VerifyJob, onProgress?: (done: number, total: number) => void): VerifyRunOutcome[] {
  const outcomes: VerifyRunOutcome[] = [];
  job.runs.forEach((r, i) => {
    const o = runOnce(engine, job.submission, job.rules, job.tier, r.every, r.seed, job.cycles, { wallMs: job.wallMsPerRun, cpuMs: job.cpuMsPerRun, scriptSteps: job.scriptStepsPerRun });
    o.seedIndex = r.seedIndex;
    outcomes.push(o);
    onProgress?.(i + 1, job.runs.length);
  });
  return outcomes;
}

/** A run kind's reference valuation of a result (coins per day): NPC for the ironman kinds, the given Bazaar quotes for normal. */
export function referenceValue(engine: Engine, r: RunResult, rules: RuleKind, quotes: Readonly<Record<ItemId, BazaarQuote>> = {}): number {
  return valueResult(engine.data, r, rules === "normal" ? "normal" : "ironman", quotes, DEFAULT_BAZAAR_PRICING).profitPerDay;
}

export interface OutlierCheck {
  ok: boolean;
  /** best / median per frequency, for the message. */
  ratios: Record<number, number>;
  worst: { every: number; ratio: number } | null;
}

/**
 * The consistency check (§6.3): at every frequency, the best seed's value may not exceed the
 * median seed's value by more than `ratio`. Uses a reference valuation (NPC for ironman, the
 * server's Bazaar snapshot for normal).
 */
export function outlierCheck(
  engine: Engine,
  outcomes: readonly VerifyRunOutcome[],
  rules: RuleKind,
  quotes: Readonly<Record<ItemId, BazaarQuote>>,
  ratio: number
): OutlierCheck {
  const byEvery = new Map<number, number[]>();
  for (const o of outcomes) {
    if (!o.ok || !o.result) continue;
    const v = referenceValue(engine, o.result, rules, quotes);
    (byEvery.get(o.every) ?? byEvery.set(o.every, []).get(o.every)!).push(v);
  }
  const ratios: Record<number, number> = {};
  let worst: OutlierCheck["worst"] = null;
  for (const [every, values] of byEvery) {
    const r = spreadRatio(values);
    ratios[every] = r;
    if (!worst || r > worst.ratio) worst = { every, ratio: r };
  }
  return { ok: !worst || worst.ratio <= ratio, ratios, worst };
}
