import type { CSSProperties } from "react";
import type { FocusVisual, PlacementFocus } from "../../hooks/usePlacementFocus";

/**
 * Shared look of placements on the Calculator and Designer grids: glows, invalid-target marks and
 * how list-driven focus highlights or fades a placement. Hidden placements draw `BareGround`.
 * Colours are the design tokens (index.css @theme), so a palette change follows.
 */

/** Aqua glow of a target mutation (the `select` role: the cells the layout aims at). */
export const TARGET_GLOW = "0 0 6px var(--color-select), inset 0 0 6px var(--color-select)";
/** Hover glow of a draggable (removable) placement. */
export const REMOVE_HOVER_GLOW = "0 0 6px var(--color-problem), inset 0 0 4px var(--color-problem)";
/** Gold glow of a locked Calculator placement. */
export const LOCKED_GLOW = "0 0 6px var(--color-coin), inset 0 0 4px var(--color-coin)";
/** Ring of a placement found from the list below the grid. */
export const FOCUS_RING = "0 0 0 2px var(--color-fg), 0 0 10px 2px var(--color-fg-muted)";

/** Style overrides for a placement drawn as `BareGround`: no merged texture, no border. */
export const BARE_PLACEMENT_STYLE: CSSProperties = {
  backgroundImage: "none",
  // Longhand, as the cells set border longhands too (React warns when shorthand and longhand mix).
  borderWidth: 0,
  borderRadius: 0,
};

/** Joins box-shadow layers, skipping empty ones. */
export function shadows(...layers: (string | undefined | null | false)[]): string | undefined {
  const list = layers.filter(Boolean);
  return list.length ? list.join(", ") : undefined;
}

/** Opacity and filter of a placement while something else is focused. */
export function focusFade(visual: FocusVisual): CSSProperties {
  return visual === "dimmed" ? { opacity: 0.22, filter: "grayscale(0.85)" } : {};
}

export const FOCUS_TRANSITION = "opacity 150ms ease, filter 150ms ease, box-shadow 150ms ease";

/**
 * Classes for a list entry that finds its placements on the grid: lit while shown, ringed while
 * pinned. Entries with nothing on the grid stay plain.
 */
export function focusItemClass(focus: PlacementFocus, key: string): string {
  if (!focus.has(key)) return "";
  const base = "focus-ring cursor-pointer select-none transition-[background-color,box-shadow] duration-(--duration-hover)";
  if (focus.pinned === key) return `${base} !bg-surface-hover ring-1 ring-select`;
  if (focus.active === key) return `${base} !bg-surface-hover`;
  return `${base} hover:!bg-surface-hover`;
}
