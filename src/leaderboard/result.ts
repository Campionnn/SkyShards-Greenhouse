import type { ItemId } from "../simulator/data/types";
import type { EffortKind, EffortSummary, SimulationState } from "../simulator/sim/state";
import { uptimeRatio } from "../simulator/sim/summary";

/**
 * What the server stores per verification run (docs/plans/flow-leaderboard.md §3.3): item counts
 * per simulated day, never coins, so the page can price them with any valuation. `medianResult`
 * combines a cell's seeds component-wise.
 */

export type PerDay = Record<ItemId, number>;

export interface EffortResult {
  sessions: number;
  /** Weighted effort per session (average). */
  avg: number;
  /** The heaviest session. */
  peak: number;
  /** Raw action counts per session, by kind. */
  byKind: Partial<Record<EffortKind, number>>;
}

export interface RunResult {
  cycles: number;
  days: number;
  /** Every unit credited to the inventory (harvests, cleared Dead Plants, converted aloes), per day. */
  produced: PerDay;
  /** Units spent placing, per day (ironman: the supplies you must farm yourself). */
  consumed: PerDay;
  /** Normal board only: units bought because a placement was short, per day. */
  bought: PerDay;
  /** Normal board only: items the free setup placed, once (what building the starting layouts costs). */
  built: Record<ItemId, number>;
  /** Units a required spend could not get, per day (ironman shortfalls). */
  shortfall: PerDay;
  uptime: number;
  sustainable: boolean;
  effort: EffortResult;
  /** A script halted the run (error or pause) before it finished. */
  halted: boolean;
}

const perDay = (counts: Readonly<Record<string, number>>, days: number): PerDay => {
  const out: PerDay = {};
  for (const [item, n] of Object.entries(counts)) if (n > 0 && days > 0) out[item] = n / days;
  return out;
};

export function effortResult(e: EffortSummary | undefined): EffortResult {
  if (!e || e.sessions === 0) return { sessions: 0, avg: 0, peak: 0, byKind: {} };
  const byKind: Partial<Record<EffortKind, number>> = {};
  for (const [k, n] of Object.entries(e.counts)) if (n) byKind[k as EffortKind] = n / e.sessions;
  return { sessions: e.sessions, avg: e.total / e.sessions, peak: e.peak, byKind };
}

/** Summarise a finished run as the stored result. Pure; reads the state only. */
export function runResult(state: SimulationState, sustainable: boolean): RunResult {
  const days = state.elapsedSeconds / 86400;
  const produced: Record<string, number> = {};
  const consumed: Record<string, number> = {};
  const shortfall: Record<string, number> = {};
  for (const [item, row] of Object.entries(state.ledger)) {
    if (row.produced > 0) produced[item] = row.produced;
    if (row.consumed > 0) consumed[item] = row.consumed;
    if (row.shortfall > 0) shortfall[item] = row.shortfall;
  }
  const market = state.summary.market;
  return {
    cycles: state.cycle,
    days,
    produced: perDay(produced, days),
    consumed: perDay(consumed, days),
    bought: market ? perDay(market.bought, days) : {},
    built: market ? { ...market.built } : {},
    shortfall: perDay(shortfall, days),
    uptime: uptimeRatio(state.summary.uptime),
    sustainable,
    effort: effortResult(state.summary.effort),
    halted: !!state.scripts?.halt,
  };
}

/** The median of a list of numbers (the lower middle value for an even count). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function medianMap(maps: readonly Readonly<Record<string, number>>[]): Record<string, number> {
  const keys = new Set<string>();
  for (const m of maps) for (const k of Object.keys(m)) keys.add(k);
  const out: Record<string, number> = {};
  for (const k of [...keys].sort()) {
    const v = median(maps.map((m) => m[k] ?? 0));
    if (v > 0) out[k] = v;
  }
  return out;
}

/** Component-wise median over a cell's seeds: no single lucky seed defines any count. */
export function medianResult(results: readonly RunResult[]): RunResult {
  if (results.length === 0) throw new Error("medianResult: no results");
  const kinds = new Set<string>();
  for (const r of results) for (const k of Object.keys(r.effort.byKind)) kinds.add(k);
  const byKind: Partial<Record<EffortKind, number>> = {};
  for (const k of [...kinds].sort()) byKind[k as EffortKind] = median(results.map((r) => r.effort.byKind[k as EffortKind] ?? 0));
  return {
    cycles: median(results.map((r) => r.cycles)),
    days: median(results.map((r) => r.days)),
    produced: medianMap(results.map((r) => r.produced)),
    consumed: medianMap(results.map((r) => r.consumed)),
    bought: medianMap(results.map((r) => r.bought)),
    built: medianMap(results.map((r) => r.built)),
    shortfall: medianMap(results.map((r) => r.shortfall)),
    uptime: median(results.map((r) => r.uptime)),
    sustainable: results.every((r) => r.sustainable),
    effort: {
      sessions: median(results.map((r) => r.effort.sessions)),
      avg: median(results.map((r) => r.effort.avg)),
      peak: median(results.map((r) => r.effort.peak)),
      byKind,
    },
    halted: results.some((r) => r.halted),
  };
}

/** best / median of a valuation over seeds (the outlier check); 1 when all equal, Infinity when the median is 0 and some seed is not. */
export function spreadRatio(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const best = Math.max(...values);
  const mid = median(values);
  if (best <= 0) return 1;
  if (mid <= 0) return Infinity;
  return best / mid;
}
