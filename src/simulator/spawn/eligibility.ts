import type { MutationDef } from "../data/types";
import { cellIndex, footprint, footprintFits, indexKey, KEY_INDEX, ringCells, TOTAL_CELLS } from "../grid/cells";
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

/** Ground under a cell: the override (Chorus End Stone, fixed ground) if any, else the painted tile. */
const groundAt = (plot: PlotState, idx: number): string | undefined => {
  const key = indexKey(idx);
  return plot.groundOverrides[key] ?? plot.groundTiles[key];
};

/**
 * Painted ground per cell of a `groundTiles` record. The engine replaces a plot's `groundTiles`
 * (at a step change), never changes one in place, so the record's identity is the cache key.
 */
const paintedGround = new WeakMap<Record<string, string>, readonly (string | undefined)[]>();

/** `groundAt` for every cell, into `out` (returned): what hot loops read instead of the records. */
export function groundGrid(plot: PlotState, out: (string | undefined)[]): (string | undefined)[] {
  let painted = paintedGround.get(plot.groundTiles);
  if (!painted) {
    const list: (string | undefined)[] = [];
    for (let i = 0; i < TOTAL_CELLS; i++) list.push(plot.groundTiles[indexKey(i)]);
    painted = list;
    paintedGround.set(plot.groundTiles, painted);
  }
  for (let i = 0; i < TOTAL_CELLS; i++) out[i] = painted[i];
  const overrides = plot.groundOverrides;
  for (const key in overrides) {
    const i = KEY_INDEX.get(key);
    if (i !== undefined && overrides[key] != null) out[i] = overrides[key];
  }
  return out;
}

/** Every footprint cell must have the required ground. Overrides (Chorus) win over painted tiles. */
export function groundFits(plot: PlotState, row: number, col: number, m: MutationDef): boolean {
  if (m.size === 1) return groundAt(plot, cellIndex(row, col)) === m.ground;
  for (const c of footprint(row, col, m.size)) if (groundAt(plot, c) !== m.ground) return false;
  return true;
}

/** Footprint fits on the plot, is empty, and stands on the right ground. */
export function locationOpenFor(plot: PlotState, occ: Occupancy, row: number, col: number, m: MutationDef): boolean {
  return footprintFits(row, col, m.size) && isFootprintFree(occ, row, col, m.size) && groundFits(plot, row, col, m);
}
