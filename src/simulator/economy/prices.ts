import type { GameData, ItemId } from "../data/types";

/**
 * NPC-only pricing; mutation items are not NPC-sellable, so they are worth 0.
 * Behind an interface so a Bazaar source can replace it.
 */
export interface PriceSource {
  price(item: ItemId): number;
}

/**
 * Wiki NPC sell prices of non-crop items (base crops use data.json
 * `sell_price`). Non-sellable items (Iridium) are 0; Evergreen and Synthesis
 * Chips are 50,000.
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

/** NPC price of an item: the wiki table, else the crop's data.json sell price, else 0. */
export function defaultNpcPrice(data: GameData, item: ItemId): number {
  if (item in WIKI_NPC_PRICES) return WIKI_NPC_PRICES[item];
  const crop = data.crops[item];
  if (crop) return crop.sellPrice;
  return 0;
}

export function npcPriceSource(data: GameData): PriceSource {
  return { price: (item) => defaultNpcPrice(data, item) };
}

export function valueOf(drops: Record<ItemId, number>, prices: PriceSource): number {
  let total = 0;
  for (const [item, qty] of Object.entries(drops)) total += qty * prices.price(item);
  return total;
}
