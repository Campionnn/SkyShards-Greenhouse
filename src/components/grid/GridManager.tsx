import React, { useState, useRef, useCallback, useEffect } from "react";
import { GRID_SIZE } from "../../constants";
import { GridCell } from "./GridCell";

interface GridManagerProps {
  isInteractive?: boolean;
  showCoordinates?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const GridManager: React.FC<GridManagerProps> = ({
  isInteractive = true,
  showCoordinates = false,
  size = "md",
  className = "",
}) => {
  const rows = Array.from({ length: GRID_SIZE }, (_, i) => i);
  const cols = Array.from({ length: GRID_SIZE }, (_, i) => i);
  
  const [isDragging, setIsDragging] = useState(false);
  const paintModeRef = useRef<'lock' | 'unlock' | null>(null);
  const hasDraggedRef = useRef(false);
  
  const handleMouseDown = useCallback(() => {
    if (!isInteractive) return;
    setIsDragging(true);
    hasDraggedRef.current = false;
  }, [isInteractive]);
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    paintModeRef.current = null;
    hasDraggedRef.current = false;
  }, []);
  
  const handleMouseMove = useCallback(() => {
    if (isDragging) {
      hasDraggedRef.current = true;
    }
  }, [isDragging]);
  
  // End the paint stroke even when the mouse is released outside the grid.
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseUp]);
  
  return (
    <div 
      className={`select-none ${size === "md" ? "w-full max-w-[418px]" : "inline-block"} ${className}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
      >
        {rows.map(row =>
          cols.map(col => (
            <GridCell
              key={`${row}-${col}`}
              row={row}
              col={col}
              isInteractive={isInteractive}
              showCoordinates={showCoordinates}
              size={size}
              isDragging={isDragging}
              paintModeRef={paintModeRef}
              hasDraggedRef={hasDraggedRef}
            />
          ))
        )}
      </div>
    </div>
  );
};
