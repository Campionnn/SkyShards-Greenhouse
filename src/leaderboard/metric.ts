import type { ItemId } from "../simulator/data/types";

/**
 * What a flow is measured by (docs/plans/sowdust-xp-collection.md): coins (the default), the
 * collection of one base crop, Sowdust or Farming XP, all per day. Shared by the /flows ranking
 * and the simulator's focus metric (headline numbers and the Monte Carlo sweep). Not part of the
 * verify bundle: only page code imports it.
 */

export type RankBy = "coins" | "collection" | "sowdust" | "xp";
export const RANK_BYS: readonly RankBy[] = ["coins", "collection", "sowdust", "xp"];

/** The greenhouse base-crop items a collection can be ranked by (mushrooms apart). */
export const COLLECTION_CROPS: readonly ItemId[] = [
  "wheat",
  "carrot",
  "potato",
  "pumpkin",
  "melon",
  "sugar_cane",
  "cactus",
  "cocoa_beans",
  "red_mushroom",
  "brown_mushroom",
  "nether_wart",
  "sunflower",
  "moonflower",
  "wild_rose",
];

export interface RankMetric {
  by: RankBy;
  /** The crop item, used only when `by` is "collection". */
  crop: ItemId;
}

export const DEFAULT_COLLECTION_CROP: ItemId = "wheat";
export const COINS_METRIC: RankMetric = { by: "coins", crop: DEFAULT_COLLECTION_CROP };

export const RANK_BY_LABEL: Record<RankBy, string> = { coins: "Coins", collection: "Collection", sowdust: "Sowdust", xp: "Farming XP" };

export const isRankBy = (v: unknown): v is RankBy => typeof v === "string" && (RANK_BYS as readonly string[]).includes(v);
export const isCollectionCrop = (v: unknown): v is ItemId => typeof v === "string" && COLLECTION_CROPS.includes(v);

/** A metric from loose input (URL, localStorage): unknown values fall back to coins / wheat. */
export function readMetric(by: unknown, crop: unknown): RankMetric {
  return { by: isRankBy(by) ? by : "coins", crop: isCollectionCrop(crop) ? crop : DEFAULT_COLLECTION_CROP };
}

export const sameMetric = (a: RankMetric, b: RankMetric): boolean => a.by === b.by && (a.by !== "collection" || a.crop === b.crop);

/** A stable key ("coins", "collection:wheat", "sowdust", "xp"). */
export const metricKey = (m: RankMetric): string => (m.by === "collection" ? `collection:${m.crop}` : m.by);
