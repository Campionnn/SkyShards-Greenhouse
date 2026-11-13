import React from "react";
import { GRID_SIZE } from "../../constants";
import { useGridState } from "../../context";
import { cn } from "../ui/cn";
import { surface } from "../ui/surface";

interface GridPreviewProps {
  className?: string;
  onClick?: () => void;
}

export const GridPreview: React.FC<GridPreviewProps> = ({ className, onClick }) => {
  const { isCellUnlocked, unlockedCells } = useGridState();
  const rows = Array.from({ length: GRID_SIZE }, (_, i) => i);
  const cols = Array.from({ length: GRID_SIZE }, (_, i) => i);
  return (
    <button type="button" className={cn("group focus-ring block w-full cursor-pointer rounded-container text-left", className)} onClick={onClick} title="Edit the grid">
      <div className={cn(surface.card, "flex flex-col gap-px p-2 transition-colors duration-(--duration-hover) group-hover:border-line-strong")}>
        <div className="mb-1 text-center text-secondary text-fg-muted group-hover:text-fg">{unlockedCells.size} cells selected</div>
        <div className="flex aspect-square w-full flex-col gap-px">
          {rows.map((row) => (
            <div key={row} className="flex flex-1 gap-px">
              {cols.map((col) => (
                <div key={`${row}-${col}`} className={cn("flex-1", isCellUnlocked(row, col) ? "bg-go" : "bg-surface-hover")} style={{ borderRadius: 1 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </button>
  );
};
