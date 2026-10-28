import type { CSSProperties } from "react";
import type { TargetDisplay } from "../../constants";
import type { FocusVisual, PlacementFocus } from "../../hooks/usePlacementFocus";

/**
 * Shared look of placements on the Calculator and Designer grids: how target mutation spots are
 * drawn (solid / faded / hidden) and how list-driven focus highlights or fades a placement.
 */

/** Cyan glow of a target mutation drawn solid. */
export const TARGET_GLOW = "0 0 8px rgba(0, 200, 255, 1), inset 0 0 8px rgba(0, 200, 255, 1)";
/** Hover glow of a draggable (removable) placement. */
export const REMOVE_HOVER_GLOW = "0 0 8px rgba(239, 68, 68, 0.8), inset 0 0 8px rgba(239, 68, 68, 0.4)";
/** Gold glow of a locked Calculator placement. */
export const LOCKED_GLOW = "0 0 8px rgba(234, 179, 8, 0.8), inset 0 0 8px rgba(234, 179, 8, 0.4)";
/** White ring of a placement found from the list below the grid. */
export const FOCUS_RING = "0 0 0 2px rgba(255, 255, 255, 0.95), 0 0 12px 2px rgba(255, 255, 255, 0.45)";

export interface TargetLook {
  /** Glow; a hover glow may replace it. */
  glow?: string;
  /** Always-on inset shadow darkening the ground (faded targets). */
  veil?: string;
  border?: string;
  showImage: boolean;
  /** Image opacity (faded targets are see-through). */
  imageOpacity: number;
}

/**
 * How a target spot is drawn. `invalid` marks a Designer target its inputs can't spawn (red), which
 * stays visible in every display so a broken layout is never hidden.
 */
export function targetLook(display: TargetDisplay, invalid = false): TargetLook {
  if (display === "faded") {
    return {
      // A dark veil over the ground plus a dashed outline: reads as "leave this cell empty".
      veil: "inset 0 0 0 999px rgba(15, 23, 42, 0.4)",
      border: `2px dashed ${invalid ? "rgba(239, 68, 68, 0.95)" : "rgba(34, 211, 238, 0.85)"}`,
      showImage: true,
      imageOpacity: 0.7,
    };
  }
  if (display === "hidden") {
    return { border: invalid ? "2px solid #ef4444" : undefined, showImage: false, imageOpacity: 1 };
  }
  return { glow: invalid ? undefined : TARGET_GLOW, border: invalid ? "2px solid #ef4444" : undefined, showImage: true, imageOpacity: 1 };
}

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

export const TARGET_DISPLAY_LABEL: Record<TargetDisplay, string> = {
  solid: "Solid",
  faded: "Faded",
  hidden: "Hidden",
};

export const TARGET_DISPLAY_HINT: Record<TargetDisplay, string> = {
  solid: "Draw target mutations like planted crops, with a cyan glow",
  faded: "Draw target mutations as dark, dashed spots with a see-through icon: the cells to leave empty",
  hidden: "Hide target mutations; only what you plant shows",
};
