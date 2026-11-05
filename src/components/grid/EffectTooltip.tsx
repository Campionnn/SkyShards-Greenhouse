import React from "react";
import { CropImage } from "../shared";
import { EffectChips } from "../shared";
import { getEffectName, sortEffects } from "../../utilities";
import { calculateCropImageDimensions, getCellPixelPosition } from "../../utilities";
import { cn } from "../ui/cn";
import { KitLabel } from "../ui/kit";
import { surface } from "../ui/surface";

export interface EffectTooltipProps {
  id: string;
  name: string;
  position: [number, number];
  size: number;
  has: Iterable<string>;
  gives: Iterable<string>;
  suppressed?: Iterable<string>;
  cellSize: number;
  gap: number;
  gridWidth: number;
  gridHeight: number;
  /** Extra line under the name (e.g. "Locked", "Target") */
  note?: string;
  /** Explains an empty "Gives" (a target slot gives nothing). */
  givesNote?: string;
  /** Left / top edge of the visible area in grid pixels (a grid cropped to its unlocked cells). Default 0. */
  boundsLeft?: number;
  boundsTop?: number;
}

const TOOLTIP_WIDTH = 248;
const TOOLTIP_EST_HEIGHT = 150;
const OFFSET = 8;

/**
 * Floating "has / gives" card anchored to a grid cell, positioned inside the
 * relative grid container so it never shifts layout. Flips left when it would
 * overflow the grid.
 */
export const EffectTooltip: React.FC<EffectTooltipProps> = ({
  id,
  name,
  position,
  size,
  has,
  gives,
  suppressed,
  cellSize,
  gap,
  gridWidth,
  gridHeight,
  note,
  givesNote,
  boundsLeft = 0,
  boundsTop = 0,
}) => {
  const { totalWidth } = calculateCropImageDimensions(size, cellSize, gap);
  const { top, left } = getCellPixelPosition(position[0], position[1], cellSize, gap);

  let x = left + totalWidth + OFFSET;
  if (x + TOOLTIP_WIDTH > gridWidth) {
    x = left - OFFSET - TOOLTIP_WIDTH;
    if (x < boundsLeft) x = Math.max(boundsLeft, gridWidth - TOOLTIP_WIDTH);
  }
  const y = Math.max(boundsTop, Math.min(top, gridHeight - TOOLTIP_EST_HEIGHT));
  const suppressedList = suppressed ? sortEffects(suppressed) : [];

  return (
    <div
      className={cn(surface.raised, "pointer-events-none absolute z-(--z-tooltip) p-3")}
      style={{ top: y, left: x, width: TOOLTIP_WIDTH }}
      role="tooltip"
    >
      <div className="flex items-center gap-2 mb-2">
        <CropImage cropId={id} cropName={name} size="xs" showFallback={false} />
        <div className="min-w-0">
          <div className="truncate text-body font-medium text-fg">{name}</div>
          <div className="text-meta text-fg-meta">
            ({position[0]}, {position[1]}){size > 1 ? ` · ${size}x${size}` : ""}{note ? ` · ${note}` : ""}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <div>
          <KitLabel className="mb-0.5">Has</KitLabel>
          <EffectChips effects={has} variant="has" emptyText="nothing" />
          {suppressedList.length > 0 && (
            <div className="mt-1 text-meta text-fg-meta">
              cancelled: {suppressedList.map(getEffectName).join(", ")}
            </div>
          )}
        </div>
        <div>
          <KitLabel className="mb-0.5">Gives</KitLabel>
          <EffectChips effects={gives} variant="gives" emptyText="nothing" />
          {givesNote && <div className="mt-1 text-meta text-fg-meta">{givesNote}</div>}
        </div>
      </div>
    </div>
  );
};
