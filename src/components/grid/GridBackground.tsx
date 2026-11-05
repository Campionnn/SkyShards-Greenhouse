import React from "react";
import { GRID_SIZE } from "../../constants";
import { getCellPixelPosition } from "../../utilities";
import { cn } from "../ui/cn";
import { LOCKED_CELL, UNLOCKED_CELL } from "./gridCellStyles";

export interface GridBackgroundProps {
  cellSize: number;
  gap: number;
  unlockedCells: Set<string>;
  variant?: "green" | "gray";
}

export const GridBackground: React.FC<GridBackgroundProps> = ({ cellSize, gap, unlockedCells, variant = "green" }) => (
  <>
    {Array.from({ length: GRID_SIZE }).map((_, rowIndex) =>
      Array.from({ length: GRID_SIZE }).map((_, colIndex) => {
        const key = `${rowIndex},${colIndex}`;
        const { top, left } = getCellPixelPosition(rowIndex, colIndex, cellSize, gap);
        return (
          <div
            key={key}
            style={{ position: "absolute", top, left, width: cellSize, height: cellSize }}
            className={cn("rounded-inner", unlockedCells.has(key) ? UNLOCKED_CELL[variant] : LOCKED_CELL)}
          />
        );
      }),
    )}
  </>
);
