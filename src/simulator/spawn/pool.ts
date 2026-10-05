import { SPAWN_POOL_FLOOR, SPAWN_PRIORITY } from "../config";
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

/**
 * How one roll at a cell is made from its pool (`SPAWN_PRIORITY` in config.ts):
 * - `excluded`: mutations shut out by an eligible `exclusive` one (Zombud shuts out
 *   Witherbloom), with the id that shut them out.
 * - `first`: eligible `rollFirst` mutations (Godseed), in pool order. Each rolls alone,
 *   weight / max(floor, weight); the first hit spawns.
 * - `main`: the one weighted roll made if every `first` roll missed (the old single roll
 *   when there is no priority mutation).
 */
export interface SpawnPlan {
  first: { id: string; weight: number }[];
  main: SpawnPool;
  excluded: { id: string; by: string }[];
}

export function planPool(pool: SpawnPool): SpawnPlan {
  const exclusiveAt = pool.ids.findIndex((id) => SPAWN_PRIORITY[id] === "exclusive");
  const excluded: SpawnPlan["excluded"] = [];
  let kept = pool;
  if (exclusiveAt >= 0) {
    kept = { ids: [], weights: [] };
    pool.ids.forEach((id, i) => {
      if (SPAWN_PRIORITY[id] === "exclusive") {
        kept.ids.push(id);
        kept.weights.push(pool.weights[i]);
      } else excluded.push({ id, by: pool.ids[exclusiveAt] });
    });
  }
  const first: SpawnPlan["first"] = [];
  const main: SpawnPool = { ids: [], weights: [] };
  kept.ids.forEach((id, i) => {
    if (SPAWN_PRIORITY[id] === "rollFirst") first.push({ id, weight: kept.weights[i] });
    else {
      main.ids.push(id);
      main.weights.push(kept.weights[i]);
    }
  });
  return { first, main, excluded };
}

/** Chance per roll of each mutation in the pool (ids absent: 0), priority included. */
export function spawnChances(pool: SpawnPool, floor: number = SPAWN_POOL_FLOOR): Record<string, number> {
  const plan = planPool(pool);
  const out: Record<string, number> = {};
  let miss = 1;
  for (const f of plan.first) {
    const p = f.weight / Math.max(floor, f.weight);
    out[f.id] = miss * p;
    miss *= 1 - p;
  }
  const den = poolDenominator(plan.main.weights, floor);
  plan.main.ids.forEach((id, i) => {
    out[id] = miss * (plan.main.weights[i] / den);
  });
  for (const e of plan.excluded) out[e.id] = 0;
  return out;
}

export function spawnProbability(pool: SpawnPool, id: string, floor: number = SPAWN_POOL_FLOOR): number {
  return spawnChances(pool, floor)[id] ?? 0;
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

/**
 * One spawn roll at a cell (see `planPool`): each `rollFirst` mutation draws once on its
 * own, then (if all missed) one draw over the rest; the blank fills up to the floor.
 * Draws one RNG number per `rollFirst` roll made plus one for the main roll (if non-empty),
 * so a pool without priority mutations draws exactly one, as before.
 */
export function rollPool(pool: SpawnPool, rng: RngState, floor: number = SPAWN_POOL_FLOOR): string | null {
  if (pool.ids.length === 0) return null;
  const plan = planPool(pool);
  for (const f of plan.first) {
    if (weightedPick(rng, [f.weight], Math.max(floor, f.weight)) === 0) return f.id;
  }
  if (plan.main.ids.length === 0) return null;
  const i = weightedPick(rng, plan.main.weights, poolDenominator(plan.main.weights, floor));
  return i < 0 ? null : plan.main.ids[i];
}
