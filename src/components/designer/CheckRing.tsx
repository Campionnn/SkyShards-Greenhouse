import React from "react";
import type { CheckState } from "./checkModel";

/**
 * The Check focus on the grid: a select-colour ring around each target of the row hovered or picked in
 * Check. The page draws it in the grid stage, beside `[data-grid-container]` (not inside it), so the PNG /
 * GIF export and the share image never see it. `offsetX` / `offsetY`: where the grid sits in the stage.
 * Below the grid's own tooltip and the start card (z-(--z-sticky)); it never takes pointer events.
 */
export const CheckRing: React.FC<{ check: CheckState; cellSize: number; gap: number; offsetX: number; offsetY: number }> = ({ check, cellSize, gap, offsetX, offsetY }) => {
  const ring = check.active.ring;
  if (!ring.length) return null;
  const span = (n: number) => n * cellSize + (n - 1) * gap;
  return (
    <>
      {ring.map((p) => (
        <span
          key={p.id}
          aria-hidden
          data-check-ring
          className="pointer-events-none absolute z-(--z-sticky) rounded-inner outline-2 outline-offset-1 outline-select"
          style={{
            left: offsetX + p.position[1] * (cellSize + gap),
            top: offsetY + p.position[0] * (cellSize + gap),
            width: span(p.size),
            height: span(p.size),
          }}
        />
      ))}
    </>
  );
};
