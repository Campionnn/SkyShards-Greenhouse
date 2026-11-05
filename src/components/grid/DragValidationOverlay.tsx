import React from "react";
import { calculateCropImageDimensions, getCellPixelPosition } from "../../utilities";

export interface DragValidationOverlayProps {
  position: [number, number];
  size: number;
  cellSize: number;
  gap: number;
  isValid: boolean;
}

export const DragValidationOverlay: React.FC<DragValidationOverlayProps> = ({ position, size, cellSize, gap, isValid }) => {
  const { totalWidth, totalHeight } = calculateCropImageDimensions(size, cellSize, gap);
  const { top, left } = getCellPixelPosition(position[0], position[1], cellSize, gap);
  return (
    <div
      className="pointer-events-none absolute rounded-inner"
      style={{
        top,
        left,
        width: totalWidth,
        height: totalHeight,
        border: `2px dashed ${isValid ? "var(--color-go)" : "var(--color-problem)"}`,
        zIndex: 25,
      }}
    />
  );
};
