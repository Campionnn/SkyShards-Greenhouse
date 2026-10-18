import type { Engine } from "../simulator/engine";
import { DEFAULT_BAZAAR_PRICING, type BazaarQuote } from "../simulator/economy/bazaar";
import type { ItemId } from "../simulator/data/types";
import { valueResult } from "./pricing";
import { runResult, spreadRatio, type RunResult } from "./result";
import { ruleScenario, type Board, type Submission } from "./rules";
import type { TierId } from "./tiers";

/**
 * Verification runs (docs/plans/flow-leaderboard.md §6.2, §6.3): simulate a submission under the
 * rules for a list of (every, seed) cells and summarise each as a `RunResult`. Framework-free so
 * the CLI bundle and the page's local test both use it.
 */

export interface VerifyRun {
  every: number;
  seed: number;
  seedIndex: number;
}

export interface VerifyJob {
  submission: Submission;
  board: Board;
  tier: TierId;
  cycles: number;
  runs: VerifyRun[];
  /** Wall-clock backstop per run (catches a stuck process); a run over it fails. */
  wallMsPerRun: number;
  /**
   * CPU-time cap per run, where the runtime can measure it (Node). This is the real "too slow"
   * limit: unlike wall time it does not grow when other work on the machine competes for the CPU.
   */
  cpuMsPerRun?: number;
}

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
  now?: () => number;
  /** CPU clock in ms (defaults to the process's, where available). */
  cpuNow?: () => number;
  /** Called after every slice with the cycles done. */
  onProgress?: (done: number, total: number) => void;
}

/** Simulate one cell to completion (or the cap). Never throws for a scenario the engine rejects: returns the error. */
export function runOnce(engine: Engine, submission: Submission, board: Board, tier: TierId, every: number, seed: number, cycles: number, opts: RunOnceOptions): VerifyRunOutcome {
  const now = opts.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const cpuNow = opts.cpuNow ?? processCpuClock();
  const t0 = now();
  const c0 = cpuNow?.() ?? 0;
  const cpuUsed = () => (cpuNow ? cpuNow() - c0 : null);
  const out = (ok: boolean, error: string | null, result: RunResult | null): VerifyRunOutcome => ({ every, seedIndex: -1, seed, ok, error, result, wallMs: now() - t0, cpuMs: cpuUsed() });
  let state;
  try {
    state = engine.initState(ruleScenario(submission, { board, tier, every, seed })).state;
  } catch (e) {
    return out(false, `invalid scenario: ${e instanceof Error ? e.message : String(e)}`, null);
  }
  let done = 0;
  while (done < cycles) {
    const n = Math.min(SLICE, cycles - done);
    const r = engine.run(state, n, { retainEvents: "summary" });
    state = r.state;
    done += r.cyclesRun;
    opts.onProgress?.(done, cycles);
    if (r.truncated || state.scripts?.halt) {
      const halt = state.scripts?.halt;
      const why = halt ? `script ${halt.kind}${halt.message ? `: ${halt.message}` : ""} at cycle ${state.cycle}` : `run stopped at cycle ${state.cycle}`;
      return out(false, why, runResult(state, engine.analyse(state).sustainable));
    }
    const cpu = cpuUsed();
    if (opts.cpuMs !== undefined && cpu !== null && cpu > opts.cpuMs) return out(false, `used more than ${seconds(opts.cpuMs)} s of CPU time (${done} of ${cycles} cycles)`, null);
    if (now() - t0 > opts.wallMs) return out(false, `took longer than ${seconds(opts.wallMs)} s (${done} of ${cycles} cycles)`, null);
  }
  return out(true, null, runResult(state, engine.analyse(state).sustainable));
}

/** Run every cell of a job in order. */
export function verifyJob(engine: Engine, job: VerifyJob, onProgress?: (done: number, total: number) => void): VerifyRunOutcome[] {
  const outcomes: VerifyRunOutcome[] = [];
  job.runs.forEach((r, i) => {
    const o = runOnce(engine, job.submission, job.board, job.tier, r.every, r.seed, job.cycles, { wallMs: job.wallMsPerRun, cpuMs: job.cpuMsPerRun });
    o.seedIndex = r.seedIndex;
    outcomes.push(o);
    onProgress?.(i + 1, job.runs.length);
  });
  return outcomes;
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
  board: Board,
  quotes: Readonly<Record<ItemId, BazaarQuote>>,
  ratio: number
): OutlierCheck {
  const byEvery = new Map<number, number[]>();
  for (const o of outcomes) {
    if (!o.ok || !o.result) continue;
    const v = valueResult(engine.data, o.result, board, quotes, DEFAULT_BAZAAR_PRICING).profitPerDay;
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
