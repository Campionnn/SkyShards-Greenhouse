import { useCallback, useEffect } from "react";
import { useDesigner, type DesignerPlacement } from "../context";
import { useToast } from "../components/ui/toastContext";
import { useGridInteractionCore, type DragState, type PaintState, type HoverInfo } from "./shared/useGridInteractionCore";
import { getPlacementPosition, findNearestValidPosition } from "../utilities";

/** Ground can be painted over existing ground, but never over crop or target footprints. */
export function getPaintableGroundPreviewPosition(
  cell: [number, number] | null,
  isGroundSelected: boolean,
  isInteracting: boolean,
  getPlacementAt: (row: number, col: number) => DesignerPlacement | undefined
): [number, number] | null {
  if (!cell || !isGroundSelected || isInteracting || getPlacementAt(cell[0], cell[1])) return null;
  return cell;
}

export interface UseDesignerGridPlacementOptions {
  cellSize: number;
  gap: number;
  gridRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseDesignerGridPlacementReturn {
  // State
  hoveredPlacementId: string | null;
  setHoveredPlacementId: React.Dispatch<React.SetStateAction<string | null>>;
  dragState: DragState | null;
  paintState: PaintState | null;
  hoverInfo: HoverInfo | null;
  
  // Computed values
  previewPosition: [number, number] | null;
  groundPreviewPosition: [number, number] | null;
  previewValidation: { valid: boolean; error?: string } | null;
  dragValidation: { valid: boolean; error?: string } | null;
  
  // Event handlers
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseLeave: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleContextMenu: (e: React.MouseEvent) => void;
  handlePlacementMouseDown: (placementId: string, e: React.MouseEvent) => void;
}

export function useDesignerGridPlacement({
  cellSize,
  gap,
  gridRef,
}: UseDesignerGridPlacementOptions): UseDesignerGridPlacementReturn {
  const {
    allPlacements,
    selectedCropForPlacement,
    setSelectedCropForPlacement,
    addPlacement,
    removePlacement,
    movePlacement,
    getPlacementAt,
    isValidPlacement,
    isValidPlacementPosition,
    isPlacementMode,
    selectedGround,
    setSelectedGround,
    paintGround,
    removeGround,
    beginEdit,
    endEdit,
  } = useDesigner();
  const { toast } = useToast();

  // A paint / erase stroke (mouse down -> drag -> up) is one undo step.
  const startStroke = useCallback(() => {
    beginEdit();
    const finish = () => {
      window.removeEventListener("mouseup", finish);
      endEdit();
    };
    window.addEventListener("mouseup", finish);
  }, [beginEdit, endEdit]);

  // ESC key handler to deselect crop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCropForPlacement(null);
        setSelectedGround(null);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSelectedCropForPlacement, setSelectedGround]);

  // Adapter functions to match the core hook's expected interface
  const handleAddPlacement = useCallback((
    cell: [number, number],
    offsetX: number,
    offsetY: number
  ): [number, number] | null => {
    if (selectedGround) {
      paintGround(cell, selectedGround);
      return cell;
    }
    if (!selectedCropForPlacement) return null;
    
    // Calculate position
    const basePos = getPlacementPosition(cell, offsetX, offsetY, selectedCropForPlacement.size);
    const adjustedPos = findNearestValidPosition(basePos, selectedCropForPlacement.size, isValidPlacementPosition);
    if (!adjustedPos) return null;
    
    const result = addPlacement({
      cropId: selectedCropForPlacement.id,
      cropName: selectedCropForPlacement.name,
      size: selectedCropForPlacement.size,
      position: adjustedPos,
      isMutation: selectedCropForPlacement.isMutation,
    });
    
    if (!result.success) {
      toast({
        title: "Cannot place here",
        description: result.error,
        variant: "error",
        duration: 2000,
      });
      return null;
    }
    
    return adjustedPos;
  }, [selectedCropForPlacement, selectedGround, paintGround, addPlacement, toast, isValidPlacementPosition]);
  
  const handleRemovePlacement = useCallback((cell: [number, number]) => {
    const placement = getPlacementAt(cell[0], cell[1]);
    if (placement) {
      removePlacement(placement.id);
    } else {
      removeGround(cell);
    }
  }, [getPlacementAt, removePlacement, removeGround]);
  
  const handleShowToast = useCallback((title: string, description?: string, variant?: "success" | "error" | "warning") => {
    toast({
      title,
      description,
      variant: variant || "error",
      duration: 2000,
    });
  }, [toast]);
  
  const getSelectedItemSize = useCallback(() => {
    return selectedGround ? 1 : selectedCropForPlacement?.size || 1;
  }, [selectedCropForPlacement, selectedGround]);
  
  // Keep ground hover visual-only; use the shared core for its existing paint/drag behavior.
  const interaction = useGridInteractionCore({
    cellSize,
    gap,
    gridRef,
    placements: allPlacements,
    selectedItem: selectedGround ?? selectedCropForPlacement,
    isPlacementMode: isPlacementMode || selectedGround !== null,
    isValidPlacement,
    isValidPlacementPosition,
    onAddPlacement: handleAddPlacement,
    onRemovePlacement: handleRemovePlacement,
    onMovePlacement: movePlacement,
    showToast: handleShowToast,
    getSelectedItemSize,
  });

  const { handleMouseDown: coreMouseDown, handlePlacementMouseDown: corePlacementMouseDown } = interaction;
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 2) startStroke();
    coreMouseDown(e);
  }, [coreMouseDown, startStroke]);
  const handlePlacementMouseDown = useCallback((placementId: string, e: React.MouseEvent) => {
    if (e.button === 2) startStroke();
    corePlacementMouseDown(placementId, e);
  }, [corePlacementMouseDown, startStroke]);

  return {
    ...interaction,
    handleMouseDown,
    handlePlacementMouseDown,
    groundPreviewPosition: getPaintableGroundPreviewPosition(
      interaction.hoverInfo?.cell ?? null,
      selectedGround !== null,
      interaction.dragState !== null || interaction.paintState !== null,
      getPlacementAt
    ),
  };
}

// Re-export types
export type { DragState as DesignerDragState, PaintState as DesignerPaintState, HoverInfo as DesignerHoverInfo };
