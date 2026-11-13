/** Cell colours shared by the Calculator and Designer grids and the grid manager (design tokens). */

/** Unlocked cells: the emerald `go` tint the grid has always had ("green"), or neutral ("gray", the Designer). */
export const UNLOCKED_CELL = { green: "bg-go/30 border border-go/30", gray: "bg-surface-hover border border-line-strong" } as const;
/** A cell outside the greenhouse's unlocked area. */
export const LOCKED_CELL = "bg-surface-well/60 border border-line";
