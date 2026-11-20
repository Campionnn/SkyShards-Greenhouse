import type { ItemId } from "../../simulator/data/types";
import type { RunSummary } from "../../simulator";
import type { RankMetric } from "../../leaderboard/metric";

/**
 * The simulator's focus metric values (docs/plans/sowdust-xp-collection.md): coins, one crop's
 * collection, Sowdust or Farming XP, per simulated day. Every number comes from a `RunSummary`, so
 * the live progress summary and the Monte Carlo sweep's finished runs (which keep only their
 * summary) read the same way. Pure and React-free: the sweep worker imports it. The picker state,
 * names and formatting are in focusMetricUi.ts.
 */

const days = (s: RunSummary) => s.elapsedSeconds / 86400;
const perDay = (s: RunSummary, total: number) => (days(s) > 0 ? total / days(s) : 0);

/**
 * Harvested units of a crop item, all plots (summary.bySource summed over the plants that dropped
 * it). For base-crop items this equals the ledger's `produced`: only harvests credit them.
 */
export function collectionTotal(s: RunSummary, crop: ItemId): number {
  let n = 0;
  for (const items of Object.values(s.bySource ?? {})) n += items[crop] ?? 0;
  return n;
}

/** Sowdust earned, every crop item summed (missing in old states: 0). */
export function sowdustTotal(s: RunSummary): number {
  let n = 0;
  for (const v of Object.values(s.sowdust ?? {})) if (v > 0) n += v;
  return n;
}

/** Farming XP earned (missing in old states: 0). */
export const xpTotal = (s: RunSummary): number => s.farmingXp ?? 0;

export const sowdustPerDay = (s: RunSummary): number => perDay(s, sowdustTotal(s));
export const xpPerDay = (s: RunSummary): number => perDay(s, xpTotal(s));
export const collectionPerDay = (s: RunSummary, crop: ItemId): number => perDay(s, collectionTotal(s, crop));

/** A metric's number per simulated day; coins are the caller's valuation (NPC or Bazaar). */
export function metricPerDay(s: RunSummary, metric: RankMetric, coinsPerDay: (s: RunSummary) => number): number {
  switch (metric.by) {
    case "coins":
      return coinsPerDay(s);
    case "collection":
      return collectionPerDay(s, metric.crop);
    case "sowdust":
      return sowdustPerDay(s);
    case "xp":
      return xpPerDay(s);
  }
}
