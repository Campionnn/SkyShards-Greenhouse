import type { Engine } from "../simulator/engine";
import type { PlayerStats } from "../simulator/sim/state";
import type { RunResult } from "./result";
import type { CellKind, Submission } from "./rules";
import { tierStats } from "./tiers";
import { runIronman, runOnce } from "./verify";

/**
 * The flow page's "Test with your stats": a leaderboard flow simulated under the server's rules
 * (verify.ts runIronman / runOnce, unchanged) but with the viewer's exact player stats instead of a
 * stat tier, at any online frequency, over many random seeds. Not part of the verify bundle: the
 * stats are swapped in by wrapping the engine (`withStats`), so ENGINE_VERSION stays the same.
 */

/** An engine whose every starting scenario (the flow's runs and the builder's) uses `stats`. */
export function withStats(engine: Engine, stats: PlayerStats): Engine {
  return {
    ...engine,
    initState: (sc) => engine.initState({ ...sc, settings: { ...sc.settings, playerStats: structuredClone(stats) } }),
  };
}

/** The stat fields the viewer enters (useFlowViewer's ViewerStats without `every`). */
export type EnteredStats = Pick<
  PlayerStats,
  "cropGrowth" | "speedAttribute" | "growthUpgradeTier" | "floraShard" | "mutationChanceBonus" | "miningFortune" | "farmingFortune" | "plantYieldUpgrade" | "evergreenChip" | "overbloom" | "armorSet" | "cropFortune" | "tools"
>;

/** Complete player stats from what the viewer entered (the max tier fills anything missing). */
export function enteredPlayerStats(s: EnteredStats): PlayerStats {
  const out: PlayerStats = {
    ...tierStats("max"),
    cropGrowth: s.cropGrowth,
    speedAttribute: s.speedAttribute,
    growthUpgradeTier: s.growthUpgradeTier,
    floraShard: s.floraShard,
    mutationChanceBonus: s.mutationChanceBonus,
    miningFortune: s.miningFortune,
    farmingFortune: s.farmingFortune,
    plantYieldUpgrade: s.plantYieldUpgrade,
    evergreenChip: s.evergreenChip,
    overbloom: s.overbloom,
    armorSet: s.armorSet,
    startTimeOfDay: 0,
  };
  if (s.cropFortune && Object.keys(s.cropFortune).length) out.cropFortune = { ...s.cropFortune };
  if (s.tools?.length) out.tools = structuredClone(s.tools);
  return out;
}

export interface StatsTestRequest {
  reqId: number;
  submission: Submission;
  /** Which number: from nothing (the builder first), with the starting items, or Normal. */
  kind: CellKind;
  stats: PlayerStats;
  every: number;
  seed: number;
  /** The flow's length C (the run goes on through the end window). */
  cycles: number;
  wallMs: number;
}

export interface StatsTestOutcome {
  every: number;
  seed: number;
  ok: boolean;
  error: string | null;
  /** The cell kind's result for this seed (null when it failed). */
  result: RunResult | null;
  wallMs: number;
}

/** One seed. Never throws for a scenario the engine rejects. */
export function runStatsSeed(engine: Engine, r: Omit<StatsTestRequest, "reqId">, onProgress?: (done: number, total: number) => void): StatsTestOutcome {
  const e = withStats(engine, r.stats);
  const base = { every: r.every, seed: r.seed };
  if (r.kind === "ironman") {
    const o = runIronman(e, r.submission, "max", r.every, r.seed, r.cycles, { wallMs: r.wallMs, onProgress });
    return { ...base, ok: o.ok && !!o.fromNothing, error: o.error ?? (o.fromNothing ? null : "no result"), result: o.fromNothing, wallMs: o.wallMs };
  }
  const o = runOnce(e, r.submission, r.kind === "ironman_kit" ? "borrow" : "normal", "max", r.every, r.seed, r.cycles, { wallMs: r.wallMs, onProgress });
  return { ...base, ok: o.ok && !!o.result, error: o.error, result: o.ok ? o.result : null, wallMs: o.wallMs };
}
