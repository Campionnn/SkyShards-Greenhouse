import type { MutationDef } from "../data/types";
import { cellKey, footprint, footprintFits, GRID_SIZE, ringCells } from "../grid/cells";
import { isDry, isFootprintFree, type Occupancy } from "../sim/plants";
import type { PlotState } from "../sim/state";

// Per-location spawn checks. The uptime recorder reuses the spawn pass's
// weights, so "could the target spawn here?" has one answer.

/** What stands in the 8-way ring around a footprint. */
export interface RingCounts {
  /** Requirement counts by kind, in cells. Dry plants excluded. */
  counts: Record<string, number>;
  /** Anything stands in the ring, including dry plants, Dead Plants and roots (Lonelily). */
  ringOccupied: boolean;
}

export function ringCounts(occ: Occupancy, row: number, col: number, size: number): RingCounts {
  const counts: Record<string, number> = {};
  let ringOccupied = false;
  for (const idx of ringCells(row, col, size)) {
    const q = occ[idx];
    if (!q) continue;
    ringOccupied = true;
    if (isDry(q)) continue;
    counts[q.kindId] = (counts[q.kindId] ?? 0) + 1;
  }
  return { counts, ringOccupied };
}

/** Every footprint cell must have the required ground. Overrides (Chorus) win over painted tiles. */
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
