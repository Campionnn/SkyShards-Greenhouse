import type { SimConfig } from "../config";
import type { MutationDef } from "../data/types";
import { cellKey, footprint, footprintFits, GRID_SIZE, ringCells } from "../grid/cells";
import { isDry, isFootprintFree, type Occupancy } from "../sim/plants";
import type { PlotState } from "../sim/state";

// Per-location spawn checks used by the spawn step. The uptime recorder reads
// the target's weight from that same pass, so "could the target spawn here?"
// has exactly one answer.

/** What stands in the 8-way ring around a footprint. */
export interface RingCounts {
  /**
   * Plants that count toward requirements, by kind, in CELLS (not entities).
   * A dried-out plant (`isDry`) is left out: it doesn't count toward any
   * mutation's requirements.
   */
  counts: Record<string, number>;
  /**
   * Anything at all stands in the ring - dry plants, Dead Plants and roots
   * included. Lonelily's zero-adjacent rule reads this, because a dry plant
   * is still physically there.
   */
  ringOccupied: boolean;
}

/** Plants around a footprint over the 8-way ring: requirement counts (dry plants skipped) and plain occupancy. */
export function ringCounts(
  occ: Occupancy,
  row: number,
  col: number,
  size: number,
  config: Pick<SimConfig, "haltWater">
): RingCounts {
  const counts: Record<string, number> = {};
  let ringOccupied = false;
  for (const idx of ringCells(row, col, size)) {
    const q = occ[idx];
    if (!q) continue;
    ringOccupied = true;
    if (isDry(q, config)) continue;
    counts[q.kindId] = (counts[q.kindId] ?? 0) + 1;
  }
  return { counts, ringOccupied };
}

/**
 * The ground is checked per cell, not just at the anchor: a 2×2 or 3×3
 * mutation must stand entirely on its required ground. Chorus conversion wins
 * over the step's painted ground until the next step.
 */
export function groundFits(plot: PlotState, row: number, col: number, m: MutationDef): boolean {
  return footprint(row, col, m.size).every((c) => {
    const key = cellKey(Math.floor(c / GRID_SIZE), c % GRID_SIZE);
    return (plot.groundOverrides[key] ?? plot.groundTiles[key]) === m.ground;
  });
}

/** Footprint fits on the plot, is empty, and stands on the right ground. */
export function locationOpenFor(plot: PlotState, occ: Occupancy, row: number, col: number, m: MutationDef): boolean {
  return footprintFits(row, col, m.size) && isFootprintFree(occ, row, col, m.size) && groundFits(plot, row, col, m);
}
