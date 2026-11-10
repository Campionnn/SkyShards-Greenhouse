// Placement maths for the kit's small floating pieces: KitTooltip (Hint.tsx) and Popover side="right"
// (Popover.tsx). Pure functions of rectangles, so they are unit-tested without a DOM
// (hintPosition.test.ts). docs/design-system/components.md "KitTooltip", "Popover family".

/** Where a tooltip asks to sit. It flips to the other side (or "left") when there is no room. */
export type TooltipSide = "right" | "bottom" | "top";

/** The part of a DOMRect these functions read. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Space kept between a floating piece and the window edge. */
export const EDGE = 8;
/** Gap between a tooltip and its trigger. */
export const TIP_GAP = 6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * A tooltip beside its trigger, inside the window. "bottom" / "top" centre it on the trigger and flip
 * when that side is short; "right" centres it vertically and flips to the left, then under the
 * trigger, when the window is too narrow.
 */
export function placeTooltip(trigger: Rect, tip: Size, side: TooltipSide, vw: number, vh: number): { top: number; left: number; side: TooltipSide | "left" } {
  const { width: w, height: h } = tip;
  if (side === "right") {
    const top = clamp(trigger.top + trigger.height / 2 - h / 2, EDGE, vh - EDGE - h);
    if (trigger.right + TIP_GAP + w <= vw - EDGE) return { top, left: trigger.right + TIP_GAP, side: "right" };
    if (trigger.left - TIP_GAP - w >= EDGE) return { top, left: trigger.left - TIP_GAP - w, side: "left" };
    return placeTooltip(trigger, tip, "bottom", vw, vh);
  }
  const left = clamp(trigger.left + trigger.width / 2 - w / 2, EDGE, vw - EDGE - w);
  const below = trigger.bottom + TIP_GAP;
  const above = trigger.top - TIP_GAP - h;
  const fitsBelow = below + h <= vh - EDGE;
  const fitsAbove = above >= EDGE;
  const useTop = side === "top" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
  return useTop ? { top: Math.max(EDGE, above), left, side: "top" } : { top: below, left, side: "bottom" };
}

/**
 * A popover beside a column (the left rail) or its own trigger: its top level with the trigger,
 * clamped so the whole panel stays in the window, and never taller than the window less the margins
 * (the body scrolls instead). `natural` is the panel's full content height. Returns null when the
 * panel doesn't fit to the right of `column` (a phone): the caller opens it under the trigger.
 */
export function placeBeside(
  anchor: Rect,
  column: Rect,
  panel: Size,
  vw: number,
  vh: number,
  margin = EDGE,
): { top: number; left: number; maxHeight: number; origin: string } | null {
  const left = column.right + margin;
  if (left + panel.width > vw - margin) return null;
  const maxHeight = Math.max(0, vh - margin * 2);
  const h = Math.min(panel.height, maxHeight);
  const top = clamp(anchor.top, margin, vh - margin - h);
  // Scale in from the trigger's middle, on the panel's left edge.
  return { top, left, maxHeight, origin: `0px ${Math.round(anchor.top + anchor.height / 2 - top)}px` };
}
