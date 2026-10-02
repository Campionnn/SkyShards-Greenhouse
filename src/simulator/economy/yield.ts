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
export function greenhouseYieldSum(effective: ReadonlySet<EffectId>, plantYieldUpgrade: number, uniqueCropBonus: number): number {
  let sum = 1 + plantYieldUpgrade + uniqueCropBonus;
  if (effective.has("improved_harvest_boost")) sum += 0.3;
  else if (effective.has("harvest_boost")) sum += 0.2;
  if (effective.has("harvest_loss")) sum -= 0.2;
  return sum;
}

/** Crop-bundle drops of one harvest, floored per item. Evergreen Chip is the only multiplicative term. */
export function harvestYield(baseDrops: Record<string, number>, ffMultiplier: number, yieldSum: number, evergreen: number): Record<string, number> {
  const factor = ffMultiplier * yieldSum * (1 + evergreen);
  const out: Record<string, number> = {};
  for (const [item, qty] of Object.entries(baseDrops)) {
    const n = Math.floor(qty * factor + 1e-9);
    if (n > 0) out[item] = n;
  }
  return out;
}

/**
 * Scales a mutation's own item count (Ashwreath, Chloronite, Jellybean, Aloe)
 * by the yield sum: floor guaranteed, fraction is the chance of one more.
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
