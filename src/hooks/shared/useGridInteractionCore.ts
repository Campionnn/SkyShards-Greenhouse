import { useState, useRef, useCallback, useEffect } from "react";
import {
  getGridCellWithOffset as getGridCellWithOffsetUtil,
  getGridCellClampedWithOffset as getGridCellClampedWithOffsetUtil,
  getPlacementPosition,
  findNearestValidPosition,
  doPlacementsOverlap,
  type CellWithOffset,
  type BasePlacement,
} from "../../utilities";

export interface DragState {
  placementId: string;
  startPosition: [number, number];
  currentPosition: [number, number];
  isDragging: boolean;
}

export interface PaintState {
  mode: "place" | "remove";
}

export interface HoverInfo {
  cell: [number, number];
  offsetX: number;
  offsetY: number;
}

export interface GridInteractionConfig<TPlacement extends BasePlacement, TSelectedItem> {
  cellSize: number;
  gap: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
  
  placements: TPlacement[];
  selectedItem: TSelectedItem | null;
  isPlacementMode: boolean;
  
  isValidPlacement: (position: [number, number], size: number, excludeId?: string) => { valid: boolean; error?: string };
  isValidPlacementPosition: (position: [number, number], size: number) => { valid: boolean; error?: string };
  
  onAddPlacement: (position: [number, number], offsetX: number, offsetY: number) => [number, number] | null;
  onRemovePlacement: (cell: [number, number]) => void;
  onMovePlacement: (placementId: string, newPosition: [number, number]) => { success: boolean; error?: string };
  
  showToast: (title: string, description?: string, variant?: "success" | "error" | "warning") => void;
  
  getSelectedItemSize: () => number;
}

/** Grid mouse tracking, drag-to-move and paint mode, shared by the Calculator and the Designer. */
export function useGridInteractionCore<TPlacement extends BasePlacement, TSelectedItem>({
  cellSize,
  gap,
  gridRef,
  placements,
  selectedItem,
  isPlacementMode,
  isValidPlacement,
  isValidPlacementPosition,
  onAddPlacement,
  onRemovePlacement,
  onMovePlacement,
  showToast,
  getSelectedItemSize,
}: GridInteractionConfig<TPlacement, TSelectedItem>) {
  
  const [hoveredPlacementId, setHoveredPlacementId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [paintState, setPaintState] = useState<PaintState | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  
  // A ref, not state, so fast mouse movement never reads a stale closure.
  const paintDataRef = useRef<{
    lastCell: [number, number] | null;
    lastPlacedPosition: [number, number] | null;
    lastPlacedSize: number;
  }>({ lastCell: null, lastPlacedPosition: null, lastPlacedSize: 1 });

  const getGridCellWithOffset = useCallback((clientX: number, clientY: number): CellWithOffset | null => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    return getGridCellWithOffsetUtil(clientX, clientY, rect, cellSize, gap);
  }, [gridRef, cellSize, gap]);
  
  const getGridCellClampedWithOffset = useCallback((clientX: number, clientY: number): CellWithOffset | null => {
    if (!gridRef.current) return null;
    const rect = gridRef.current.getBoundingClientRect();
    return getGridCellClampedWithOffsetUtil(clientX, clientY, rect, cellSize, gap);
  }, [gridRef, cellSize, gap]);
  
  const isValidPositionFn = useCallback((pos: [number, number], size: number) => {
    return isValidPlacementPosition(pos, size);
  }, [isValidPlacementPosition]);
  
  // Placement position for the cursor, snapped to the nearest valid one.
  const getAdjustedPosition = useCallback((
    cursorCell: [number, number],
    offsetX: number,
    offsetY: number,
    size: number
  ): [number, number] | null => {
    const basePos = getPlacementPosition(cursorCell, offsetX, offsetY, size);
    return findNearestValidPosition(basePos, size, isValidPositionFn);
  }, [isValidPositionFn]);
  
  const handlePaintAtCell = useCallback((
    cell: [number, number],
    offsetX: number,
    offsetY: number,
    mode: "place" | "remove"
  ) => {
    const { lastCell, lastPlacedPosition, lastPlacedSize } = paintDataRef.current;
    
    // Act once per cell.
    if (lastCell && lastCell[0] === cell[0] && lastCell[1] === cell[1]) {
      return;
    }
    
    if (mode === "place" && selectedItem) {
      const size = getSelectedItemSize();
      const adjustedPos = getAdjustedPosition(cell, offsetX, offsetY, size);
      
      if (adjustedPos && !doPlacementsOverlap(adjustedPos, size, lastPlacedPosition ?? [-100, -100], lastPlacedSize)) {
        const placedPos = onAddPlacement(cell, offsetX, offsetY);
        if (placedPos) {
          paintDataRef.current = { lastCell: cell, lastPlacedPosition: placedPos, lastPlacedSize: size };
        } else {
          paintDataRef.current = { ...paintDataRef.current, lastCell: cell };
        }
      } else {
        paintDataRef.current = { ...paintDataRef.current, lastCell: cell };
      }
    } else if (mode === "remove") {
      onRemovePlacement(cell);
      paintDataRef.current = { ...paintDataRef.current, lastCell: cell };
    }
  }, [selectedItem, getAdjustedPosition, onAddPlacement, onRemovePlacement, getSelectedItemSize]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const cellInfo = getGridCellWithOffset(e.clientX, e.clientY);
    
    if (dragState) {
      if (cellInfo) {
        const placement = placements.find(p => p.id === dragState.placementId);
        if (placement) {
          const adjustedPos = getAdjustedPosition(cellInfo.cell, cellInfo.offsetX, cellInfo.offsetY, placement.size);
          if (adjustedPos) {
            setDragState(prev => prev ? { ...prev, currentPosition: adjustedPos } : null);
          }
        } else {
          setDragState(prev => prev ? { ...prev, currentPosition: cellInfo.cell } : null);
        }
      }
    } else if (paintState) {
      if (cellInfo) {
        handlePaintAtCell(cellInfo.cell, cellInfo.offsetX, cellInfo.offsetY, paintState.mode);
      }
    } else if (isPlacementMode) {
      setHoverInfo(cellInfo);
    }
  }, [getGridCellWithOffset, dragState, paintState, isPlacementMode, handlePaintAtCell, placements, getAdjustedPosition]);
  
  const handleMouseLeave = useCallback(() => {
    if (!dragState && !paintState) {
      setHoverInfo(null);
    }
  }, [dragState, paintState]);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (dragState) return;
    
    const cellInfo = getGridCellWithOffset(e.clientX, e.clientY);
    if (!cellInfo) return;
    
    const { cell, offsetX, offsetY } = cellInfo;
    
    // Left click in placement mode starts paint-placing; right click starts paint-removing.
    if (e.button === 0 && isPlacementMode && selectedItem) {
      e.preventDefault();
      const size = getSelectedItemSize();
      const placedPos = onAddPlacement(cell, offsetX, offsetY);
      paintDataRef.current = { lastCell: cell, lastPlacedPosition: placedPos, lastPlacedSize: size };
      setPaintState({ mode: "place" });
      setHoverInfo(null);
    }
    else if (e.button === 2) {
      e.preventDefault();
      onRemovePlacement(cell);
      setHoveredPlacementId(null);
      paintDataRef.current = { lastCell: cell, lastPlacedPosition: null, lastPlacedSize: 1 };
      setPaintState({ mode: "remove" });
      setHoverInfo(null);
    }
  }, [getGridCellWithOffset, dragState, isPlacementMode, selectedItem, onAddPlacement, onRemovePlacement, getSelectedItemSize]);
  
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);
  
  const handlePlacementMouseDown = useCallback((placementId: string, e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      e.stopPropagation();
      const placement = placements.find(p => p.id === placementId);
      if (placement) {
        onRemovePlacement(placement.position);
      }
      setHoveredPlacementId(null);
      setHoverInfo(null);
      paintDataRef.current = { lastCell: null, lastPlacedPosition: null, lastPlacedSize: 1 };
      setPaintState({ mode: "remove" });
      return;
    }
    
    // Left click starts a move, outside placement mode.
    if (e.button === 0 && !isPlacementMode) {
      e.preventDefault();
      e.stopPropagation();
      
      const placement = placements.find(p => p.id === placementId);
      if (placement) {
        setDragState({
          placementId,
          startPosition: placement.position,
          currentPosition: placement.position,
          isDragging: false, // Set once the mouse moves to another cell.
        });
      }
    }
  }, [placements, onRemovePlacement, isPlacementMode]);
  
  const handleMouseUp = useCallback(() => {
    if (dragState) {
      const { placementId, startPosition, currentPosition, isDragging } = dragState;
      
      // A click without movement is not a move.
      if (isDragging && (startPosition[0] !== currentPosition[0] || startPosition[1] !== currentPosition[1])) {
        const moveResult = onMovePlacement(placementId, currentPosition);
        
        if (!moveResult.success) {
          showToast("Cannot move here", moveResult.error, "error");
        }
      }
      
      setDragState(null);
    }
    
    if (paintState) {
      setPaintState(null);
      setHoveredPlacementId(null);
      paintDataRef.current = { lastCell: null, lastPlacedPosition: null, lastPlacedSize: 1 };
    }
  }, [dragState, paintState, onMovePlacement, showToast]);

  useEffect(() => {
    if (!paintState && !dragState) return;
    
    const handleDocumentMouseMove = (e: MouseEvent) => {
      const cellInfo = getGridCellClampedWithOffset(e.clientX, e.clientY);
      if (!cellInfo) return;
      
      if (dragState) {
        const placement = placements.find(p => p.id === dragState.placementId);
        if (placement) {
          const adjustedPos = getAdjustedPosition(cellInfo.cell, cellInfo.offsetX, cellInfo.offsetY, placement.size);
          if (adjustedPos) {
            const hasMoved = adjustedPos[0] !== dragState.startPosition[0] || adjustedPos[1] !== dragState.startPosition[1];
            setDragState(prev => prev ? { 
              ...prev, 
              currentPosition: adjustedPos,
              isDragging: prev.isDragging || hasMoved,
            } : null);
          }
        } else {
          setDragState(prev => prev ? { ...prev, currentPosition: cellInfo.cell, isDragging: true } : null);
        }
      } else if (paintState) {
        handlePaintAtCell(cellInfo.cell, cellInfo.offsetX, cellInfo.offsetY, paintState.mode);
      }
    };
    
    const handleDocumentMouseUp = () => handleMouseUp();
    
    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseup", handleDocumentMouseUp);
    
    return () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
    };
  }, [paintState, dragState, placements, getGridCellClampedWithOffset, getAdjustedPosition, handlePaintAtCell, handleMouseUp]);

  const previewPosition = hoverInfo && selectedItem
    ? getAdjustedPosition(hoverInfo.cell, hoverInfo.offsetX, hoverInfo.offsetY, getSelectedItemSize())
    : null;
  
  const previewValidation = previewPosition && selectedItem
    ? isValidPlacementPosition(previewPosition, getSelectedItemSize())
    : null;
  
  const dragValidation = dragState
    ? (() => {
        const placement = placements.find(p => p.id === dragState.placementId);
        if (!placement) return null;
        return isValidPlacement(dragState.currentPosition, placement.size, dragState.placementId);
      })()
    : null;
  
  // Cancels a pending drag when the press turns out to be a click.
  const cancelDrag = useCallback(() => {
    setDragState(null);
  }, []);
  
  return {
    hoveredPlacementId,
    setHoveredPlacementId,
    dragState,
    paintState,
    hoverInfo,
    
    previewPosition,
    previewValidation,
    dragValidation,
    
    handleMouseMove,
    handleMouseLeave,
    handleMouseDown,
    handleMouseUp,
    handleContextMenu,
    handlePlacementMouseDown,
    cancelDrag,
    
    getAdjustedPosition,
  };
}
