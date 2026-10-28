import React from "react";
import { getGroundImagePath } from "../../types/greenhouse";

/**
 * The ground under a hidden placement, drawn one tile per cell with the grid's gaps (like the
 * normal grid), instead of one texture stretched over the whole footprint. Render it as the first
 * child of a placement whose own background is off; it fills the placement's box.
 */
export const BareGround: React.FC<{ ground: string; size: number; cellSize: number; gap: number }> = ({ ground, size, cellSize, gap }) => {
  const url = `url(${getGroundImagePath(ground)})`;
  const tiles: React.ReactNode[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      tiles.push(
        <div
          key={`${r},${c}`}
          className="absolute rounded-sm"
          style={{ top: r * (cellSize + gap), left: c * (cellSize + gap), width: cellSize, height: cellSize, backgroundImage: url, backgroundSize: "cover" }}
        />
      );
    }
  }
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none">
      {tiles}
    </div>
  );
};
