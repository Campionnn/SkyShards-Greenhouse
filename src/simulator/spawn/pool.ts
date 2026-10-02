import type { SimConfig } from "../config";
import type { MutationDef } from "../data/types";
import { weightedPick, type RngState } from "../rng";
import type { RingCounts } from "./eligibility";
import { effectiveWeight } from "./multiplicity";

/** A location's spawn pool, in fixed (data.json) order. */
export interface SpawnPool {
  ids: string[];
  weights: number[];
}

export function poolDenominator(weights: readonly number[], blankFillTo: number): number {
  let sum = 0;
  for (const w of weights) sum += w;
  return Math.max(blankFillTo, sum);
}

export function spawnProbability(pool: SpawnPool, id: string, blankFillTo: number): number {
  const i = pool.ids.indexOf(id);
  if (i < 0) return 0;
  return pool.weights[i] / poolDenominator(pool.weights, blankFillTo);
}

export function buildPool(
  mutations: readonly MutationDef[],
  ring: RingCounts,
  config: Pick<SimConfig, "weightModel" | "supportPerCell" | "supportCap">,
  specialEligible?: (m: MutationDef) => boolean
): SpawnPool {
  const pool: SpawnPool = { ids: [], weights: [] };
  for (const m of mutations) {
    const w = effectiveWeight(m, ring, config, specialEligible?.(m));
    if (w > 0) {
      pool.ids.push(m.id);
      pool.weights.push(w);
    }
  }
  return pool;
}

/**
 * The Bioanalysis accessory line (Talisman/Ring/Artifact) multiplies the chance
 * for a crop to mutate by 1 + bonus. In this pool model that is a uniform scale
 * on every mutation weight: while the pool sits under the floor the denominator
 * stays at `blankFillTo`, so the mutation arm - and every mutation's share of it -
 * grows by exactly that factor. Once the weights fill the floor the pool already
 * takes every roll, so the scale cannot push the total past 1.
 */
export function applyMutationChanceBonus(pool: SpawnPool, bonus: number): SpawnPool {
  if (!bonus) return pool;
  return { ids: pool.ids, weights: pool.weights.map((w) => w * (1 + bonus)) };
}

/**
 * ONE roll over the whole pool: any candidate can win, and the blank absorbs
 * the slack below the floor. Rolling per candidate would break dilution.
 */
export function rollPool(pool: SpawnPool, rng: RngState, blankFillTo: number): string | null {
  if (pool.ids.length === 0) return null;
  const i = weightedPick(rng, pool.weights, poolDenominator(pool.weights, blankFillTo));
  return i < 0 ? null : pool.ids[i];
}
