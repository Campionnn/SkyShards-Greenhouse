import { CYCLE_BASELINE_SECONDS, UNIQUE_CROP_CAP, UNIQUE_CROP_GROWTH_PER_CROP, UNIQUE_CROP_YIELD_PER_CROP } from "../config";
import type { GameData } from "../data/types";
import type { PlayerStats } from "../sim/state";

/** Growth Speed Upgrade: 5% per tier through tier 8, 50% at tier 9 (not linear). */
export function upgradeTerm(tier: number): number {
  const t = Math.max(0, Math.min(9, Math.floor(tier)));
  return t === 9 ? 0.5 : 0.05 * t;
}

/** The Flora attribute shard grants 1-10 unique crops. */
export const FLORA_SHARD_MAX = 10;

function countedUniqueCrops(uniqueCrops: number): number {
  if (!Number.isFinite(uniqueCrops)) return 0;
  return Math.max(0, Math.min(UNIQUE_CROP_CAP, uniqueCrops));
}

/** min(UNIQUE_CROP_CAP, standing groups across all plots + clamp(flora, 0, 10)). Invalid flora = 0. */
export function effectiveUniqueCrops(standing: number, flora: number | undefined): number {
  const f = typeof flora === "number" && Number.isFinite(flora) ? Math.max(0, Math.min(FLORA_SHARD_MAX, Math.floor(flora))) : 0;
  const s = Number.isFinite(standing) ? Math.max(0, standing) : 0;
  return Math.min(UNIQUE_CROP_CAP, s + f);
}

/**
 * Seconds per growth stage (wiki Greenhouse page):
 *   T = baseline / (1 + r*c + 0.0025g + 0.001a + u)
 * c = unique crops clamped to [0, UNIQUE_CROP_CAP], r = UNIQUE_CROP_GROWTH_PER_CROP,
 * g = Crop Growth, a = Speed Attribute, u = `upgradeTerm`.
 */
export function cycleSeconds(stats: Pick<PlayerStats, "cropGrowth" | "speedAttribute" | "growthUpgradeTier">, uniqueCrops: number): number {
  const c = countedUniqueCrops(uniqueCrops);
  const denom = 1 + UNIQUE_CROP_GROWTH_PER_CROP * c + 0.0025 * stats.cropGrowth + 0.001 * stats.speedAttribute + upgradeTerm(stats.growthUpgradeTier);
  return CYCLE_BASELINE_SECONDS / denom;
}

/** Additive yield-sum term: UNIQUE_CROP_YIELD_PER_CROP per unique crop, up to UNIQUE_CROP_CAP. */
export function uniqueCropYieldBonus(uniqueCrops: number): number {
  return UNIQUE_CROP_YIELD_PER_CROP * countedUniqueCrops(uniqueCrops);
}

/** Number of the 12 unique crop groups with a member standing. */
export function countUniqueCropGroups(standingKinds: ReadonlySet<string>, data: GameData): number {
  let n = 0;
  for (const group of data.uniqueCropGroups) {
    if (group.some((id) => standingKinds.has(id))) n++;
  }
  return n;
}

/** Hour of day (0..24) at an absolute simulated time. */
export function hourOfDay(startTimeOfDay: number, seconds: number): number {
  const h = (startTimeOfDay + seconds / 3600) % 24;
  return h < 0 ? h + 24 : h;
}
