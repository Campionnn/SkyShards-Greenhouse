import type { SimConfig } from "../config";
import type { GameData } from "../data/types";
import type { PlayerStats } from "../sim/state";

/** Growth Speed Upgrade term: 5% per tier to tier 8, then a jump to 50% at tier 9. Do not interpolate. */
export function upgradeTerm(tier: number): number {
  const t = Math.max(0, Math.min(9, Math.floor(tier)));
  return t === 9 ? 0.5 : 0.05 * t;
}

/** The Flora attribute shard grants 1-10 Unique Crop Bonus (0.27.2). */
export const FLORA_SHARD_MAX = 10;

/** A unique crop count clamped to [0, cap]: the bonus is linear up to the cap. */
function countedUniqueCrops(uniqueCrops: number, cap: number): number {
  if (!Number.isFinite(uniqueCrops)) return 0;
  return Math.max(0, Math.min(cap, uniqueCrops));
}

/**
 * Unique crops the Unique Crop Bonus counts (0.27.2):
 *   min(cap, standing + clamp(flora, 0, 10))
 * `standing` = unique crop groups standing across ALL plots (`countUniqueCropGroups`),
 * `flora` = the Flora attribute shard (whole crops; missing or invalid = 0).
 */
export function effectiveUniqueCrops(standing: number, flora: number | undefined, cap: number): number {
  const f = typeof flora === "number" && Number.isFinite(flora) ? Math.max(0, Math.min(FLORA_SHARD_MAX, Math.floor(flora))) : 0;
  const s = Number.isFinite(standing) ? Math.max(0, standing) : 0;
  return Math.min(cap, s + f);
}

/**
 * Seconds per growth stage (Greenhouse page, 0.27.2 unique crop bonus):
 *   T = baseline / (1 + r*c + 0.0025g + 0.001a + u)
 * c = unique crops counted (`effectiveUniqueCrops`: groups standing across ALL
 * plots + Flora), clamped to [0, uniqueCropCap]; r = uniqueCropGrowthPerCrop
 * (+2.5% each, +25% at 10); g = Crop Growth; a = Speed Attribute;
 * u = Growth Speed Upgrade term.
 */
export function cycleSeconds(
  stats: Pick<PlayerStats, "cropGrowth" | "speedAttribute" | "growthUpgradeTier">,
  uniqueCrops: number,
  config: Pick<SimConfig, "cycleBaselineSeconds" | "uniqueCropCap" | "uniqueCropGrowthPerCrop">
): number {
  const c = countedUniqueCrops(uniqueCrops, config.uniqueCropCap);
  const denom = 1 + config.uniqueCropGrowthPerCrop * c + 0.0025 * stats.cropGrowth + 0.001 * stats.speedAttribute + upgradeTerm(stats.growthUpgradeTier);
  return config.cycleBaselineSeconds / denom;
}

/**
 * Unique Crop Bonus to harvest yield (0.27.2): uniqueCropYieldPerCrop per unique
 * crop counted, linear up to uniqueCropCap (+2.5% each, +25% at 10). An additive
 * term of the greenhouse yield sum.
 */
export function uniqueCropYieldBonus(uniqueCrops: number, config: Pick<SimConfig, "uniqueCropCap" | "uniqueCropYieldPerCrop">): number {
  return config.uniqueCropYieldPerCrop * countedUniqueCrops(uniqueCrops, config.uniqueCropCap);
}

/**
 * How many of the 12 groups have at least one member standing (either member of
 * a merged pair counts). The bonus itself caps lower (`uniqueCropCap`).
 */
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
