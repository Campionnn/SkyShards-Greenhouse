import type { Rarity } from "../data/types";

/**
 * Harvest Bounty: independent roll (not a yield multiplier) when harvesting a
 * plant holding Bonus Drops. Rates from the wiki Greenhouse page.
 */
export const HARVEST_BOUNTY: ReadonlyArray<readonly [item: string, chance: number]> = [
  ["burrowing_spores", 0.002],
  ["ethereal_vine", 0.05],
  ["evergreen_chip", 0.03],
  ["iridium", 0.002],
  ["overclocker_3000", 0.0005],
  ["overgrown_grass", 0.001],
  ["synthesis_chip", 0.03],
];

/** Ethereal Vine dropped directly by a harvested mutation, by rarity. */
export const ETHEREAL_VINE_BY_RARITY: Record<Rarity, number> = {
  common: 0.15,
  uncommon: 0.2,
  rare: 0.25,
  epic: 0.3,
  legendary: 0.4,
};

export const RARE_DROP_ITEMS: string[] = HARVEST_BOUNTY.map(([item]) => item);

/** Map one uniform [0,1) roll onto the bounty table. */
export function bountyFromRoll(roll: number): string | null {
  let acc = 0;
  for (const [item, p] of HARVEST_BOUNTY) {
    acc += p;
    if (roll < acc) return item;
  }
  return null;
}
