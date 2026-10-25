import type { Engine } from "../../../simulator/engine";
import { effortPerSession, type ActivitySchedule, type RunSummary, type Scenario } from "../../../simulator";
import { cellSolvent, debtOf, median, paidBackBy } from "../../../leaderboard/result";
import { PAYBACK_CYCLES } from "../../../leaderboard/rules";
import { EVERY } from "../../../leaderboard/tiers";
import type { FrequencyPoint } from "../../../leaderboard/view";

/**
 * "Profit by online frequency" for the simulator page: the user's own scenario, as is, re-run with
 * its online schedule replaced by "every N cycles" for each frequency of the leaderboard grid, a
 * few seeds each. Pure helpers; the runs happen in workers (sweep.worker.ts, sweepPool.ts).
 */

/** The frequencies tested: the leaderboard grid, so the two charts compare directly. */
export const SWEEP_EVERY: readonly number[] = EVERY;

export const DEFAULT_SWEEP_SEEDS = 3;
export const MIN_SWEEP_SEEDS = 1;
export const MAX_SWEEP_SEEDS = 9;
export const DEFAULT_SWEEP_CYCLES = 2000;
export const MIN_SWEEP_CYCLES = 100;
export const MAX_SWEEP_CYCLES = 20000;

export interface SweepParams {
  seeds: number;
  cycles: number;
}

/** One simulated (frequency, seed) run, summarised for the page. */
export interface SweepRun {
  every: number;
  seed: number;
  ok: boolean;
  error: string | null;
  /** The finished run's summary (null when the scenario failed to start). */
  summary: RunSummary | null;
  /** Starting layouts on credit (`config.bootstrapDebt`): paid back by PAYBACK_CYCLES. Missing when the scenario doesn't borrow. */
  solvent?: boolean;
}

/** The scenario with its online schedule replaced by "every `every` cycles" and the given seed. */
export function sweepScenario(sc: Scenario, every: number, seed: number): Scenario {
  const activity: ActivitySchedule = { kind: "everyN", n: Math.max(1, Math.floor(every)), offset: 0 };
  return { ...sc, settings: { ...sc.settings, activity, seed } };
}

/** The seeds to run: the scenario's own seed and the ones after it, so a result is reproducible. */
export function sweepSeeds(base: number, n: number): number[] {
  return Array.from({ length: Math.max(1, Math.floor(n)) }, (_, i) => (Math.floor(base) + i) >>> 0);
}

export function clampSweepParams(p: SweepParams): SweepParams {
  const clamp = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d);
  return {
    seeds: clamp(p.seeds, MIN_SWEEP_SEEDS, MAX_SWEEP_SEEDS, DEFAULT_SWEEP_SEEDS),
    cycles: clamp(p.cycles, MIN_SWEEP_CYCLES, MAX_SWEEP_CYCLES, DEFAULT_SWEEP_CYCLES),
  };
}

/**
 * What a sweep depends on: the scenario without its online schedule (every run replaces it) plus
 * the parameters. A result whose key differs from the current one is stale.
 */
export function sweepKey(sc: Scenario, params: SweepParams): string {
  const { activity: _activity, ...settings } = sc.settings;
  void _activity;
  return JSON.stringify([{ ...sc, settings }, params.seeds, params.cycles]);
}

/** The grid frequency highlighted for a schedule: its own N when it is "every N", else none. */
export function scheduleEvery(activity: ActivitySchedule): number | null {
  if (activity.kind !== "everyN") return null;
  let best = SWEEP_EVERY[0];
  for (const n of SWEEP_EVERY) if (Math.abs(n - activity.n) < Math.abs(best - activity.n)) best = n;
  return best;
}

/** Cycles per engine.run call between progress reports. */
const SLICE = 100;

/** Simulate one (frequency, seed) run. Never throws for a scenario the engine rejects: returns the error. */
export function runSweepCell(
  engine: Engine,
  base: Scenario,
  every: number,
  seed: number,
  cycles: number,
  onProgress?: (done: number, total: number) => void
): SweepRun {
  let state;
  try {
    state = engine.initState(sweepScenario(base, every, seed)).state;
  } catch (e) {
    return { every, seed, ok: false, error: e instanceof Error ? e.message : String(e), summary: null };
  }
  let done = 0;
  let error: string | null = null;
  while (done < cycles) {
    const r = engine.run(state, Math.min(SLICE, cycles - done), { retainEvents: "none" });
    state = r.state;
    done += r.cyclesRun;
    onProgress?.(done, cycles);
    if (r.truncated || state.scripts?.halt) {
      const halt = state.scripts?.halt;
      error = halt ? `script ${halt.kind}${halt.message ? `: ${halt.message}` : ""} at cycle ${state.cycle}` : `run stopped at cycle ${state.cycle}`;
      break;
    }
    if (r.cyclesRun === 0) break;
  }
  const borrows = state.scenario.settings.config.bootstrapDebt === true;
  return {
    every,
    seed,
    ok: error === null,
    error,
    summary: state.summary,
    ...(borrows ? { solvent: paidBackBy(debtOf(state).paybackCycle, PAYBACK_CYCLES) } : {}),
  };
}

/** Profit per simulated day of a summary (ironman: the money panel's profit). */
export function summaryProfitPerDay(s: RunSummary): number {
  return s.elapsedSeconds > 0 ? s.profit / (s.elapsedSeconds / 86400) : 0;
}

export interface SweepPoint extends FrequencyPoint {
  /** Runs at this frequency so far, and how many of them failed. */
  runs: number;
  failed: number;
}

/**
 * The chart's points: per frequency, the median profit per day over the finished seeds, priced by
 * `price` (the page passes Bazaar pricing in normal profile). A frequency whose seeds mostly don't
 * pay their borrowed starting layouts back in time is insolvent, as on the leaderboard.
 */
export function sweepPoints(runs: readonly SweepRun[], price: (s: RunSummary) => number = summaryProfitPerDay, grid: readonly number[] = SWEEP_EVERY): SweepPoint[] {
  return grid.map((every) => {
    const at = runs.filter((r) => r.every === every);
    const ok = at.filter((r): r is SweepRun & { summary: RunSummary } => r.ok && r.summary !== null);
    const base = { every, runs: at.length, failed: at.length - ok.length };
    if (!ok.length) return { ...base, profitPerDay: null };
    if (ok.some((r) => r.solvent !== undefined) && !cellSolvent(ok)) return { ...base, profitPerDay: null, insolvent: true };
    const logged = ok.filter((r) => (r.summary.effort?.sessions ?? 0) > 0);
    return {
      ...base,
      profitPerDay: median(ok.map((r) => price(r.summary))),
      effortAvg: logged.length ? median(logged.map((r) => effortPerSession(r.summary.effort))) : null,
    };
  });
}

/** Average real hours per cycle over the finished runs (null without one). */
export function sweepHoursPerCycle(runs: readonly SweepRun[]): number | null {
  let seconds = 0;
  let cycles = 0;
  for (const r of runs) {
    if (!r.summary) continue;
    seconds += r.summary.elapsedSeconds;
    cycles += r.summary.cyclesRun;
  }
  return cycles > 0 ? seconds / cycles / 3600 : null;
}
