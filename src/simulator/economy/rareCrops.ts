import { chance, type RngState } from "../rng";

/**
 * Rare Crops from farming armor tiered bonuses (wiki armor and item pages).
 * In the Greenhouse every harvest of a "Harvestable" crop or mutation rolls
 * each drop the set grants once. Assumes the full 4/4 set.
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

/** Drops the set rolls. `withBug`: no Cropie/Squash in Fermento or Helianthus Armor (wiki-reported bug). */
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
 * Items from one roll at `p` (may exceed 1). Uncapped: floor guaranteed plus
 * one roll on the fraction. Capped: at most one item. Draws at most one RNG
 * number, none when the outcome is certain.
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
