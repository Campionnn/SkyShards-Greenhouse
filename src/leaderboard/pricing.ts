import type { GameData, ItemId } from "../simulator/data/types";
import { bazaarBuyPrice, bazaarSellPrice, DEFAULT_BAZAAR_PRICING, isBazaarItem, type BazaarPricing, type BazaarQuote } from "../simulator/economy/bazaar";
import { RARE_DROP_ITEMS } from "../simulator/economy/bounty";
import { defaultNpcPrice } from "../simulator/economy/prices";
import { ARMOR_SET_DROPS, overbloomMultiplier, RARE_CROP_ITEMS, type ArmorSet } from "../simulator/economy/rareCrops";
import { farmingFortuneMultiplier } from "../simulator/economy/yield";
import type { PlayerStats } from "../simulator/sim/state";
import type { PerDay, RunResult } from "./result";
import type { Board } from "./rules";
import { YIELD_STATS } from "./tiers";

/**
 * Pricing a stored result (docs/plans/flow-leaderboard.md §3.2, §3.4, §7.1). All on the client:
 * the server stores counts, the page values them under the viewer's board and prices, scales them
 * for the viewer's yield stats, and derives Slack from the frequency grid. Also used by the CLI's
 * outlier check with a reference valuation.
 */

export type Quotes = Readonly<Record<ItemId, BazaarQuote>>;

export interface Valuation {
  /** Coins per day: revenue − bought (normal) or revenue (ironman). */
  profitPerDay: number;
  revenuePerDay: number;
  /** Normal: coins per day spent buying supplies. Ironman: 0. */
  boughtPerDay: number;
  /** Normal: one-off cost of building the starting layouts (not in the profit). Ironman: 0. */
  buildCost: number;
  /** Items the result needed a price for but has none. */
  unpriced: ItemId[];
}

/** Unit sell price under a board: NPC (ironman; mutation items are worth 0) or the Bazaar top of book (normal, NPC as a floor for crops). */
export function sellPrice(data: GameData, item: ItemId, board: Board, quotes: Quotes, pricing: BazaarPricing): number | null {
  const npc = data.mutations[item] ? 0 : defaultNpcPrice(data, item);
  if (board === "ironman") return npc;
  const bazaar = isBazaarItem(item) ? bazaarSellPrice(quotes[item], pricing.sell, pricing.taxPercent) : null;
  if (bazaar !== null && bazaar >= npc) return bazaar;
  if (npc > 0) return npc;
  return bazaar;
}

export function buyPrice(item: ItemId, quotes: Quotes, pricing: BazaarPricing): number | null {
  return isBazaarItem(item) ? bazaarBuyPrice(quotes[item], pricing.buy) : null;
}

/** Value a result under a board. Ironman ignores `quotes`. */
export function valueResult(data: GameData, r: RunResult, board: Board, quotes: Quotes = {}, pricing: BazaarPricing = DEFAULT_BAZAAR_PRICING): Valuation {
  const unpriced = new Set<ItemId>();
  let revenue = 0;
  for (const [item, n] of Object.entries(r.produced)) {
    const s = sellPrice(data, item, board, quotes, pricing);
    if (s === null) {
      if (item !== "all_in_aloe_fragment") unpriced.add(item);
      continue;
    }
    revenue += n * s;
  }
  let bought = 0;
  let buildCost = 0;
  if (board === "normal") {
    for (const [item, n] of Object.entries(r.bought)) {
      const b = buyPrice(item, quotes, pricing);
      if (b === null) unpriced.add(item);
      else bought += n * b;
    }
    for (const [item, n] of Object.entries(r.built)) {
      const b = buyPrice(item, quotes, pricing);
      if (b === null) unpriced.add(item);
      else buildCost += n * b;
    }
  }
  return { profitPerDay: revenue - bought, revenuePerDay: revenue, boughtPerDay: bought, buildCost, unpriced: [...unpriced].sort() };
}

// ---- Yield-stat scaling (an estimate: the server ran every tier at the wiki maxima) ----

export type YieldStats = Pick<PlayerStats, "farmingFortune" | "plantYieldUpgrade" | "evergreenChip" | "overbloom" | "armorSet">;

/** Mutation items, Harvest Bounty drops and Ethereal Vine are not yield-scaled in the current game. */
function isCropBundleItem(data: GameData, item: ItemId): boolean {
  return !data.mutations[item] && !RARE_CROP_ITEMS.includes(item) && !RARE_DROP_ITEMS.includes(item) && item !== "all_in_aloe_fragment";
}

/**
 * Scale a result's produced counts from the server's yield stats to the viewer's. Crop bundles
 * follow FF × (yield sum) × (1 + Evergreen); armor Rare Crops follow Overbloom and the armor set
 * (a set that doesn't roll an item zeroes it). The yield sum's per-plant effects are unknown here,
 * so the Plant Yield term is applied to the sum at its default size (1 + upgrade + 0.25 unique
 * crops): an estimate, labelled as such on the page.
 */
export function scaleProduced(data: GameData, produced: PerDay, viewer: YieldStats, server: YieldStats = YIELD_STATS): PerDay {
  const ff = farmingFortuneMultiplier(viewer.farmingFortune) / farmingFortuneMultiplier(server.farmingFortune);
  const yieldSum = (1 + viewer.plantYieldUpgrade + 0.25) / (1 + server.plantYieldUpgrade + 0.25);
  const evergreen = (1 + viewer.evergreenChip) / (1 + server.evergreenChip);
  const crops = ff * yieldSum * evergreen;
  const bloom = overbloomMultiplier(viewer.overbloom) / overbloomMultiplier(server.overbloom);
  const viewerDrops = ARMOR_SET_DROPS[viewer.armorSet as ArmorSet] ?? [];
  const serverDrops = ARMOR_SET_DROPS[server.armorSet as ArmorSet] ?? [];
  const out: PerDay = {};
  for (const [item, n] of Object.entries(produced)) {
    let factor = 1;
    if (isCropBundleItem(data, item)) factor = crops;
    else if (item === "ethereal_vine") factor = bloom;
    else if (RARE_CROP_ITEMS.includes(item)) {
      // Armor rare crops: the server's set rolled them; the viewer's set may not.
      if (!serverDrops.includes(item)) factor = 1; // came from elsewhere (e.g. a cleared Fermento item), keep
      else factor = viewerDrops.includes(item) ? bloom : 0;
    }
    const v = n * factor;
    if (v > 0) out[item] = v;
  }
  return out;
}

export function scaleResult(data: GameData, r: RunResult, viewer: YieldStats, server: YieldStats = YIELD_STATS): RunResult {
  return { ...r, produced: scaleProduced(data, r.produced, viewer, server) };
}

/** Whether the viewer's yield stats differ from the server's (the "estimated" badge). */
export function yieldStatsDiffer(viewer: YieldStats, server: YieldStats = YIELD_STATS): boolean {
  return (Object.keys(server) as (keyof YieldStats)[]).some((k) => viewer[k] !== server[k]);
}

// ---- Slack: how forgiving a flow is when harvested late (metrics note, without the u(j) term) ----

/**
 * Slack at frequency k from the grid: for each present j in (k, 2k], r(j) = value(j) / value(k)
 * weighted by λ(j) = (2k + 1 − j) / k. Null when value(k) ≤ 0 or no grid point lies in (k, 2k].
 */
export function slack(k: number, valueAt: (every: number) => number | undefined, grid: readonly number[]): number | null {
  const base = valueAt(k);
  if (base === undefined || !(base > 0)) return null;
  let num = 0;
  let den = 0;
  for (const j of grid) {
    if (j <= k || j > 2 * k) continue;
    const v = valueAt(j);
    if (v === undefined) continue;
    const lambda = (2 * k + 1 - j) / k;
    num += lambda * Math.max(0, v) / base;
    den += lambda;
  }
  return den > 0 ? num / den : null;
}
