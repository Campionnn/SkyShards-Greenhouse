import type { ItemId } from "../data/types";

/**
 * Hypixel Bazaar (normal profiles). The engine only needs to know *which* items can be bought
 * (`isBazaarItem`); prices never enter a run, so a run stays deterministic and a price refresh
 * re-prices it without re-simulating (economy/valuation.ts).
 *
 * API: GET https://api.hypixel.net/v2/skyblock/bazaar (no key, CORS open, cached ~60 s).
 * Prices come from the live order book, like ../SkyShards (`dataService.loadShardCosts`), not from
 * `quick_status` (a weighted average over the top 2% of volume, which lags and skews the price):
 * - `buy_summary`:  the SELL OFFERS, cheapest first. `[0].pricePerUnit` is what an instant buy pays
 *                   (and where a new sell order has to undercut).
 * - `sell_summary`: the BUY ORDERS, highest first. `[0].pricePerUnit` is what an instant sell
 *                   receives (and where a new buy order has to outbid).
 * An empty side has no entries: no price on that side.
 * Base crops are priced from their double-compacted product (`COMPACTED_CROPS`), per crop.
 */

/** Simulator item id -> Bazaar product id. Items not listed (fire, Jerryflower, aloe fragments) are not on the Bazaar. */
export const BAZAAR_PRODUCTS: Readonly<Record<ItemId, string>> = {
  // Base crops (several use their old Minecraft item ids).
  wheat: "WHEAT",
  potato: "POTATO_ITEM",
  carrot: "CARROT_ITEM",
  pumpkin: "PUMPKIN",
  melon: "MELON",
  cocoa_beans: "INK_SACK:3",
  sugar_cane: "SUGAR_CANE",
  cactus: "CACTUS",
  nether_wart: "NETHER_STALK",
  red_mushroom: "RED_MUSHROOM",
  brown_mushroom: "BROWN_MUSHROOM",
  moonflower: "MOONFLOWER",
  sunflower: "DOUBLE_PLANT",
  wild_rose: "WILD_ROSE",
  seeds: "SEEDS",
  // Placed supplies.
  dead_plant: "DEAD_PLANT",
  fermento: "FERMENTO",
  // Rare crops and Harvest Bounty drops.
  cropie: "CROPIE",
  squash: "SQUASH",
  helianthus: "HELIANTHUS",
  ethereal_vine: "ETHEREAL_VINE",
  burrowing_spores: "BURROWING_SPORES",
  overgrown_grass: "OVERGROWN_GRASS",
  overclocker_3000: "OVERCLOCKER_3000",
  iridium: "IRIDIUM",
  evergreen_chip: "EVERGREEN_GARDEN_CHIP",
  synthesis_chip: "SYNTHESIS_GARDEN_CHIP",
  // Mutations (product id = upper-case id).
  ...Object.fromEntries(
    [
      "ashwreath", "choconut", "dustgrain", "gloomgourd", "lonelily", "scourroot", "shadevine", "veilshroom", "witherbloom",
      "chocoberry", "cindershade", "coalroot", "creambloom", "duskbloom", "thornshade", "blastberry", "cheesebite", "chloronite",
      "do_not_eat_shroom", "fleshtrap", "magic_jellybean", "noctilume", "snoozling", "soggybud", "chorus_fruit", "plantboy_advance",
      "puffercloud", "shellfruit", "startlevine", "stoplight_petal", "thunderling", "turtlellini", "zombud", "all_in_aloe",
      "devourer", "glasscorn", "godseed", "phantomleaf", "timestalk",
    ].map((id) => [id, id.toUpperCase()])
  ),
};

/** Can a normal profile buy (and sell) this item on the Bazaar? */
export const isBazaarItem = (item: ItemId): boolean => Object.prototype.hasOwnProperty.call(BAZAAR_PRODUCTS, item);

/**
 * Base crops are sold double-compacted: hardly anyone buys raw crops, so their raw order book is
 * thin and its instant-sell price is near 0, while the compacted products trade hundreds of
 * thousands a week. Every one is 160 enchanted = 160 × 160 = 25,600 crops (Hypixel SkyBlock Wiki
 * crafting recipes). A crop's price is the compacted product's price ÷ `per`, for both sell sides;
 * the leftover under one compacted item is ignored. Crops are planted for free, so the buy side
 * never prices a purchase.
 */
export const COMPACTED_CROPS: Readonly<Record<ItemId, { product: string; name: string; per: number }>> = {
  wheat: { product: "ENCHANTED_HAY_BALE", name: "Enchanted Hay Bale", per: 25_600 },
  potato: { product: "ENCHANTED_BAKED_POTATO", name: "Enchanted Baked Potato", per: 25_600 },
  carrot: { product: "ENCHANTED_GOLDEN_CARROT", name: "Enchanted Golden Carrot", per: 25_600 },
  pumpkin: { product: "POLISHED_PUMPKIN", name: "Polished Pumpkin", per: 25_600 },
  melon: { product: "ENCHANTED_MELON_BLOCK", name: "Enchanted Melon", per: 25_600 },
  cocoa_beans: { product: "ENCHANTED_COOKIE", name: "Enchanted Cookie", per: 25_600 },
  sugar_cane: { product: "ENCHANTED_SUGAR_CANE", name: "Enchanted Sugar Cane", per: 25_600 },
  cactus: { product: "ENCHANTED_CACTUS", name: "Enchanted Cactus", per: 25_600 },
  nether_wart: { product: "MUTANT_NETHER_STALK", name: "Mutant Nether Wart", per: 25_600 },
  red_mushroom: { product: "ENCHANTED_HUGE_MUSHROOM_2", name: "Enchanted Red Mushroom Block", per: 25_600 },
  brown_mushroom: { product: "ENCHANTED_HUGE_MUSHROOM_1", name: "Enchanted Brown Mushroom Block", per: 25_600 },
  moonflower: { product: "COMPACTED_MOONFLOWER", name: "Compacted Moonflower", per: 25_600 },
  sunflower: { product: "COMPACTED_SUNFLOWER", name: "Compacted Sunflower", per: 25_600 },
  wild_rose: { product: "COMPACTED_WILD_ROSE", name: "Compacted Wild Rose", per: 25_600 },
  seeds: { product: "BOX_OF_SEEDS", name: "Box of Seeds", per: 25_600 },
};

/** One product's top of book. Coins per unit; null = that side of the book is empty. */
export interface BazaarQuote {
  /** The cheapest sell offer (`buy_summary[0]`): what an instant buy pays. */
  lowestSellOffer: number | null;
  /** The highest buy order (`sell_summary[0]`): what an instant sell receives. */
  highestBuyOrder: number | null;
}

/** The part of a Bazaar response the simulator keeps, keyed by simulator item id. */
export interface BazaarSnapshot {
  /** The API's `lastUpdated` (ms since epoch). */
  lastUpdated: number;
  quotes: Record<ItemId, BazaarQuote>;
}

const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** `pricePerUnit` of the first entry of an order-book side (already sorted best first by the API). */
const topOf = (side: unknown): number | null => (Array.isArray(side) && side.length ? positive((side[0] as { pricePerUnit?: unknown } | null)?.pricePerUnit) : null);

/**
 * Parse a `/v2/skyblock/bazaar` response, keeping only the items in `BAZAAR_PRODUCTS` (the full
 * response is ~3.5 MB) and only the top of each side of the book. Throws on a response that isn't
 * a successful Bazaar payload.
 */
export function parseBazaar(json: unknown): BazaarSnapshot {
  const body = json as { success?: unknown; lastUpdated?: unknown; products?: unknown } | null;
  if (!body || typeof body !== "object" || body.success !== true || !body.products || typeof body.products !== "object") {
    throw new Error("Not a Bazaar response");
  }
  const products = body.products as Record<string, { buy_summary?: unknown; sell_summary?: unknown } | undefined>;
  const quotes: Record<ItemId, BazaarQuote> = {};
  for (const [item, productId] of Object.entries(BAZAAR_PRODUCTS)) {
    // Base crops: the double-compacted product's book, per crop (falls back to the raw crop if it's missing).
    const compacted = COMPACTED_CROPS[item];
    const c = compacted ? products[compacted.product] : undefined;
    if (compacted && c) {
      const per = (v: number | null) => (v === null ? null : v / compacted.per);
      quotes[item] = { lowestSellOffer: per(topOf(c.buy_summary)), highestBuyOrder: per(topOf(c.sell_summary)) };
      continue;
    }
    const p = products[productId];
    if (!p) continue;
    quotes[item] = { lowestSellOffer: topOf(p.buy_summary), highestBuyOrder: topOf(p.sell_summary) };
  }
  return { lastUpdated: typeof body.lastUpdated === "number" ? body.lastUpdated : 0, quotes };
}

/** Which side of the book a purchase pays: an instant buy, or a (cheaper, slower) buy order. */
export type BuySide = "instant" | "order";
/** Which side a sale receives: a (better, slower) sell order, or an instant sell. */
export type SellSide = "order" | "instant";

export interface BazaarPricing {
  buy: BuySide;
  sell: SellSide;
  /** Bazaar sales tax in percent, taken from every sale. Purchases are untaxed. */
  taxPercent: number;
}

export const DEFAULT_BAZAAR_PRICING: BazaarPricing = { buy: "instant", sell: "order", taxPercent: 1 };

/** A user's manual price for one item, replacing that side of the live book (market manipulation). */
export type BazaarOverride = { lowestSellOffer?: number; highestBuyOrder?: number };

/**
 * Live quotes with the user's overrides on top, per side. Items only in the overrides get a quote
 * with the other side empty. Null when there is nothing at all.
 */
export function withOverrides(live: Readonly<Record<ItemId, BazaarQuote>> | null, overrides: Readonly<Record<ItemId, BazaarOverride>>): Record<ItemId, BazaarQuote> | null {
  const ids = Object.keys(overrides);
  if (!live && ids.length === 0) return null;
  const out: Record<ItemId, BazaarQuote> = { ...(live ?? {}) };
  for (const id of ids) {
    const o = overrides[id];
    const base = out[id] ?? { lowestSellOffer: null, highestBuyOrder: null };
    out[id] = {
      lowestSellOffer: o.lowestSellOffer ?? base.lowestSellOffer,
      highestBuyOrder: o.highestBuyOrder ?? base.highestBuyOrder,
    };
  }
  return out;
}

/**
 * Coins one unit costs on the chosen buy side: an instant buy pays the lowest sell offer, a buy
 * order sits at the highest buy order. Falls back to the other side when one is empty; null when
 * the item has no quote at all.
 */
export function bazaarBuyPrice(quote: BazaarQuote | undefined, side: BuySide): number | null {
  if (!quote) return null;
  return side === "instant" ? quote.lowestSellOffer ?? quote.highestBuyOrder : quote.highestBuyOrder ?? quote.lowestSellOffer;
}

/**
 * Coins one unit brings on the chosen sell side, after tax: a sell order sits at the lowest sell
 * offer, an instant sell takes the highest buy order. Falls back to the other side when one is
 * empty; null when the item has no quote.
 */
export function bazaarSellPrice(quote: BazaarQuote | undefined, side: SellSide, taxPercent: number): number | null {
  if (!quote) return null;
  const gross = side === "order" ? quote.lowestSellOffer ?? quote.highestBuyOrder : quote.highestBuyOrder ?? quote.lowestSellOffer;
  if (gross === null) return null;
  const tax = Math.min(100, Math.max(0, Number.isFinite(taxPercent) ? taxPercent : 0));
  return gross * (1 - tax / 100);
}
