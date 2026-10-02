import type { MutationCreditOrder } from "../config";
import type { KindId, MutationDef } from "../data/types";
import { ringCells } from "../grid/cells";
import { intInclusive } from "../rng";
import type { CycleCtx } from "./context";
import { isDry, isFullyGrown, type Occupancy } from "./plants";
import type { PlantState, PlotState } from "./state";

// Minimum mutations (0.27.2, user-confirmed rules).
//
// Every plant carries `timesMutated` and `mutatesRemaining` (sim/state.ts).
// - Credit: when a mutation spawns, each requirement {crop, count} credits
//   that many ring CELLS' worth of neighbours of that kind (dry ones skipped),
//   each distinct plant at most once per spawn (`creditInputs`).
// - Pool: per plot, per kind. A plant is pooled once it has helped at least
//   once AND is fully grown (`isPooled`). The pool's count is the sum of its
//   members' remaining (`combinedRemaining`); it can go negative, and is
//   infinite if any member is.
// - Decay check, when the timer runs out (sim/tick.ts `phaseDecay`):
//   N/A -> decays; Infinite -> never; pooled -> decays iff the pool is <= 0;
//   otherwise iff its own remaining is <= 0 (`minimumMet`). If not met, the
//   timer is extended (`decayExtensionHours`).
//
// Everything here except `creditInputs` is pure and read-only.

/** A remaining / pool count: a number (may be negative), "infinite", or null for N/A (no minimum). */
export type MutatesRemaining = number | "infinite" | null;

/**
 * Fully grown, for the pool: placed items (and every Dead Plant) went in
 * fully grown; a planted crop or a natural spawn once it reaches its ready
 * stage and latches (0-stage kinds at once).
 */
function grownForPool(p: PlantState): boolean {
  return p.origin === "placed" || p.isDeadPlant || isFullyGrown(p);
}

/** Is this plant part of its kind's shared pool on its plot? It has helped at least once and is fully grown. */
export function isPooled(p: PlantState): boolean {
  return p.timesMutated >= 1 && grownForPool(p);
}

/** Add one member's remaining into a running pool total. N/A members add nothing. */
function addToPool(total: MutatesRemaining, r: MutatesRemaining): MutatesRemaining {
  if (r === null) return total;
  if (total === "infinite" || r === "infinite") return "infinite";
  return (total ?? 0) + r;
}

/**
 * The pool of one kind on one plot: the sum of `mutatesRemaining` over that
 * kind's pooled plants. "infinite" if any member is; null when the kind has
 * no pooled member with a minimum. Read fresh (not snapshotted).
 */
export function combinedRemaining(plot: PlotState, kindId: KindId): MutatesRemaining {
  let total: MutatesRemaining = null;
  for (const q of plot.plants) if (q.kindId === kindId && isPooled(q)) total = addToPool(total, q.mutatesRemaining);
  return total;
}

/** Every kind's pool on a plot, in one pass (the decay phase snapshots this once per tick). */
export function poolSnapshot(plot: PlotState): Map<KindId, MutatesRemaining> {
  const pools = new Map<KindId, MutatesRemaining>();
  for (const q of plot.plants) {
    if (!isPooled(q)) continue;
    pools.set(q.kindId, addToPool(pools.get(q.kindId) ?? null, q.mutatesRemaining));
  }
  return pools;
}

/**
 * Has this plant met its minimum mutations, so that it may decay when its
 * timer runs out? `combined` is its kind's pool (`combinedRemaining`, or the
 * phase's snapshot of it); it only matters while the plant is pooled.
 * - N/A (null): always met - decay is timer-only.
 * - Infinite: never met.
 * - pooled: met iff the pool is <= 0 (never while the pool is infinite).
 * - otherwise: met iff its own remaining is <= 0 (so one that never helped,
 *   with a positive minimum, never is).
 * A plant from a state saved before the counters existed reads as N/A.
 */
export function minimumMet(p: PlantState, combined: MutatesRemaining): boolean {
  const own = p.mutatesRemaining ?? null;
  if (own === null) return true;
  if (own === "infinite") return false;
  if (isPooled(p)) {
    if (combined === "infinite") return false;
    // null only if the caller's pool doesn't include it (it always should): fall back to its own count.
    return (combined ?? own) <= 0;
  }
  return own <= 0;
}

/**
 * Would this plant actually decay within `seconds` (Infinity allowed) if
 * nothing changed? Its timer runs out by then AND its minimum is met now,
 * judged from the current counters and a fresh pool. A help that lands in
 * between can still surprise it (accepted). The player's "before decay"
 * harvests and the `decayImminent` trigger use this.
 */
export function wouldDecayWithin(plot: PlotState, p: PlantState, seconds: number): boolean {
  if (p.decaySecondsRemaining === null) return false;
  if (Number.isFinite(seconds) && p.decaySecondsRemaining - seconds > 1e-6) return false;
  return minimumMet(p, combinedRemaining(plot, p.kindId));
}

export interface DecayStatus {
  timesMutated: number;
  mutatesRemaining: MutatesRemaining;
  /** Helped at least once and fully grown: it shares its kind's count on this plot. */
  pooled: boolean;
  /** Its kind's pool on this plot when pooled; null when not pooled. */
  combined: MutatesRemaining;
  /** If its timer ran out now, would it decay (true) or be extended (false)? */
  minimumMet: boolean;
}

/** Read-only decay status of one plant on its plot, for the UI. Pure: never mutates anything. */
export function decayStatus(plot: PlotState, p: PlantState): DecayStatus {
  const pooled = isPooled(p);
  const combined = pooled ? combinedRemaining(plot, p.kindId) : null;
  return {
    // A plant from a state saved before the counters existed reads as N/A.
    timesMutated: p.timesMutated ?? 0,
    mutatesRemaining: p.mutatesRemaining ?? null,
    pooled,
    combined,
    minimumMet: minimumMet(p, combined),
  };
}

/** Sort key for the remaining-count credit orders: no minimum (N/A) and Infinite never run out. */
const remainingKey = (r: MutatesRemaining): number => (typeof r === "number" ? r : Infinity);

interface Candidate {
  plant: PlantState;
  /** Ring cells of the spawn this neighbour covers. */
  cells: number;
  /** Its first ring cell index (ring order). */
  first: number;
}

/** Order the candidates to credit; ties always fall back to ring order. Draws RNG only for "random". */
function orderCandidates(list: Candidate[], order: MutationCreditOrder, ctx: CycleCtx): Candidate[] {
  const byRing = (a: Candidate, b: Candidate) => a.first - b.first;
  switch (order) {
    case "mostRemainingFirst":
      return list.sort((a, b) => remainingKey(b.plant.mutatesRemaining) - remainingKey(a.plant.mutatesRemaining) || byRing(a, b));
    case "fewestRemainingFirst":
      return list.sort((a, b) => remainingKey(a.plant.mutatesRemaining) - remainingKey(b.plant.mutatesRemaining) || byRing(a, b));
    case "random": {
      // Fisher-Yates over the ring-ordered list: one intInclusive per position, from the end.
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
 * Credit the neighbours a new spawn used (called by the spawn phase right
 * after the spawn is inserted and `occ` updated, so earlier spawns this tick
 * count as neighbours, exactly as they do for requirements).
 *
 * For each requirement {crop, count}, walk the spawn's 8-way ring and credit
 * plants of that kind until `count` ring CELLS are covered. A multi-cell
 * neighbour covers all its ring cells at once and is credited once. Each
 * distinct plant is credited at most once per spawn. Dried-out plants don't
 * count toward requirements, so they are not credited. A mutation without
 * crop requirements (Godseed, Lonelily) credits nobody.
 *
 * Which neighbours, when more stand there than needed, follows
 * `config.mutationCreditOrder`. RNG: only the "random" order draws, and only
 * when the order matters (the candidates cover more cells than the count).
 * Emits no event (it would be too noisy); the tooltip shows the counters.
 */
export function creditInputs(plot: PlotState, occ: Occupancy, spawned: PlantState, mutation: MutationDef, ctx: CycleCtx): void {
  // Nothing to credit without crop requirements, or if the spawn isn't on this plot (plots never read each other).
  if (mutation.requirements.length === 0 || !plot.plants.includes(spawned)) return;
  const ring = ringCells(spawned.row, spawned.col, spawned.size);
  const credited = new Set<PlantState>();
  for (const req of mutation.requirements) {
    const byPlant = new Map<PlantState, Candidate>();
    for (const idx of ring) {
      const q = occ[idx];
      if (!q || q === spawned || q.kindId !== req.crop || credited.has(q) || isDry(q, ctx.config)) continue;
      const c = byPlant.get(q);
      if (c) c.cells += 1;
      else byPlant.set(q, { plant: q, cells: 1, first: idx });
    }
    let list = [...byPlant.values()];
    const total = list.reduce((n, c) => n + c.cells, 0);
    // Order only matters when there are more cells than the requirement needs.
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
