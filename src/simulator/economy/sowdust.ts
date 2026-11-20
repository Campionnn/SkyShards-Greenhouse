import type { EffectId, ItemId } from "../data/types";

/**
 * Sowdust and Farming XP from Greenhouse harvests. Pure counts: no RNG, nothing rolled.
 *
 * Sowdust (wiki "Sowdust", Greenhouse section): per crop item in the harvested bundle,
 * `5 × ⌊base / (5 × cropMultiplier)⌉ × (1 + fortune / 100)`, summed over the items. `base` is the
 * bundle amount before any yield (the data.json drops; the Jellybean / All-in Aloe stage multiplier
 * scales their drops but not their Sowdust or XP, which are the same at any stage),
 * `fortune` that item's total Farming Fortune (general + crop + the harvest's tool). Only fortune
 * scales it: not Harvest Boost/Loss, Plant Yield, unique crops or Evergreen. The Sowdust modifiers
 * (Elephant pet, Earthy reforge, Blooming weather) don't apply in the Greenhouse. For a mutation's
 * bundle at fortune 0 this is 400 × the kind's loot multiplier.
 */
export const SOWDUST_CROP_MULTIPLIER: Readonly<Record<ItemId, number>> = {
  wheat: 1,
  carrot: 3.5,
  potato: 3,
  pumpkin: 0.85,
  sugar_cane: 2,
  melon: 4,
  cactus: 1.5,
  cocoa_beans: 2,
  red_mushroom: 0.95,
  brown_mushroom: 0.95,
  nether_wart: 3,
  moonflower: 2,
  sunflower: 2,
  wild_rose: 2,
};

/** The wiki's ⌊x⌉: round half up (x is never negative here). The epsilon absorbs float noise at .5. */
const roundHalfUp = (x: number): number => Math.floor(x + 0.5 + 1e-9);

/**
 * Sowdust of one harvested bundle, by crop item (positive amounts only). `baseDrops` is the bundle
 * before yield; `fortuneOf(item)` the item's total Farming Fortune (negative counts as 0). Seeds and
 * anything that isn't one of the 14 crop items give nothing.
 */
export function harvestSowdust(baseDrops: Readonly<Record<ItemId, number>>, fortuneOf: (item: ItemId) => number): Record<ItemId, number> {
  const out: Record<ItemId, number> = {};
  for (const item in baseDrops) {
    const mult = SOWDUST_CROP_MULTIPLIER[item];
    const base = baseDrops[item];
    if (!mult || !(base > 0)) continue;
    const steps = roundHalfUp(base / (5 * mult));
    if (steps <= 0) continue;
    const amount = 5 * steps * (1 + Math.max(0, fortuneOf(item)) / 100);
    if (amount > 0) out[item] = amount;
  }
  return out;
}

/** Farming XP per harvest per unit of the kind's loot multiplier (Wheat 0.18 → 288, Stoplight Petal 25 → 40,000). */
export const FARMING_XP_PER_MULTIPLIER = 1600;

/**
 * The plant's XP effects, additive like the yield sum: Improved XP Boost +30% (replaces XP Boost),
 * XP Boost +20%, XP Loss −20%. `effective` is post-Immunity, so an immune plant has no XP Loss.
 */
export function xpEffectFactor(effective: ReadonlySet<EffectId> | readonly EffectId[]): number {
  const has = Array.isArray(effective) ? (e: EffectId) => effective.includes(e) : (e: EffectId) => (effective as ReadonlySet<EffectId>).has(e);
  let f = 1;
  if (has("improved_xp_boost")) f += 0.3;
  else if (has("xp_boost")) f += 0.2;
  if (has("xp_loss")) f -= 0.2;
  return f;
}

/**
 * Farming XP of one harvest: 1600 × loot multiplier × `bundleMult` (the harvest passes 1: the
 * Jellybean / All-in Aloe stage doesn't change XP; 0 gives 0) × XP effects × (1 + Farming Wisdom /
 * 100). Missing or negative wisdom counts as 0.
 */
export function harvestFarmingXp(multiplier: number, effective: ReadonlySet<EffectId> | readonly EffectId[], wisdom: number | undefined, bundleMult = 1): number {
  if (!(multiplier > 0) || !(bundleMult > 0)) return 0;
  const w = typeof wisdom === "number" && Number.isFinite(wisdom) ? Math.max(0, wisdom) : 0;
  return FARMING_XP_PER_MULTIPLIER * multiplier * bundleMult * xpEffectFactor(effective) * (1 + w / 100);
}
