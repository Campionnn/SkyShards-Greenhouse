import { effectiveEffects, simulateEffects, sortEffects } from "../../utilities/effectSimulation";
import type { EffectSimulation } from "../../utilities/effectSimulation";
import type { EffectId } from "../data/types";
import type { PlotState } from "../sim/state";

// Effect propagation is NOT reimplemented here: the designer's port of
// solver/effects.py (4-way cardinal, effect_spread relay in Java-HashMap turn
// order, slots receive but never give) is the single implementation, so the
// designer and the simulator can never disagree. Slot labels are not passed
// in: under the simulator's rules they are ordinary empty cells, and the
// effect simulation already records what empty cells receive (Godseed).

/** Recompute every plant's raw held set from the standing layout. Pure function of the plot. */
export function recomputeEffects(plot: PlotState): EffectSimulation {
  const sim = simulateEffects(
    plot.plants.map((p) => ({ id: p.kindId, position: [p.row, p.col] as [number, number], size: p.size }))
  );
  for (const p of plot.plants) p.held = sortEffects(sim.heldAt(p.row, p.col));
  return sim;
}

/** Effective (post-immunity, improved-overrides-base) effects, as a stable sorted list. */
export function effectiveList(raw: Iterable<EffectId>): EffectId[] {
  return sortEffects(effectiveEffects(raw));
}

export function hasEffect(list: readonly EffectId[] | null, effect: EffectId): boolean {
  return !!list && list.includes(effect);
}
