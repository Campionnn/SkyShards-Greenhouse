import { chance, type RngState } from "../rng";

/**
 * Rare Crops from the farming armor tiered bonuses, inside the Greenhouse
 * (Hypixel SkyBlock Wiki: Tater / Cropie / Squash / Fermento / Helianthus
 * Armor, and the Cropie / Squash / Fermento / Helianthus item pages).
 *
 * Inside the Greenhouse every harvest of a crop or mutation with a
 * "Harvestable" status rolls each drop the set grants, once. The simulator
 * assumes the full 4/4 set. Fermento Armor combines the Tater, Cropie and
 * Squash bonuses and adds Helianthus; Helianthus Armor combines all four.
 */
export type ArmorSet = "none" | "tater" | "cropie" | "squash" | "fermento" | "helianthus";

export const ARMOR_SETS: readonly ArmorSet[] = ["none", "tater", "cropie", "squash", "fermento", "helianthus"];

export const ARMOR_SET_LABEL: Record<ArmorSet, string> = {
  none: "None",
  tater: "Tater Armor",
  cropie: "Cropie Armor",
  squash: "Squash Armor",
  fermento: "Fermento Armor",
  helianthus: "Helianthus Armor",
};

/** Greenhouse drop chance per harvest at 4/4 pieces, before Overbloom. */
export const GREENHOUSE_RARE_CROP_CHANCE: Record<string, number> = {
  cropie: 0.2,
  squash: 0.12,
  fermento: 0.028,
  helianthus: 0.016,
};

/** Every Rare Crop the simulator can drop (armor bonuses + a mutation's Ethereal Vine). */
export const RARE_CROP_ITEMS: readonly string[] = ["cropie", "squash", "fermento", "helianthus", "ethereal_vine"];

/** Which rare crops each set rolls, in roll order. */
export const ARMOR_SET_DROPS: Record<ArmorSet, readonly string[]> = {
  none: [],
  tater: ["cropie"],
  cropie: ["squash"],
  squash: ["fermento"],
  fermento: ["cropie", "squash", "fermento", "helianthus"],
  helianthus: ["cropie", "squash", "fermento", "helianthus"],
};

/**
 * The drops the set actually rolls. `withBug` models the wiki-reported bug:
 * Cropie and Squash do not drop from Greenhouse crops while wearing Fermento
 * or Helianthus Armor.
 */
export function armorRareCrops(set: ArmorSet | undefined, withBug: boolean): readonly string[] {
  const drops = ARMOR_SET_DROPS[set ?? "none"] ?? [];
  if (withBug && (set === "fermento" || set === "helianthus")) return drops.filter((d) => d !== "cropie" && d !== "squash");
  return drops;
}

/** Overbloom: Chance = BaseChance x (1 + Overbloom / 100). Uncapped. */
export function overbloomMultiplier(overbloom: number): number {
  return 1 + Math.max(0, overbloom || 0) / 100;
}

/**
 * Items from one rare-crop roll at `p` (which may exceed 1 with Overbloom).
 * Uncapped: the whole part is guaranteed and the fraction is one roll for one
 * more (175% = 1 + a 75% roll). Capped: at most one item, one roll. Consumes
 * at most one random number, and none when the outcome is certain.
 */
export function rollRareCount(rng: RngState, p: number, capAt100: boolean): number {
  if (!(p > 0)) return 0;
  if (capAt100) return chance(rng, p) ? 1 : 0;
  const whole = Math.floor(p);
  const frac = p - whole;
  return whole + (frac > 1e-9 && chance(rng, frac) ? 1 : 0);
}

/** Expected items per harvest for one roll at `p` (for the UI). */
export function expectedRareCount(p: number, capAt100: boolean): number {
  return capAt100 ? Math.min(1, Math.max(0, p)) : Math.max(0, p);
}
