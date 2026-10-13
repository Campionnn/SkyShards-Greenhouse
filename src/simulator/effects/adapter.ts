import { effectiveEffects, simulateEffects, sortEffects } from "../../utilities/effectSimulation";
import type { EffectSimulation } from "../../utilities/effectSimulation";
import type { EffectId } from "../data/types";
import { isDry } from "../sim/plants";
import type { PlotState } from "../sim/state";
import type { TickScratch } from "../sim/context";

// Reuses the designer's effect simulation (utilities/effectSimulation.ts, port
// of solver/effects.py) so designer and simulator agree. Slot labels are not
// passed: slots are ordinary empty cells, whose received effects are recorded
// anyway (Godseed). A dry plant (`isDry`) receives but neither gives nor
// relays, which is exactly the `isSlot` flag, so it is passed as `isSlot: true`.

/** Recomputes every plant's raw `held` set from the plot. */
export function recomputeEffects(plot: PlotState): EffectSimulation {
  const sim = simulateEffects(
    plot.plants.map((p) => ({
      id: p.kindId,
      position: [p.row, p.col] as [number, number],
      size: p.size,
      ...(isDry(p) ? { isSlot: true } : {}),
    }))
  );
  for (const p of plot.plants) p.held = sortEffects(sim.heldAt(p.row, p.col));
  return sim;
}

/**
 * What the effect simulation depends on: each plant's identity, kind, anchor and whether it is
 * dried out (a dry plant gives and relays nothing). Equal keys = equal `held` sets.
 */
export function effectsKey(plot: PlotState): string {
  let key = "";
  for (const p of plot.plants) key += `${p.id}:${p.kindId}:${p.row}:${p.col}:${p.size}:${isDry(p) ? 1 : 0}|`;
  return key;
}

/** Recompute every `held` set now and remember the plot it was computed for. */
export function refreshEffects(plot: PlotState, scratch: TickScratch): EffectSimulation {
  scratch.effects = recomputeEffects(plot);
  scratch.effectsKey = effectsKey(plot);
  return scratch.effects;
}

/**
 * Player actions (harvest, break, place, water, step changes, scripts) change what plants give
 * each other mid-session. Recompute only if the plot changed since the last computation. No RNG.
 */
export function ensureEffects(plot: PlotState, scratch: TickScratch): void {
  if (scratch.effects && scratch.effectsKey === effectsKey(plot)) return;
  refreshEffects(plot, scratch);
}

/** Effective effects (post-immunity, improved overrides base), sorted. */
export function effectiveList(raw: Iterable<EffectId>): EffectId[] {
  return sortEffects(effectiveEffects(raw));
}

export function hasEffect(list: readonly EffectId[] | null, effect: EffectId): boolean {
  return !!list && list.includes(effect);
}
