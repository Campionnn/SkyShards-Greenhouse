import type { CSSProperties } from "react";
import type { FocusVisual, PlacementFocus } from "../../hooks/usePlacementFocus";

/**
 * Shared look of placements on the Calculator and Designer grids: glows, invalid-target marks and
 * how list-driven focus highlights or fades a placement. Hidden placements draw `BareGround`.
 */

/** Cyan glow of a target mutation. */
export const TARGET_GLOW = "0 0 8px rgba(0, 200, 255, 1), inset 0 0 8px rgba(0, 200, 255, 1)";
/** Hover glow of a draggable (removable) placement. */
export const REMOVE_HOVER_GLOW = "0 0 8px rgba(239, 68, 68, 0.8), inset 0 0 8px rgba(239, 68, 68, 0.4)";
/** Gold glow of a locked Calculator placement. */
export const LOCKED_GLOW = "0 0 8px rgba(234, 179, 8, 0.8), inset 0 0 8px rgba(234, 179, 8, 0.4)";
/** White ring of a placement found from the list below the grid. */
export const FOCUS_RING = "0 0 0 2px rgba(255, 255, 255, 0.95), 0 0 12px 2px rgba(255, 255, 255, 0.45)";

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
  const base =
    "cursor-pointer select-none transition-[background-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70";
  if (focus.pinned === key) return `${base} !bg-slate-600/70 ring-1 ring-white/70`;
  if (focus.active === key) return `${base} !bg-slate-600/60`;
  return `${base} hover:!bg-slate-600/50`;
}
