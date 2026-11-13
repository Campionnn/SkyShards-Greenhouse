import React, { useRef } from "react";
import { useGridState } from "../../context";
import { cn } from "../ui/cn";

// The expansion API reports expected gloomgourd spawns per tick; each
// gloomgourd spot spawns at 0.3/tick (weight 30 of a 100 pool), so dividing
// gives the number of gloomgourd spots.
const GLOOMGOURD_SPAWN_RATE = 0.3;
const toGloomgourdSpots = (rate: number) => Math.round(rate / GLOOMGOURD_SPAWN_RATE);

interface GridCellProps {
  row: number;
  col: number;
  isInteractive?: boolean;
  showCoordinates?: boolean;
  size?: "sm" | "md" | "lg";
  isDragging?: boolean;
  paintModeRef?: React.RefObject<'lock' | 'unlock' | null>;
  hasDraggedRef?: React.RefObject<boolean>;
}

export const GridCell: React.FC<GridCellProps> = ({
  row,
  col,
  isInteractive = true,
  showCoordinates = false,
  size = "md",
  isDragging = false,
  paintModeRef,
  hasDraggedRef,
}) => {
  const { 
    isCellUnlocked, 
    isCellExpandable, 
    unlockCell,
    lockCell,
    getExpansionStep,
    expansionSteps,
  } = useGridState();
  
  const paintedRef = useRef(false);
  
  const isUnlocked = isCellUnlocked(row, col);
  const isExpandable = isCellExpandable(row, col);
  const expansionStep = getExpansionStep(row, col);
  const hasExpansionOverlay = expansionSteps.length > 0;
  
  // A new drag may paint this cell again.
  if (!isDragging && paintedRef.current) {
    paintedRef.current = false;
  }
  
  const sizeClasses = {
    sm: "size-6 text-meta",
    md: "w-full aspect-square min-w-0 text-secondary",
    lg: "size-12 text-body",
  };
  
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isInteractive || hasExpansionOverlay) return;
    
    e.preventDefault();
    
    // Only the next expansion step is clickable while the overlay shows.
    if (expansionStep && expansionStep.order === 1) {
      unlockCell(row, col);
      return;
    }
    
    // The first cell of a drag decides whether the stroke locks or unlocks.
    if (paintModeRef?.current === null) {
      if (isUnlocked) {
        paintModeRef.current = 'lock';
        lockCell(row, col);
      } else {
        paintModeRef.current = 'unlock';
        unlockCell(row, col);
      }
      paintedRef.current = true;
    }
  };
  
  const handleClick = (e: React.MouseEvent) => {
    if (hasDraggedRef?.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  
  const handleMouseEnter = () => {
    if (!isInteractive || !isDragging || hasExpansionOverlay || paintedRef.current) return;
    
    const paintMode = paintModeRef?.current;
    if (!paintMode) return;
    
    // No adjacency requirement.
    if (paintMode === 'unlock' && !isUnlocked) {
      unlockCell(row, col);
      paintedRef.current = true;
    } else if (paintMode === 'lock' && isUnlocked) {
      lockCell(row, col);
      paintedRef.current = true;
    }
  };
  
  let cellClasses = cn(sizeClasses[size], "relative flex items-center justify-center rounded-inner border transition-colors duration-(--duration-hover)");
  const cellStyle: React.CSSProperties = {};
  
  if (isUnlocked) {
    cellClasses += " bg-go border-go text-on-go";
    if (isInteractive) {
      cellClasses += " hover:bg-go-hover cursor-pointer";
    }
  } else if (expansionStep && hasExpansionOverlay) {
    const totalSteps = expansionSteps.length;
    const minLight = 45;
    const maxLight = 75;
    let lightness = maxLight;
    if (totalSteps > 1) {
      lightness = maxLight - ((expansionStep.order - 1) / (totalSteps - 1)) * (maxLight - minLight);
    }
    // The expansion path in coin gold: step 1 brightest, later steps fainter.
    cellStyle.opacity = 0.55 + ((lightness - minLight) / (maxLight - minLight)) * 0.45;
    cellClasses += " bg-coin border-coin text-surface-page font-bold";
    if (isInteractive && expansionStep.order === 1) {
      cellClasses += " cursor-pointer hover:brightness-110";
    } else if (isInteractive) {
      cellClasses += " cursor-not-allowed";
    }
  } else if (isExpandable) {
    cellClasses += " bg-surface-hover border-line-control text-fg-muted";
    if (isInteractive) {
      cellClasses += " hover:bg-surface-control hover:border-go/60 cursor-pointer";
    }
  } else {
    // Locked, not adjacent to an unlocked cell.
    cellClasses += " bg-surface-well border-line text-fg-meta";
    if (isInteractive) {
      cellClasses += " hover:bg-surface-hover hover:border-line-control cursor-pointer";
    }
  }
  
  return (
    <div 
      className={cellClasses} 
      style={cellStyle}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      title={expansionStep ? `Step ${expansionStep.order}: +${toGloomgourdSpots(expansionStep.gloomgourd_gain)} (total: ${toGloomgourdSpots(expansionStep.gloomgourd_potential)})` : undefined}
    >
      {expansionStep && hasExpansionOverlay ? (
        <>
          <span className="text-body font-bold">{expansionStep.order}</span>
          <span className="absolute right-0.5 bottom-0 text-meta leading-none font-medium">
            +{toGloomgourdSpots(expansionStep.gloomgourd_gain)}
          </span>
        </>
      ) : showCoordinates ? (
        <span className="text-meta opacity-60">{row},{col}</span>
      ) : null}
    </div>
  );
};
