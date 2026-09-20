import React from "react";
import { CropImage } from "../shared";
import { EffectChips } from "../shared";
import { getEffectName, sortEffects } from "../../utilities";
import { calculateCropImageDimensions, getCellPixelPosition } from "../../utilities";

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
}

const TOOLTIP_WIDTH = 248;
const TOOLTIP_EST_HEIGHT = 150;
const OFFSET = 8;

/**
 * Floating "has / gives" card anchored to a grid cell. Positioned inside the
 * grid container (which is `position: relative`), so it never pushes other
 * content around. Flips to the left when it would overflow the grid.
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
}) => {
  const { totalWidth } = calculateCropImageDimensions(size, cellSize, gap);
  const { top, left } = getCellPixelPosition(position[0], position[1], cellSize, gap);

  let x = left + totalWidth + OFFSET;
  if (x + TOOLTIP_WIDTH > gridWidth) {
    x = left - OFFSET - TOOLTIP_WIDTH;
    if (x < 0) x = Math.max(0, gridWidth - TOOLTIP_WIDTH);
  }
  const y = Math.max(0, Math.min(top, gridHeight - TOOLTIP_EST_HEIGHT));
  const suppressedList = suppressed ? sortEffects(suppressed) : [];

  return (
    <div
      className="absolute z-50 pointer-events-none bg-slate-900/95 border border-slate-600/60 rounded-lg shadow-xl p-3 backdrop-blur-sm"
      style={{ top: y, left: x, width: TOOLTIP_WIDTH }}
      role="tooltip"
    >
      <div className="flex items-center gap-2 mb-2">
        <CropImage cropId={id} cropName={name} size="xs" showFallback={false} />
        <div className="min-w-0">
          <div className="text-sm text-slate-100 truncate">{name}</div>
          <div className="text-[11px] text-slate-500">
            ({position[0]}, {position[1]}){size > 1 ? ` · ${size}x${size}` : ""}{note ? ` · ${note}` : ""}
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">Has</div>
          <EffectChips effects={has} variant="has" emptyText="nothing" />
          {suppressedList.length > 0 && (
            <div className="mt-1 text-[11px] text-slate-500">
              cancelled: {suppressedList.map(getEffectName).join(", ")}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">Gives</div>
          <EffectChips effects={gives} variant="gives" emptyText="nothing" />
          {givesNote && <div className="mt-1 text-[11px] text-slate-500">{givesNote}</div>}
        </div>
      </div>
    </div>
  );
};
