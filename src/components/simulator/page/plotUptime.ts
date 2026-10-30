import type { SimulationState } from "../../../simulator";

export interface PlotUptime {
  /** (growing + ready) / watched over the whole run so far. */
  ratio: number;
  /** Some checked target sat empty without its requirements at some point. */
  unsustainable: boolean;
}

/**
 * Uptime of one plot's checked targets over every step it ran so far, or null when nothing was
 * checked yet. Same formula as the run total.
 */
export function plotUptime(state: SimulationState | undefined, plotId: number): PlotUptime | null {
  const steps = state?.uptime[String(plotId)];
  if (!steps) return null;
  let watched = 0;
  let up = 0;
  let requirements = 0;
  for (const spots of Object.values(steps))
    for (const u of Object.values(spots)) {
      watched += u.watched;
      up += u.growing + u.ready;
      requirements += u.requirements;
    }
  return watched > 0 ? { ratio: up / watched, unsustainable: requirements > 0 } : null;
}
