import { DEFAULT_PLAYER_STATS } from "../simulator/scenario";
import type { ActivitySchedule, PlayerStats } from "../simulator/sim/state";

/**
 * The leaderboard grid: online frequencies × player-stat tiers (docs/plans/flow-leaderboard.md §3).
 * Shared by the server CLI (which simulates every cell) and the page (which picks a cell).
 */

/** Online every N cycles. */
export const EVERY: readonly number[] = [1, 2, 3, 4, 6, 8, 12];

export type TierId = "max" | "high" | "mid" | "low";
export const TIERS: readonly TierId[] = ["max", "high", "mid", "low"];

/** The stats that change the simulation itself (growth, spawn rolls, unique crops, Chloronite). */
export type SimStats = Pick<PlayerStats, "cropGrowth" | "speedAttribute" | "growthUpgradeTier" | "floraShard" | "mutationChanceBonus" | "miningFortune">;

export const TIER_STATS: Readonly<Record<TierId, SimStats>> = {
  max: { cropGrowth: 210, speedAttribute: 10, growthUpgradeTier: 9, floraShard: 10, mutationChanceBonus: 0.15, miningFortune: 2000 },
  high: { cropGrowth: 160, speedAttribute: 5, growthUpgradeTier: 8, floraShard: 7, mutationChanceBonus: 0.1, miningFortune: 1500 },
  mid: { cropGrowth: 100, speedAttribute: 0, growthUpgradeTier: 5, floraShard: 3, mutationChanceBonus: 0.05, miningFortune: 1000 },
  low: { cropGrowth: 40, speedAttribute: 0, growthUpgradeTier: 2, floraShard: 0, mutationChanceBonus: 0, miningFortune: 500 },
};

/** The yield-only stats every server run uses (wiki maxima); the page scales results for other values. */
export const YIELD_STATS: Pick<PlayerStats, "farmingFortune" | "plantYieldUpgrade" | "evergreenChip" | "overbloom" | "armorSet"> = {
  farmingFortune: DEFAULT_PLAYER_STATS.farmingFortune,
  plantYieldUpgrade: DEFAULT_PLAYER_STATS.plantYieldUpgrade,
  evergreenChip: DEFAULT_PLAYER_STATS.evergreenChip,
  overbloom: DEFAULT_PLAYER_STATS.overbloom,
  armorSet: DEFAULT_PLAYER_STATS.armorSet,
};

/** The complete player stats of a tier. */
export function tierStats(tier: TierId): PlayerStats {
  return { ...TIER_STATS[tier], ...YIELD_STATS, startTimeOfDay: 0 };
}

export function activityEvery(every: number): ActivitySchedule {
  return { kind: "everyN", n: Math.max(1, Math.floor(every)), offset: 0 };
}

/**
 * Growth-speed denominator of a stat set (the part of `cycleSeconds` the player controls, Flora
 * included at full value as an upper bound). Used to pick the nearest tier for a viewer.
 */
function speedScore(s: SimStats): number {
  const upgrade = Math.max(0, Math.min(9, Math.floor(s.growthUpgradeTier))) === 9 ? 0.5 : 0.05 * Math.max(0, Math.min(9, Math.floor(s.growthUpgradeTier)));
  return 0.0025 * s.cropGrowth + 0.001 * s.speedAttribute + upgrade + 0.025 * Math.max(0, Math.min(10, s.floraShard));
}

/** The tier whose growth speed is nearest the viewer's own stats. */
export function nearestTier(stats: SimStats): TierId {
  const target = speedScore(stats);
  let best: TierId = "max";
  let bestDiff = Infinity;
  for (const tier of TIERS) {
    const diff = Math.abs(speedScore(TIER_STATS[tier]) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = tier;
    }
  }
  return best;
}

/** The grid frequency nearest to `every` cycles (ties go to the lower one). */
export function nearestEvery(every: number): number {
  let best = EVERY[0];
  for (const n of EVERY) if (Math.abs(n - every) < Math.abs(best - every)) best = n;
  return best;
}
