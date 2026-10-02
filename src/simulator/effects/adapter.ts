import { effectiveEffects, simulateEffects, sortEffects } from "../../utilities/effectSimulation";
import type { EffectSimulation } from "../../utilities/effectSimulation";
import type { SimConfig } from "../config";
import type { EffectId } from "../data/types";
import { isDry } from "../sim/plants";
import type { PlotState } from "../sim/state";

// Reuses the designer's effect simulation (utilities/effectSimulation.ts, port
// of solver/effects.py) so designer and simulator agree. Slot labels are not
// passed: slots are ordinary empty cells, whose received effects are recorded
// anyway (Godseed). A dry plant (`isDry`) receives but neither gives nor
// relays, which is exactly the `isSlot` flag, so it is passed as `isSlot: true`.

/** Recomputes every plant's raw `held` set from the plot. */
export function recomputeEffects(plot: PlotState, config: Pick<SimConfig, "haltWater">): EffectSimulation {
  const sim = simulateEffects(
    plot.plants.map((p) => ({
      id: p.kindId,
      position: [p.row, p.col] as [number, number],
      size: p.size,
      ...(isDry(p, config) ? { isSlot: true } : {}),
    }))
  );
  for (const p of plot.plants) p.held = sortEffects(sim.heldAt(p.row, p.col));
  return sim;
}

/** Effective effects (post-immunity, improved overrides base), sorted. */
export function effectiveList(raw: Iterable<EffectId>): EffectId[] {
  return sortEffects(effectiveEffects(raw));
}

export function hasEffect(list: readonly EffectId[] | null, effect: EffectId): boolean {
  return !!list && list.includes(effect);
}
