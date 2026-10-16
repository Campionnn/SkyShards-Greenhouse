import type { GameData, ItemId } from "../data/types";
import type { MarketSummary, RunSummary } from "../sim/state";
import { bazaarBuyPrice, bazaarSellPrice, isBazaarItem, type BazaarPricing, type BazaarQuote } from "./bazaar";
import { RARE_DROP_ITEMS } from "./bounty";
import { defaultNpcPrice } from "./prices";
import { RARE_CROP_ITEMS } from "./rareCrops";

// Prices a normal-profile run's Bazaar counts (RunSummary.market). Pure and cheap, so the page
// re-prices instantly when prices refresh or the buy / sell side changes; the run is not re-simulated.
//
// Accounting, per item, with s = what one unit sells for and b = what one costs to buy:
//   end stock − start stock = produced + bought − placed − sold
// Valuing the stock change at s, the run is worth
//   sold·s + (end − start)·s − bought·b  =  produced·s − (placed − bought)·s − bought·b
// so it doesn't depend on when the surplus was sold. Hence the money lines:
//   revenue   = produced · s        (everything the run made, at what it sells for)
//   own stock = (placed − bought)·s (placements paid from stock: those items could have been sold)
//   bought    = bought · b
//   profit    = revenue − own stock − bought
// The starting layouts are free in the run; `buildCost` (built · b) is shown separately, as a one-off.

/** Where an item's sell price comes from. */
export type PriceSourceKind = "bazaar" | "npc" | "none";

export interface UnitPrices {
  /** Coins per unit sold: mutation items on the Bazaar; everything else the better of NPC and Bazaar. After tax. */
  sell: number;
  sellFrom: PriceSourceKind;
  /** Coins per unit bought on the Bazaar; null = not on the Bazaar (or no quote). */
  buy: number | null;
}

export type BazaarQuotes = Readonly<Record<ItemId, BazaarQuote>>;

/** Unit prices for one item under the chosen pricing. */
export function unitPrices(data: GameData, item: ItemId, quotes: BazaarQuotes, pricing: BazaarPricing): UnitPrices {
  const quote = isBazaarItem(item) ? quotes[item] : undefined;
  const bazaar = bazaarSellPrice(quote, pricing.sell, pricing.taxPercent);
  const buy = bazaarBuyPrice(quote, pricing.buy);
  // Mutation items have no NPC price (defaultNpcPrice gives 0), so they always sell on the Bazaar.
  const npc = data.mutations[item] ? 0 : defaultNpcPrice(data, item);
  if (bazaar !== null && bazaar >= npc) return { sell: bazaar, sellFrom: "bazaar", buy };
  if (npc > 0) return { sell: npc, sellFrom: "npc", buy };
  return { sell: bazaar ?? 0, sellFrom: bazaar !== null ? "bazaar" : "none", buy };
}

/** Money group of an item, matching the ironman Money panel's rows. */
export type MarketCategory = "crops" | "rareCrops" | "rareDrops" | "mutationItems";

export function marketCategory(data: GameData, item: ItemId): MarketCategory {
  if (data.mutations[item]) return "mutationItems";
  if (RARE_CROP_ITEMS.includes(item)) return "rareCrops"; // Ethereal Vine counts here, even from a Harvest Bounty roll
  if (RARE_DROP_ITEMS.includes(item)) return "rareDrops";
  return "crops";
}

export interface MarketValuation {
  revenue: Record<MarketCategory, number>;
  revenueTotal: number;
  /** Placements paid from stock (placed − bought), at sell price. */
  ownStock: number;
  /** Units bought, at buy price. */
  bought: number;
  profit: number;
  /** Mutation items sold so far, at sell price (part of the profit, already in coins). */
  sold: number;
  /** One-off: buying every item the starting layouts place. Not in the profit. */
  buildCost: number;
  /** Items the run needed a price for but has none (no NPC price, not on the Bazaar or no quote). */
  unpriced: ItemId[];
}

/** Value a run's Bazaar counts. `placedItems` is `RunSummary.placedItems` (bought units included). */
export function valueMarket(
  data: GameData,
  market: MarketSummary,
  placedItems: Readonly<Record<ItemId, number>>,
  quotes: BazaarQuotes,
  pricing: BazaarPricing
): MarketValuation {
  const cache = new Map<ItemId, UnitPrices>();
  const unpriced = new Set<ItemId>();
  const price = (item: ItemId) => {
    let p = cache.get(item);
    if (!p) cache.set(item, (p = unitPrices(data, item, quotes, pricing)));
    return p;
  };
  const sellOf = (item: ItemId) => {
    const p = price(item);
    if (p.sellFrom === "none") unpriced.add(item);
    return p.sell;
  };
  const buyOf = (item: ItemId) => {
    const p = price(item);
    if (p.buy === null) {
      unpriced.add(item);
      return 0;
    }
    return p.buy;
  };

  const revenue: Record<MarketCategory, number> = { crops: 0, rareCrops: 0, rareDrops: 0, mutationItems: 0 };
  for (const [item, n] of Object.entries(market.produced)) {
    if (n <= 0) continue;
    const s = sellOf(item);
    // Fragments only ever turn into All-in Aloe (counted when they do); unpriced, but not worth flagging.
    if (s === 0 && item === "all_in_aloe_fragment") unpriced.delete(item);
    revenue[marketCategory(data, item)] += n * s;
  }
  let ownStock = 0;
  for (const [item, n] of Object.entries(placedItems)) {
    const own = n - (market.bought[item] ?? 0);
    if (own > 0) ownStock += own * sellOf(item);
  }
  let bought = 0;
  for (const [item, n] of Object.entries(market.bought)) if (n > 0) bought += n * buyOf(item);
  let sold = 0;
  for (const [item, n] of Object.entries(market.sold)) if (n > 0) sold += n * sellOf(item);
  let buildCost = 0;
  for (const [item, n] of Object.entries(market.built)) if (n > 0) buildCost += n * buyOf(item);

  const revenueTotal = revenue.crops + revenue.rareCrops + revenue.rareDrops + revenue.mutationItems;
  return {
    revenue,
    revenueTotal,
    ownStock,
    bought,
    profit: revenueTotal - ownStock - bought,
    sold,
    buildCost,
    unpriced: [...unpriced].sort(),
  };
}

/** `valueMarket` for a whole run summary; null for an ironman run (no `market`). */
export function valueRun(data: GameData, summary: RunSummary, quotes: BazaarQuotes, pricing: BazaarPricing): MarketValuation | null {
  return summary.market ? valueMarket(data, summary.market, summary.placedItems, quotes, pricing) : null;
}
