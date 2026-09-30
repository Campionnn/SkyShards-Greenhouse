import type { GameData } from "../data/types";
import type { PlayerStats } from "../sim/state";

/** Growth Speed Upgrade term: 5% per tier to tier 8, then a jump to 50% at tier 9. Do not interpolate. */
export function upgradeTerm(tier: number): number {
  const t = Math.max(0, Math.min(9, Math.floor(tier)));
  return t === 9 ? 0.5 : 0.05 * t;
}

/**
 * Seconds per growth stage (Greenhouse page):
 *   T = baseline / (1 + 0.025c + 0.0025g + 0.001a + u)
 * c = unique crop groups across ALL plots, g = Crop Growth, a = Speed Attribute.
 */
export function cycleSeconds(
  stats: Pick<PlayerStats, "cropGrowth" | "speedAttribute" | "growthUpgradeTier">,
  uniqueCrops: number,
  baselineSeconds: number
): number {
  const c = Math.max(0, Math.min(12, uniqueCrops));
  const denom = 1 + 0.025 * c + 0.0025 * stats.cropGrowth + 0.001 * stats.speedAttribute + upgradeTerm(stats.growthUpgradeTier);
  return baselineSeconds / denom;
}

/** Unique Greenhouse Crop Bonus to yield: +3% per unique group, to +36%. */
export function uniqueCropYieldBonus(uniqueCrops: number): number {
  return 0.03 * Math.max(0, Math.min(12, uniqueCrops));
}

/** How many of the 12 groups have at least one member standing (either member of a merged pair counts). */
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
