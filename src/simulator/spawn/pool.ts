import { SPAWN_POOL_FLOOR } from "../config";
import type { MutationDef } from "../data/types";
import { weightedPick, type RngState } from "../rng";
import type { RingCounts } from "./eligibility";
import { effectiveWeight } from "./multiplicity";

/** A location's spawn pool, in fixed (data.json) order. */
export interface SpawnPool {
  ids: string[];
  weights: number[];
}

/** max(floor, Σweights); the floor defaults to SPAWN_POOL_FLOOR (tests pass their own). */
export function poolDenominator(weights: readonly number[], floor: number = SPAWN_POOL_FLOOR): number {
  let sum = 0;
  for (const w of weights) sum += w;
  return Math.max(floor, sum);
}

export function spawnProbability(pool: SpawnPool, id: string, floor: number = SPAWN_POOL_FLOOR): number {
  const i = pool.ids.indexOf(id);
  if (i < 0) return 0;
  return pool.weights[i] / poolDenominator(pool.weights, floor);
}

export function buildPool(mutations: readonly MutationDef[], ring: RingCounts, specialEligible?: (m: MutationDef) => boolean): SpawnPool {
  const pool: SpawnPool = { ids: [], weights: [] };
  for (const m of mutations) {
    const w = effectiveWeight(m, ring, specialEligible?.(m));
    if (w > 0) {
      pool.ids.push(m.id);
      pool.weights.push(w);
    }
  }
  return pool;
}

/**
 * Bioanalysis: scales every weight by 1 + bonus. Below the floor this raises
 * each mutation's chance by that factor; above it the total stays at 1.
 */
export function applyMutationChanceBonus(pool: SpawnPool, bonus: number): SpawnPool {
  if (!bonus) return pool;
  return { ids: pool.ids, weights: pool.weights.map((w) => w * (1 + bonus)) };
}

/** One roll over the whole pool (not per candidate); the blank fills up to the floor. */
export function rollPool(pool: SpawnPool, rng: RngState, floor: number = SPAWN_POOL_FLOOR): string | null {
  if (pool.ids.length === 0) return null;
  const i = weightedPick(rng, pool.weights, poolDenominator(pool.weights, floor));
  return i < 0 ? null : pool.ids[i];
}
