import type { MutationCreditOrder } from "../config";
import type { KindId, MutationDef } from "../data/types";
import { ringCells } from "../grid/cells";
import { intInclusive } from "../rng";
import type { CycleCtx } from "./context";
import { isDry, isFullyGrown, type Occupancy } from "./plants";
import type { PlantState, PlotState } from "./state";

// Minimum mutations. Each plant has `timesMutated` and `mutatesRemaining` (sim/state.ts).
// - Credit: each spawn requirement {crop, count} credits neighbours of that kind covering `count`
//   ring cells (dry ones skipped), each plant at most once per spawn (`creditInputs`).
// - Pool: per plot and kind, members have helped at least once and are fully grown (`isPooled`).
//   Pool count = sum of members' remaining; may go negative; infinite if any member is.
// - On timer expiry (sim/tick.ts `phaseDecay`): N/A decays, Infinite never, pooled decays iff
//   pool <= 0, otherwise iff own remaining <= 0 (`minimumMet`). Else the timer is extended.
// Everything here except `creditInputs` is read-only.

/** Remaining or pool count; may be negative. null = N/A (no minimum). */
export type MutatesRemaining = number | "infinite" | null;

/** Placed items and Dead Plants count as fully grown; others once `isFullyGrown`. */
function grownForPool(p: PlantState): boolean {
  return p.origin === "placed" || p.isDeadPlant || isFullyGrown(p);
}

/** In its kind's pool on its plot: helped at least once and fully grown. */
export function isPooled(p: PlantState): boolean {
  return p.timesMutated >= 1 && grownForPool(p);
}

/** N/A members add nothing. */
function addToPool(total: MutatesRemaining, r: MutatesRemaining): MutatesRemaining {
  if (r === null) return total;
  if (total === "infinite" || r === "infinite") return "infinite";
  return (total ?? 0) + r;
}

/** Live pool of one kind on a plot; null when no pooled member has a minimum. */
export function combinedRemaining(plot: PlotState, kindId: KindId): MutatesRemaining {
  let total: MutatesRemaining = null;
  for (const q of plot.plants) if (q.kindId === kindId && isPooled(q)) total = addToPool(total, q.mutatesRemaining);
  return total;
}

/** Every kind's pool on a plot in one pass; phaseDecay snapshots this once per tick. */
export function poolSnapshot(plot: PlotState): Map<KindId, MutatesRemaining> {
  const pools = new Map<KindId, MutatesRemaining>();
  for (const q of plot.plants) {
    if (!isPooled(q)) continue;
    pools.set(q.kindId, addToPool(pools.get(q.kindId) ?? null, q.mutatesRemaining));
  }
  return pools;
}

/**
 * May this plant decay when its timer runs out? `combined` is its kind's pool, used only while pooled.
 * N/A: yes. Infinite: no. Pooled: pool <= 0. Otherwise: own remaining <= 0.
 * Missing counters (old saves) read as N/A.
 */
export function minimumMet(p: PlantState, combined: MutatesRemaining): boolean {
  const own = p.mutatesRemaining ?? null;
  if (own === null) return true;
  if (own === "infinite") return false;
  if (isPooled(p)) {
    if (combined === "infinite") return false;
    // null only if the caller's pool omits this plant: fall back to its own count.
    return (combined ?? own) <= 0;
  }
  return own <= 0;
}

/**
 * Timer runs out within `seconds` (Infinity allowed) and the minimum is met now (live pool).
 * Ignores credits that may land in between. Used by "before decay" harvests and `decayImminent`.
 */
export function wouldDecayWithin(plot: PlotState, p: PlantState, seconds: number): boolean {
  if (p.decaySecondsRemaining === null) return false;
  if (Number.isFinite(seconds) && p.decaySecondsRemaining - seconds > 1e-6) return false;
  return minimumMet(p, combinedRemaining(plot, p.kindId));
}

export interface DecayStatus {
  timesMutated: number;
  mutatesRemaining: MutatesRemaining;
  pooled: boolean;
  /** Kind's pool on this plot; null when not pooled. */
  combined: MutatesRemaining;
  /** Expiry now would decay (true) or extend (false). */
  minimumMet: boolean;
}

/** Decay status of one plant, for the UI. */
export function decayStatus(plot: PlotState, p: PlantState): DecayStatus {
  const pooled = isPooled(p);
  const combined = pooled ? combinedRemaining(plot, p.kindId) : null;
  return {
    // Old saves may lack the counters.
    timesMutated: p.timesMutated ?? 0,
    mutatesRemaining: p.mutatesRemaining ?? null,
    pooled,
    combined,
    minimumMet: minimumMet(p, combined),
  };
}

/** Sort key for credit orders: N/A and Infinite sort as Infinity. */
const remainingKey = (r: MutatesRemaining): number => (typeof r === "number" ? r : Infinity);

interface Candidate {
  plant: PlantState;
  /** Spawn ring cells this neighbour covers. */
  cells: number;
  /** First ring cell index, for ring-order ties. */
  first: number;
}

/** Ties fall back to ring order. Only "random" draws RNG. */
function orderCandidates(list: Candidate[], order: MutationCreditOrder, ctx: CycleCtx): Candidate[] {
  const byRing = (a: Candidate, b: Candidate) => a.first - b.first;
  switch (order) {
    case "mostRemainingFirst":
      return list.sort((a, b) => remainingKey(b.plant.mutatesRemaining) - remainingKey(a.plant.mutatesRemaining) || byRing(a, b));
    case "fewestRemainingFirst":
      return list.sort((a, b) => remainingKey(a.plant.mutatesRemaining) - remainingKey(b.plant.mutatesRemaining) || byRing(a, b));
    case "random": {
      // Fisher-Yates over ring order: one intInclusive per position, from the end.
      const out = list.sort(byRing);
      for (let i = out.length - 1; i > 0; i--) {
        const j = intInclusive(ctx.state.rng, 0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    default:
      return list.sort(byRing);
  }
}

/**
 * Credit the neighbours a new spawn used. Called after the spawn is inserted and `occ` updated, so
 * earlier spawns this tick count as neighbours.
 * Per requirement {crop, count}: credit plants of that kind in the 8-way ring until `count` ring
 * cells are covered; a multi-cell neighbour covers all its ring cells and is credited once. Each
 * plant at most once per spawn; dry plants are skipped. No requirements (Godseed, Lonelily): no credit.
 * Surplus neighbours are chosen by `config.mutationCreditOrder`. RNG: only "random", and only when
 * candidates cover more than `count` cells. Emits no event.
 */
export function creditInputs(plot: PlotState, occ: Occupancy, spawned: PlantState, mutation: MutationDef, ctx: CycleCtx): void {
  // Plots never read each other.
  if (mutation.requirements.length === 0 || !plot.plants.includes(spawned)) return;
  const ring = ringCells(spawned.row, spawned.col, spawned.size);
  const credited = new Set<PlantState>();
  for (const req of mutation.requirements) {
    const byPlant = new Map<PlantState, Candidate>();
    for (const idx of ring) {
      const q = occ[idx];
      if (!q || q === spawned || q.kindId !== req.crop || credited.has(q) || isDry(q)) continue;
      const c = byPlant.get(q);
      if (c) c.cells += 1;
      else byPlant.set(q, { plant: q, cells: 1, first: idx });
    }
    let list = [...byPlant.values()];
    const total = list.reduce((n, c) => n + c.cells, 0);
    if (total > req.count) list = orderCandidates(list, ctx.config.mutationCreditOrder, ctx);
    let covered = 0;
    for (const c of list) {
      if (covered >= req.count) break;
      const q = c.plant;
      q.timesMutated = (q.timesMutated ?? 0) + 1;
      if (typeof q.mutatesRemaining === "number") q.mutatesRemaining -= 1;
      credited.add(q);
      covered += c.cells;
    }
  }
}
