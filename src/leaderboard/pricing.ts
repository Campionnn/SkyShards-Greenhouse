import type { GameData, ItemId } from "../simulator/data/types";
import { bazaarBuyPrice, bazaarSellPrice, DEFAULT_BAZAAR_PRICING, isBazaarItem, type BazaarPricing, type BazaarQuote } from "../simulator/economy/bazaar";
import { RARE_DROP_ITEMS } from "../simulator/economy/bounty";
import { bestTool, FORTUNE_CROPS, hasPerCropFortune, itemFortune, type CropFortune, type FarmingToolStats } from "../simulator/economy/fortune";
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

/**
 * The yield-only stats. `cropFortune` / `tools` are the per-crop terms (economy/fortune.ts); the
 * server runs without them (YIELD_STATS), so a viewer's crop bonus and tools scale up from there.
 */
export type YieldStats = Pick<PlayerStats, "farmingFortune" | "plantYieldUpgrade" | "evergreenChip" | "overbloom" | "armorSet" | "cropFortune" | "tools">;

/** Mutation items, Harvest Bounty drops and Ethereal Vine are not yield-scaled in the current game. */
function isCropBundleItem(data: GameData, item: ItemId): boolean {
  return !data.mutations[item] && !RARE_CROP_ITEMS.includes(item) && !RARE_DROP_ITEMS.includes(item) && item !== "all_in_aloe_fragment";
}

export interface ScaleOptions {
  /**
   * Harvest drops per day by the plant kind that dropped them (`RunResult.bySource`). With it,
   * each source's crop bundle is harvested with its own best tool, as the engine does per harvest;
   * without it, each item gets the tool with the most fortune on its crop (an upper bound).
   */
  bySource?: Readonly<Record<string, Readonly<PerDay>>>;
  /** Unit price the tool choice weighs drops by. Default: NPC, the price the engine's harvest uses. */
  price?: (item: ItemId) => number;
}

/** The per-item factors from the server's yield stats to the viewer's (see `scaleProduced`). */
function yieldScaler(data: GameData, viewer: YieldStats, server: YieldStats, opts: ScaleOptions) {
  const ff = farmingFortuneMultiplier(viewer.farmingFortune) / farmingFortuneMultiplier(server.farmingFortune);
  const yieldSum = (1 + viewer.plantYieldUpgrade + 0.25) / (1 + server.plantYieldUpgrade + 0.25);
  const evergreen = (1 + viewer.evergreenChip) / (1 + server.evergreenChip);
  const crops = ff * yieldSum * evergreen;
  const rest = yieldSum * evergreen;
  const bloom = overbloomMultiplier(viewer.overbloom) / overbloomMultiplier(server.overbloom);
  const viewerDrops = ARMOR_SET_DROPS[viewer.armorSet as ArmorSet] ?? [];
  const serverDrops = ARMOR_SET_DROPS[server.armorSet as ArmorSet] ?? [];
  // Without any per-crop term, one multiplier covers every crop item (the old path, byte for byte).
  const perCrop = hasPerCropFortune(viewer) || hasPerCropFortune(server);
  const price = opts.price ?? ((item: ItemId) => defaultNpcPrice(data, item));

  /** Factor of an item that isn't a crop-bundle item (tools don't matter), else null. */
  const otherFactor = (item: ItemId): number | null => {
    if (isCropBundleItem(data, item)) return null;
    if (item === "ethereal_vine") return bloom;
    if (RARE_CROP_ITEMS.includes(item)) {
      // Armor rare crops: the server's set rolled them; the viewer's set may not.
      if (!serverDrops.includes(item)) return 1; // came from elsewhere (e.g. a cleared Fermento item), keep
      return viewerDrops.includes(item) ? bloom : 0;
    }
    return 1;
  };
  const cropFactor = (item: ItemId, viewerTool: FarmingToolStats | null, serverTool: FarmingToolStats | null): number =>
    perCrop ? (farmingFortuneMultiplier(itemFortune(viewer, item, viewerTool)) / farmingFortuneMultiplier(itemFortune(server, item, serverTool))) * rest : crops;
  /** The tool with the most fortune on one item's crop (first on ties). */
  const itemTool = (stats: YieldStats, item: ItemId) => bestTool({ [item]: 1 }, stats.tools, () => 1);

  /** One source's drops scaled, its crop bundle harvested with the best tool for it. */
  const scaleSource = (items: Readonly<PerDay>): PerDay => {
    let viewerTool: FarmingToolStats | null = null;
    let serverTool: FarmingToolStats | null = null;
    if (perCrop) {
      // The stored counts already carry the server's fortune: undo it to weigh the bundle.
      const bundle: Record<ItemId, number> = {};
      for (const [item, n] of Object.entries(items)) if (isCropBundleItem(data, item)) bundle[item] = n / farmingFortuneMultiplier(itemFortune(server, item, null));
      viewerTool = bestTool(bundle, viewer.tools, price);
      serverTool = bestTool(bundle, server.tools, price);
    }
    const out: PerDay = {};
    for (const [item, n] of Object.entries(items)) {
      const v = n * (otherFactor(item) ?? cropFactor(item, viewerTool, serverTool));
      if (v > 0) out[item] = v;
    }
    return out;
  };

  // Per-source tools: each crop item's factor is the drop-weighted mean over the sources that dropped it.
  const weighted = new Map<ItemId, { raw: number; scaled: number }>();
  if (perCrop && opts.bySource) {
    for (const items of Object.values(opts.bySource)) {
      const scaled = scaleSource(items);
      for (const [item, n] of Object.entries(items)) {
        if (!isCropBundleItem(data, item) || !(n > 0)) continue;
        const w = weighted.get(item) ?? { raw: 0, scaled: 0 };
        w.raw += n;
        w.scaled += scaled[item] ?? 0;
        weighted.set(item, w);
      }
    }
  }
  const itemFactor = (item: ItemId): number => {
    const other = otherFactor(item);
    if (other !== null) return other;
    if (!perCrop) return crops;
    const w = weighted.get(item);
    if (w && w.raw > 0) return w.scaled / w.raw;
    return cropFactor(item, itemTool(viewer, item), itemTool(server, item));
  };
  return { itemFactor, scaleSource };
}

/**
 * Scale a result's produced counts from the server's yield stats to the viewer's. Crop bundles
 * follow FF × (yield sum) × (1 + Evergreen), where FF is per item when the viewer has a crop bonus
 * or tools (general + crop-specific + the best tool's fortune on that crop); armor Rare Crops
 * follow Overbloom and the armor set (a set that doesn't roll an item zeroes it). The yield sum's
 * per-plant effects are unknown here, so the Plant Yield term is applied to the sum at its default
 * size (1 + upgrade + 0.25 unique crops): an estimate, labelled as such on the page.
 */
export function scaleProduced(data: GameData, produced: PerDay, viewer: YieldStats, server: YieldStats = YIELD_STATS, opts: ScaleOptions = {}): PerDay {
  return scaleBy(produced, yieldScaler(data, viewer, server, opts).itemFactor);
}

function scaleBy(produced: Readonly<PerDay>, factor: (item: ItemId) => number): PerDay {
  const out: PerDay = {};
  for (const [item, n] of Object.entries(produced)) {
    const v = n * factor(item);
    if (v > 0) out[item] = v;
  }
  return out;
}

/**
 * A result scaled to the viewer: the produced counts (crop items get their best tool per source
 * when the result stores `bySource`) and the drops by source themselves.
 */
export function scaleResult(data: GameData, r: RunResult, viewer: YieldStats, server: YieldStats = YIELD_STATS, opts: Omit<ScaleOptions, "bySource"> = {}): RunResult {
  const { itemFactor, scaleSource } = yieldScaler(data, viewer, server, { ...opts, bySource: r.bySource });
  return {
    ...r,
    produced: scaleBy(r.produced, itemFactor),
    ...(r.bySource ? { bySource: Object.fromEntries(Object.entries(r.bySource).map(([k, items]) => [k, scaleSource(items)])) } : {}),
  };
}

const finiteOr0 = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The per-crop terms as a comparable string (a missing crop and 0 are the same). */
function perCropKey(s: YieldStats): string {
  const crops = (cf: CropFortune | undefined) => FORTUNE_CROPS.map((c) => finiteOr0(cf?.[c])).join(",");
  return `${crops(s.cropFortune)};${(s.tools ?? []).map((t) => `${t.name}:${crops(t.fortune)}`).join("|")}`;
}

const BASE_YIELD_KEYS = ["farmingFortune", "plantYieldUpgrade", "evergreenChip", "overbloom", "armorSet"] as const;

/** Whether the viewer's yield stats differ from the server's (the "estimated" badge). Crop fortune and tools compare by value. */
export function yieldStatsDiffer(viewer: YieldStats, server: YieldStats = YIELD_STATS): boolean {
  return BASE_YIELD_KEYS.some((k) => viewer[k] !== server[k]) || perCropKey(viewer) !== perCropKey(server);
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
