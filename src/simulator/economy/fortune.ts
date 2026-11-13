import type { ItemId } from "../data/types";

/**
 * Per-crop Farming Fortune. Hypixel has one crop-specific fortune stat per crop (Wheat Fortune,
 * Mushroom Fortune, ...); it adds to the general Farming Fortune for that crop's drops only.
 * Mushroom Fortune covers both mushrooms and Wheat Fortune covers seeds, as in the game.
 */
export const FORTUNE_CROPS = [
  "wheat",
  "carrot",
  "potato",
  "pumpkin",
  "melon",
  "sugar_cane",
  "cactus",
  "cocoa_beans",
  "nether_wart",
  "mushroom",
  "sunflower",
  "moonflower",
  "wild_rose",
] as const;

export type FortuneCrop = (typeof FORTUNE_CROPS)[number];

/** Crop-specific fortune per crop, on top of the general value. A missing crop is 0. */
export type CropFortune = Partial<Record<FortuneCrop, number>>;

/**
 * One farming tool, while held: `farmingFortune` is its general Farming Fortune (reforge, Farming
 * for Dummies, gems, Harvesting, Cultivating) and counts on every crop; `fortune[c]` is its
 * crop-specific fortune (tool level, Turbo, Dedication) on its own crops (missing = 0). Tools saved
 * before `farmingFortune` existed carry both parts in `fortune` and no general term.
 */
export interface FarmingToolStats {
  name: string;
  farmingFortune?: number;
  fortune: CropFortune;
}

const ITEM_CROP: Readonly<Record<string, FortuneCrop>> = {
  red_mushroom: "mushroom",
  brown_mushroom: "mushroom",
  seeds: "wheat",
};

const isFortuneCrop = (s: string): s is FortuneCrop => (FORTUNE_CROPS as readonly string[]).includes(s);

/** The fortune stat that scales a drop item, or null when it is not a base crop. */
export function fortuneCropOf(item: ItemId): FortuneCrop | null {
  const mapped = ITEM_CROP[item];
  if (mapped) return mapped;
  return isFortuneCrop(item) ? item : null;
}

/** The fortune stats `harvestFortune` reads. */
export interface FortuneStats {
  farmingFortune: number;
  cropFortune?: CropFortune;
  tools?: readonly FarmingToolStats[];
}

const num = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The held tool's fortune on one crop: its general Farming Fortune + its crop-specific fortune there. */
export function toolFortune(tool: FarmingToolStats, crop: FortuneCrop): number {
  return num(tool.farmingFortune) + num(tool.fortune[crop]);
}

/**
 * Total Farming Fortune on one drop item: general + crop-specific + the held tool's (its general
 * part on every crop, its crop part on its own crops). Non-crops get the general values only.
 */
export function itemFortune(stats: FortuneStats, item: ItemId, tool: FarmingToolStats | null): number {
  const crop = fortuneCropOf(item);
  if (!crop) return stats.farmingFortune + (tool ? num(tool.farmingFortune) : 0);
  return stats.farmingFortune + num(stats.cropFortune?.[crop]) + (tool ? toolFortune(tool, crop) : 0);
}

/**
 * The tool a harvest of `drops` (a crop bundle before fortune) is made with: the one adding the
 * most coins, `Σ qty × price × toolFortune(tool, crop)` (fortune is linear in the drop count). Ties and
 * an all-zero gain keep the first listed tool; no tools → null. Deterministic, no RNG.
 */
export function bestTool(drops: Readonly<Record<string, number>>, tools: readonly FarmingToolStats[] | undefined, price: (item: ItemId) => number): FarmingToolStats | null {
  if (!tools || tools.length === 0) return null;
  let best = tools[0];
  let bestGain = -Infinity;
  for (const tool of tools) {
    let gain = 0;
    for (const item in drops) {
      const crop = fortuneCropOf(item);
      if (crop) gain += drops[item] * price(item) * toolFortune(tool, crop);
    }
    if (gain > bestGain) {
      best = tool;
      bestGain = gain;
    }
  }
  return best;
}

/** Whether any per-crop term is set (crop fortune or a tool): otherwise one multiplier covers every item. */
export function hasPerCropFortune(stats: FortuneStats): boolean {
  if (stats.tools && stats.tools.length > 0) return true;
  const cf = stats.cropFortune;
  if (!cf) return false;
  for (const k in cf) if (num(cf[k as FortuneCrop]) !== 0) return true;
  return false;
}
