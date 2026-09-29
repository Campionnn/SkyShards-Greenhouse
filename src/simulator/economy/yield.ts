import type { EffectId } from "../data/types";

/**
 * Expected drop multiplier from Farming Fortune.
 *
 * The Farming Fortune page: "farming fortune of 260 -> 3x drops every time and
 * a 60% chance to get 4x drops", i.e. an expected 1 + FF/100 = 3.6. ECONOMICS.md
 * §1.1 prints floor(ff/100) + (ff%100)/100 = 2.6, which contradicts its own
 * quote (and gives zero drops at FF 0), so the quote is implemented. The
 * extra-drop chance is taken as its expectation, not rolled.
 */
export function farmingFortuneMultiplier(ff: number): number {
  return 1 + Math.max(0, ff) / 100;
}

/**
 * The greenhouse yield multiplier sum. All terms are additive; improved
 * harvest boost overrides the base one. `effective` is the post-immunity set.
 */
export function greenhouseYieldSum(effective: ReadonlySet<EffectId>, plantYieldUpgrade: number, uniqueCropBonus: number): number {
  let sum = 1 + plantYieldUpgrade + uniqueCropBonus;
  if (effective.has("improved_harvest_boost")) sum += 0.3;
  else if (effective.has("harvest_boost")) sum += 0.2;
  if (effective.has("harvest_loss")) sum -= 0.2;
  return sum;
}

/**
 * Drops of one harvest, floored per item. Evergreen Chip is the only
 * multiplicative term; it applies to every crop-bundle drop, whether the
 * plant harvested is a base crop or a mutation's own crop bundle.
 */
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
 * How yield scales a mutation's OWN item count (Ashwreath dropping Ashwreath,
 * Chloronite's Mining-Fortune count, Magic Jellybean's stage multiplier,
 * All-in Aloe's fragment total): the greenhouse yield sum multiplies the base
 * count, the floor is guaranteed, and the fractional remainder is the chance
 * of one more. Farming Fortune and Evergreen do NOT apply here - those only
 * scale the crop-bundle drops (`harvestYield`).
 */
export function yieldScaledCount(base: number, yieldSum: number): { whole: number; frac: number } {
  const expected = Math.max(0, base) * Math.max(0, yieldSum);
  const whole = Math.floor(expected + 1e-9);
  return { whole, frac: expected - whole };
}

/**
 * Chloronite's item count from Mining Fortune (staff-sourced ladder, wiki):
 * M>=2000 -> 4; M>=1000 -> 3 + (M-1000)/1000; M>=500 -> 2 + (M-500)/500;
 * M>=100 -> 1 + (M-100)/400; else M/100.
 */
export function chloroniteDropCount(miningFortune: number): number {
  const m = Math.max(0, miningFortune);
  if (m >= 2000) return 4;
  if (m >= 1000) return 3 + (m - 1000) / 1000;
  if (m >= 500) return 2 + (m - 500) / 500;
  if (m >= 100) return 1 + (m - 100) / 400;
  return m / 100;
}

/** Magic Jellybean: harvestable from stage 12, +1 item per 12 stages after, capped. */
export function jellybeanMultiplier(stage: number, cap: number): number {
  if (stage < 12) return 0;
  return Math.min(cap, 1 + Math.floor((stage - 12) / 12));
}
