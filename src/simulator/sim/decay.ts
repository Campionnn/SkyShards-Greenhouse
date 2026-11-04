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
 * Credit the neighbours a new spawn used. `phaseSpawn` passes the occupancy as the tick found it:
 * all cells roll at once, so another spawn of the same tick is never a neighbour.
 * Per requirement {crop, count}: credit plants of that kind in the 8-way ring until `count` ring
 * cells are covered; a multi-cell neighbour covers all its ring cells and is credited once. Each
 * plant at most once per spawn; dry plants are skipped. No requirements (Godseed, Lonelily): no credit.
 * Surplus neighbours are chosen by `config.mutationCreditOrder`. RNG: only "random", and only when
 * candidates cover more than `count` cells. Emits no event.
 */
export function creditInputs(plot: PlotState, occ: Occupancy, spawned: PlantState, mutation: MutationDef, ctx: CycleCtx, inserted = false): void {
  // Plots never read each other. (`inserted`: the caller just put `spawned` on this plot.)
  if (mutation.requirements.length === 0 || (!inserted && !plot.plants.includes(spawned))) return;
  const ring = ringCells(spawned.row, spawned.col, spawned.size);
  // A ring has at most 16 cells: candidates and credited plants are short lists (first-seen order,
  // exactly what the Map / Set this replaces iterated in).
  const credited: PlantState[] = [];
  for (const req of mutation.requirements) {
    const list: Candidate[] = [];
    let total = 0;
    for (const idx of ring) {
      const q = occ[idx];
      if (!q || q === spawned || q.kindId !== req.crop || credited.includes(q) || isDry(q)) continue;
      total += 1;
      let c: Candidate | undefined;
      for (let i = 0; i < list.length; i++) {
        if (list[i].plant === q) {
          c = list[i];
          break;
        }
      }
      if (c) c.cells += 1;
      else list.push({ plant: q, cells: 1, first: idx });
    }
    if (list.length === 0) continue;
    const ordered = total > req.count ? orderCandidates(list, ctx.config.mutationCreditOrder, ctx) : list;
    let covered = 0;
    for (const c of ordered) {
      if (covered >= req.count) break;
      const q = c.plant;
      q.timesMutated = (q.timesMutated ?? 0) + 1;
      if (typeof q.mutatesRemaining === "number") q.mutatesRemaining -= 1;
      credited.push(q);
      covered += c.cells;
    }
  }
}
