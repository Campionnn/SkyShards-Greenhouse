import { createContext, useContext } from "react";
import type { MutationDefinition } from "../types/greenhouse";
import type { EffectSimulation, LayoutTransform } from "../utilities";
import type { GroundTile, GroundType } from "../utilities/designEncoding";

// Designer context, types and `useDesigner`, kept apart from DesignerProvider so
// DesignerContext.tsx exports only a component (required by React Fast Refresh).

export type DesignerMode = "inputs" | "targets";

export interface DesignerPlacement {
  id: string;
  cropId: string;
  cropName: string;
  size: number;
  position: [number, number];
  isMutation: boolean;
}

export interface SelectedCropForDesigner {
  id: string;
  name: string;
  size: number;
  isMutation: boolean;
}

export interface RequirementInfo {
  crop: string;
  needed: number;
  have: number;
  satisfied: boolean;
}

// An effect the spot must hold (godseed-style mutations).
export interface EffectRequirementInfo {
  effect: string;
  satisfied: boolean;
}

export interface MutationValidationInfo {
  isValid: boolean;
  missingRequirements: Array<RequirementInfo>;
  satisfiedRequirements: Array<RequirementInfo>;
  // Only for effect-based mutations (godseed).
  effectRequirements: Array<EffectRequirementInfo>;
}

export interface DesignerContextType {
  mode: DesignerMode;
  setMode: (mode: DesignerMode) => void;
  
  inputPlacements: DesignerPlacement[];
  targetPlacements: DesignerPlacement[];
  groundTiles: GroundTile[];
  selectedGround: GroundType | null;
  setSelectedGround: (ground: GroundType | null) => void;
  paintGround: (position: [number, number], ground: GroundType) => void;
  removeGround: (position: [number, number]) => void;
  clearGroundTiles: () => void;
  replaceGroundTiles: (tiles: GroundTile[]) => void;
  
  addPlacement: (placement: Omit<DesignerPlacement, "id">) => { success: boolean; error?: string };
  removePlacement: (id: string) => void;
  movePlacement: (id: string, newPosition: [number, number]) => { success: boolean; error?: string };
  clearInputPlacements: () => void;
  clearTargetPlacements: () => void;
  clearAllPlacements: () => void;
  /** Nudge, rotate or mirror the whole layout (inputs, targets and ground). */
  transformLayout: (transform: LayoutTransform) => { success: boolean; error?: string; droppedGround?: number };

  // Undo/redo over inputs, targets and ground.
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Groups every change until `endEdit` into one undo step (a paint or drag stroke). */
  beginEdit: () => void;
  endEdit: () => void;
  
  isPositionOccupied: (position: [number, number], size: number, excludeId?: string) => boolean;
  isValidPlacement: (position: [number, number], size: number, excludeId?: string) => { valid: boolean; error?: string };
  isValidPlacementPosition: (position: [number, number], size: number) => { valid: boolean; error?: string };
  getPlacementAt: (row: number, col: number) => DesignerPlacement | undefined;
  
  selectedCropForPlacement: SelectedCropForDesigner | null;
  setSelectedCropForPlacement: (crop: SelectedCropForDesigner | null) => void;
  isPlacementMode: boolean;
  
  // Hovered target, for showing its validation.
  hoveredTargetId: string | null;
  setHoveredTargetId: (id: string | null) => void;

  // Hovered input, for showing its effects.
  hoveredInputId: string | null;
  setHoveredInputId: (id: string | null) => void;

  // Effects propagated over the current inputs and targets.
  effectSimulation: EffectSimulation;
  
  loadFromSolverResult: (
    crops: Array<{ id: string; name: string; position: [number, number]; size: number }>,
    mutations: Array<{ id: string; name: string; position: [number, number]; size: number }>,
    groundTiles?: GroundTile[]
  ) => void;
  
  allPlacements: DesignerPlacement[];
  
  getPossibleMutations: (
    mutations: MutationDefinition[]
  ) => Array<{ mutation: MutationDefinition; positions: [number, number][] }>;
  
  getTargetValidation: (
    targetId: string,
    mutations: MutationDefinition[]
  ) => MutationValidationInfo;
}

export const DesignerContext = createContext<DesignerContextType | null>(null);

export const useDesigner = (): DesignerContextType => {
  const context = useContext(DesignerContext);
  if (!context) {
    throw new Error("useDesigner must be used within a DesignerProvider");
  }
  return context;
};
