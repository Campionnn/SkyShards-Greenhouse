import { JELLYBEAN_MULTIPLIER_CAP } from "../config";
import type { EffectId } from "../data/types";

/**
 * Expected Farming Fortune drop multiplier, 1 + FF/100 (wiki: FF 260 = 3x plus
 * 60% for 4x). ECONOMICS.md §1.1's floor formula contradicts its own quote and
 * is not used. The extra drop is taken as its expectation, not rolled.
 */
export function farmingFortuneMultiplier(ff: number): number {
  return 1 + Math.max(0, ff) / 100;
}

/** Additive greenhouse yield sum; improved harvest boost overrides the base one. `effective` is post-immunity. */
export function greenhouseYieldSum(effective: ReadonlySet<EffectId> | readonly EffectId[], plantYieldUpgrade: number, uniqueCropBonus: number): number {
  const has = Array.isArray(effective) ? (e: EffectId) => effective.includes(e) : (e: EffectId) => (effective as ReadonlySet<EffectId>).has(e);
  let sum = 1 + plantYieldUpgrade + uniqueCropBonus;
  if (has("improved_harvest_boost")) sum += 0.3;
  else if (has("harvest_boost")) sum += 0.2;
  if (has("harvest_loss")) sum -= 0.2;
  return sum;
}

/**
 * Crop-bundle drops of one harvest, floored per item. Evergreen Chip is the only multiplicative
 * term. `ffMultiplier` is one Farming Fortune multiplier for every item, or a per-item lookup
 * (per-crop fortune, economy/fortune.ts).
 */
export function harvestYield(baseDrops: Record<string, number>, ffMultiplier: number | ((item: string) => number), yieldSum: number, evergreen: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof ffMultiplier === "number") {
    const factor = ffMultiplier * yieldSum * (1 + evergreen);
    for (const item in baseDrops) {
      const n = Math.floor(baseDrops[item] * factor + 1e-9);
      if (n > 0) out[item] = n;
    }
    return out;
  }
  for (const item in baseDrops) {
    // Same factor and grouping as the number form, so a constant lookup floors identically.
    const factor = ffMultiplier(item) * yieldSum * (1 + evergreen);
    const n = Math.floor(baseDrops[item] * factor + 1e-9);
    if (n > 0) out[item] = n;
  }
  return out;
}

/**
 * Scales a mutation's own item count (Ashwreath, Chloronite, Jellybean, Aloe)
 * by `yieldSum`: floor guaranteed, fraction is the chance of one more. The
 * harvest passes 1 (current game) or the yield sum (`legacyMutationYield`).
 * Farming Fortune and Evergreen apply only to crop bundles (`harvestYield`).
 */
export function yieldScaledCount(base: number, yieldSum: number): { whole: number; frac: number } {
  const expected = Math.max(0, base) * Math.max(0, yieldSum);
  const whole = Math.floor(expected + 1e-9);
  return { whole, frac: expected - whole };
}

/** Chloronite item count from Mining Fortune (wiki ladder), capped at 4 from 2000. */
export function chloroniteDropCount(miningFortune: number): number {
  const m = Math.max(0, miningFortune);
  if (m >= 2000) return 4;
  if (m >= 1000) return 3 + (m - 1000) / 1000;
  if (m >= 500) return 2 + (m - 500) / 500;
  if (m >= 100) return 1 + (m - 100) / 400;
  return m / 100;
}

/** Magic Jellybean: harvestable from stage 12, +1 item per 12 stages after, capped at JELLYBEAN_MULTIPLIER_CAP. */
export function jellybeanMultiplier(stage: number): number {
  if (stage < 12) return 0;
  return Math.min(JELLYBEAN_MULTIPLIER_CAP, 1 + Math.floor((stage - 12) / 12));
}
