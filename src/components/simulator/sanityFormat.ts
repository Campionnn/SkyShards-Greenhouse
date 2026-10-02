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
 * Which cell of a `size`x`size` element is under the cursor? A multi-cell plant
 * or target slot is ONE element, so the Sanity Check finds its cell from the
 * mouse position inside it: offset / (cellSize + gap), clamped to the element.
 * `rect` is the element's bounding box; its on-screen width is compared with
 * the layout width so a scaled page still maps correctly. Returns offsets from
 * the element's top-left cell.
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

/**
 * The entries that can't spawn, nearest to eligible first (fewest missing
 * requirements, data.json order breaking ties), capped. A DISPLAY aid to keep
 * the card short - not a ranking of layouts or mutations.
 */
export function closestBlocked(result: SanityCheckResult, limit: number): { shown: SanityEntry[]; more: number } {
  const sorted = result.cannot
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.missingCount - b.e.missingCount || a.i - b.i)
    .map((x) => x.e);
  return { shown: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) };
}
