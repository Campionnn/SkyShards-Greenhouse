import {
  computeEffectMasks,
  effectiveSortedList,
  effectList,
  effectMask,
  effectSimulationOf,
  growEffectInput,
  kindEffectInfo,
  newEffectInput,
  sortEffects,
} from "../../utilities/effectSimulation";
import type { EffectSimulation } from "../../utilities/effectSimulation";
import type { EffectId } from "../data/types";
import { HALT_WATER } from "../config";
import { GRID_SIZE, TOTAL_CELLS } from "../grid/cells";
import { isDry } from "../sim/plants";
import type { PlantState, PlotState } from "../sim/state";
import type { TickScratch } from "../sim/context";

/** Reused input buffer (the computation is synchronous). */
const input = newEffectInput();

// Reuses the designer's effect simulation (utilities/effectSimulation.ts, port
// of solver/effects.py) so designer and simulator agree. Slot labels are not
// passed: slots are ordinary empty cells, whose received effects are recorded
// anyway (Godseed). A dry plant (`isDry`) receives but neither gives nor
// relays, which is exactly the `isSlot` flag, so it is passed as `isSlot: true`.

/**
 * Recomputes every plant's raw `held` set from the plot. `forced` (debug, config
 * `forcedEffects`) adds effects to every plant of a kind on top of what it receives; forced
 * effects are held only, never given or relayed to neighbours.
 * `held` lists are shared, frozen arrays (one per distinct set): never change one in place.
 */
export function recomputeEffects(plot: PlotState, forced?: ForcedEffects, masksOut?: Int32Array): EffectSimulation {
  const plants = plot.plants;
  const n = plants.length;
  growEffectInput(input, n);
  input.count = n;
  input.kinds.length = 0;
  const gives = input.gives!;
  const inert = input.inert!;
  for (let i = 0; i < n; i++) {
    const p = plants[i];
    input.kinds.push(p.kindId);
    input.rows[i] = p.row;
    input.cols[i] = p.col;
    input.sizes[i] = p.size;
    input.slots[i] = isDry(p) ? 1 : 0;
    const info = kindEffectInfo(p.kindId);
    gives[i] = info.gives;
    inert[i] = info.inert ? 1 : 0;
  }
  const masks = computeEffectMasks(input, GRID_SIZE, masksOut ?? new Int32Array(TOTAL_CELLS));
  const sim = effectSimulationOf(masks, GRID_SIZE);
  assignHeld(plants, masks, forced);
  return sim;
}

/** Set every plant's `held` from the per-cell masks (its anchor cell) plus forced effects of its kind. */
function assignHeld(plants: readonly PlantState[], masks: Int32Array, forced?: ForcedEffects): void {
  for (let i = 0; i < plants.length; i++) {
    const p = plants[i];
    const mask = p.row >= 0 && p.col >= 0 && p.row < GRID_SIZE && p.col < GRID_SIZE ? masks[p.row * GRID_SIZE + p.col] : 0;
    const extra = forced?.[p.kindId];
    if (!extra?.length) {
      p.held = effectList(mask) as EffectId[];
      continue;
    }
    const extraMask = effectMask(extra);
    p.held = extraMask === null ? sortEffects([...effectList(mask), ...extra]) : (effectList(mask | extraMask) as EffectId[]);
  }
}

/** Debug override: kind id -> effects every plant of that kind always holds. */
export type ForcedEffects = Readonly<Record<string, readonly EffectId[]>>;

/**
 * What the effect simulation depends on: each plant's identity, kind, anchor, size and whether it
 * is dried out (a dry plant gives and relays nothing). Equal keys = equal `held` sets.
 */
export interface EffectsKey {
  /** Per plant: id, then anchor/size/dry packed into one number. */
  nums: Int32Array;
  kinds: string[];
  /** The per-cell masks computed for this key (never changed once stored). */
  masks?: Int32Array;
}

/** Anchor, size and dry flag in one number (rows and cols are small integers on the grid). */
const packCell = (p: PlantState): number => ((((p.row * 16 + p.col) * 8 + p.size) << 1) | (!p.isDeadPlant && p.water <= HALT_WATER ? 1 : 0));

export function effectsKey(plot: PlotState): EffectsKey {
  const plants = plot.plants;
  const nums = new Int32Array(plants.length * 2);
  const kinds: string[] = [];
  for (let i = 0; i < plants.length; i++) {
    const p = plants[i];
    nums[i * 2] = p.id;
    nums[i * 2 + 1] = packCell(p);
    kinds.push(p.kindId);
  }
  return { nums, kinds };
}

const MISMATCH = 0;
const MATCH = 1;
/** Same kinds, anchors, sizes and dry flags in the same order; only plant ids differ. */
const SAME_LAYOUT = 2;

/** How `effectsKey(plot)` compares to `key`, without allocating. */
function keyMatch(plot: PlotState, key: EffectsKey): number {
  const plants = plot.plants;
  const n = plants.length;
  const { nums, kinds } = key;
  if (kinds.length !== n) return MISMATCH;
  let sameIds = true;
  for (let i = 0; i < n; i++) {
    const p = plants[i];
    if (nums[i * 2] !== p.id) sameIds = false;
    if (nums[i * 2 + 1] !== packCell(p) || kinds[i] !== p.kindId) return MISMATCH;
  }
  return sameIds ? MATCH : SAME_LAYOUT;
}

/**
 * Bring every `held` set up to date and remember the plot it was computed for. `held` and the
 * simulation are a pure function of the plot's fingerprint (`effectsKey`) and the forced effects,
 * so when neither changed since the last computation (also carried over from the previous cycle,
 * see `carryEffects`) nothing is recomputed. No RNG.
 */
export function refreshEffects(plot: PlotState, scratch: TickScratch): EffectSimulation {
  ensureEffects(plot, scratch);
  return scratch.effects!;
}

/**
 * Player actions (harvest, break, place, water, step changes, scripts) change what plants give
 * each other mid-session. Recompute only if the plot changed since the last computation. No RNG.
 */
export function ensureEffects(plot: PlotState, scratch: TickScratch): void {
  const key = scratch.effectsKey;
  if (scratch.effects && key) {
    const match = keyMatch(plot, key);
    if (match === MATCH) return;
    // A plant replaced by another of the same kind on the same cell (harvest and replant):
    // the simulation is a function of the layout alone, so its masks still hold; only the new
    // plants need their `held` sets.
    if (match === SAME_LAYOUT && key.masks) {
      assignHeld(plot.plants, key.masks, scratch.forcedEffects);
      scratch.effectsKey = { ...effectsKey(plot), masks: key.masks };
      return;
    }
  }
  // A layout seen recently on this plot (a spawn appears and is harvested, again and again):
  // same layout, same masks.
  const history = (scratch.effectsHistory ??= []);
  for (let h = 0; h < history.length; h++) {
    const memo = history[h];
    if (keyMatch(plot, memo.key) === MISMATCH) continue;
    assignHeld(plot.plants, memo.key.masks!, scratch.forcedEffects);
    scratch.effects = memo.sim;
    scratch.effectsKey = { ...effectsKey(plot), masks: memo.key.masks };
    if (h > 0) {
      history.splice(h, 1);
      history.unshift(memo);
    }
    return;
  }
  const masks = new Int32Array(TOTAL_CELLS);
  scratch.effects = recomputeEffects(plot, scratch.forcedEffects, masks);
  scratch.effectsKey = { ...effectsKey(plot), masks };
  history.unshift({ key: scratch.effectsKey, sim: scratch.effects });
  if (history.length > EFFECTS_HISTORY) history.length = EFFECTS_HISTORY;
}

/** One remembered effect computation: the layout it was for (with its masks) and its simulation. */
export interface EffectsMemo {
  key: EffectsKey;
  sim: EffectSimulation;
}

/** Layouts remembered per plot (most recent first). */
const EFFECTS_HISTORY = 4;

/**
 * Start a cycle's scratch from the previous cycle's effect computation for the same plot, when it
 * was made with the same forced effects (`ensureEffects` still checks the plot's fingerprint). Within
 * one `run` call only: the plants' `held` sets live in state and were last written by that computation.
 * The plot's recent layouts carry over too (they depend on the forced effects only through `held`,
 * which is assigned fresh on reuse).
 */
export function carryEffects(from: TickScratch | undefined, to: TickScratch): void {
  if (!from || from.forcedEffects !== to.forcedEffects) return;
  if (from.effectsHistory) to.effectsHistory = from.effectsHistory;
  if (!from.effects || !from.effectsKey) return;
  to.effects = from.effects;
  to.effectsKey = from.effectsKey;
}

/** Effective effects (post-immunity, improved overrides base), sorted. A fresh array the caller may change. */
export function effectiveList(raw: Iterable<EffectId>): EffectId[] {
  return effectiveSortedList(raw).slice();
}

/**
 * `effectiveList` as a shared, frozen list (one per distinct set): for engine code that only reads
 * it or stores it as plain data (`lockedEffects`; a state's lists are never changed in place, and
 * `run` deep-copies its input). Hand scripts `effectiveList` instead.
 */
export function effectiveListShared(raw: Iterable<EffectId>): readonly EffectId[] {
  return effectiveSortedList(raw);
}

export function hasEffect(list: readonly EffectId[] | null, effect: EffectId): boolean {
  return !!list && list.includes(effect);
}
