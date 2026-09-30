import type { MutationDef } from "../data/types";
import { cellKey, footprint, footprintFits, GRID_SIZE, ringCells } from "../grid/cells";
import { isFootprintFree, type Occupancy } from "../sim/plants";
import type { PlotState } from "../sim/state";

// Per-location spawn checks used by the spawn step. The uptime recorder reads
// the target's weight from that same pass, so "could the target spawn here?"
// has exactly one answer.

/** Plants around a footprint, counted in CELLS (not entities), over the 8-way ring. */
export function ringCounts(occ: Occupancy, row: number, col: number, size: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const idx of ringCells(row, col, size)) {
    const q = occ[idx];
    if (q) counts[q.kindId] = (counts[q.kindId] ?? 0) + 1;
  }
  return counts;
}

/**
 * The ground is checked per cell, not just at the anchor: a 2×2 or 3×3
 * mutation must stand entirely on its required ground. Chorus conversion wins
 * over the stage's painted ground until the next stage.
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
