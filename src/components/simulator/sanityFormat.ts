import type { SanityBlocker, SanityCheckResult, SanityEntry, SanityOccupant } from "../../simulator";
import { getEffectName } from "../../utilities";
import { nameOf } from "./format";

// Text and display ordering for the Sanity Check card (SimTooltip.tsx).
// Display only: nothing here ranks layouts or mutations.

/** "30%", "28.6%", "0.43%". */
export function formatChance(p: number): string {
  const pct = p * 100;
  return `${pct.toFixed(pct >= 1 ? 1 : 2).replace(/\.0+$/, "")}%`;
}

/**
 * Cell of a `size`x`size` element under the cursor, as offsets from its top-left cell.
 * A multi-cell plant or slot is one element, so the cell comes from offset / (cellSize + gap).
 * `rect` is the on-screen bounding box; comparing it with the layout size handles a scaled page.
 */
export function hoveredCellOffset(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  size: number,
  cellSize: number,
  gap: number
): { dr: number; dc: number } {
  const span = size * cellSize + (size - 1) * gap;
  const pitch = cellSize + gap;
  const sx = rect.width > 0 ? rect.width / span : 1;
  const sy = rect.height > 0 ? rect.height / span : 1;
  const pick = (offsetPx: number): number => Math.max(0, Math.min(size - 1, Math.floor(offsetPx / pitch)));
  return { dc: pick((clientX - rect.left) / sx), dr: pick((clientY - rect.top) / sy) };
}

export const occupantName = (o: SanityOccupant): string => `${nameOf(o.kindId)}${o.dry ? " (dried out)" : ""}`;

/** One blocker as short text: "needs 2× Wheat (have 1)", "wrong ground: needs Soul Sand", "doesn't fit", ... */
export function describeBlocker(b: SanityBlocker, mutationId: string): string {
  switch (b.kind) {
    case "requirement":
      return `needs ${b.needed}× ${nameOf(b.crop)} (have ${b.have}${b.dry > 0 ? `, ${b.dry} dried out don't count` : ""})`;
    case "ground":
      return `wrong ground: needs ${nameOf(b.needed)}${b.wrong.length > 1 ? ` (${b.wrong.length} cells)` : ""}`;
    case "outOfBounds":
      return "doesn't fit (runs off the plot)";
    case "occupied":
      return `doesn't fit: ${b.by.map(occupantName).join(", ")} in the way`;
    case "ringNotEmpty":
      return `${nameOf(mutationId)}: ring not empty (${b.occupants.map(occupantName).join(", ")})`;
    case "missingEffects":
      return `${nameOf(mutationId)}: missing ${b.effects.map(getEffectName).join(", ")}`;
    case "notCandidate":
      return "none of its required crops stand on this plot";
    case "noWeight":
      return "no spawn rule offers it here";
  }
}

/** Entries that can't spawn, fewest missing requirements first (ties in data.json order), capped. Display only, not a ranking. */
export function closestBlocked(result: SanityCheckResult, limit: number): { shown: SanityEntry[]; more: number } {
  const sorted = result.cannot
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.missingCount - b.e.missingCount || a.i - b.i)
    .map((x) => x.e);
  return { shown: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) };
}
