import type { GameData, ItemId } from "../data/types";

/**
 * NPC-only pricing. Mutation items are Bazaar-only and not NPC-sellable, so
 * they are worth 0 here; the UI labels them "NPC-only". Keep this behind the
 * PriceSource interface so a Bazaar source can slot in without touching the sim.
 */
export interface PriceSource {
  price(item: ItemId): number;
}

/**
 * NPC sell prices of non-crop items, from the Hypixel SkyBlock Wiki (`sell`
 * field of each item's infobox). Base-crop prices come from data.json
 * (`sell_price`), which matches the wiki. Items the wiki lists as not
 * NPC-sellable (Iridium) are 0. The Evergreen and Synthesis Chips default to
 * 50,000 here. `rareDropValues` in the config overrides any of these.
 */
export const WIKI_NPC_PRICES: Record<string, number> = {
  seeds: 3,
  dead_plant: 500,
  cropie: 25_000,
  squash: 75_000,
  fermento: 250_000,
  helianthus: 275_000,
  ethereal_vine: 20_000,
  overclocker_3000: 250_000,
  burrowing_spores: 1,
  overgrown_grass: 1,
  evergreen_chip: 50_000,
  synthesis_chip: 50_000,
  iridium: 0,
};

/** Default NPC price of an item, ignoring overrides. */
export function defaultNpcPrice(data: GameData, item: ItemId): number {
  if (item in WIKI_NPC_PRICES) return WIKI_NPC_PRICES[item];
  const crop = data.crops[item];
  if (crop) return crop.sellPrice;
  return 0;
}

export function npcPriceSource(data: GameData, overrides: Record<string, number> = {}): PriceSource {
  return {
    price(item) {
      const o = overrides[item];
      if (typeof o === "number" && Number.isFinite(o)) return o;
      return defaultNpcPrice(data, item);
    },
  };
}

export function valueOf(drops: Record<ItemId, number>, prices: PriceSource): number {
  let total = 0;
  for (const [item, qty] of Object.entries(drops)) total += qty * prices.price(item);
  return total;
}
