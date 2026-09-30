import { createContext, useContext } from "react";
import type { MutationDefinition } from "../types/greenhouse";
import type { EffectSimulation, LayoutTransform } from "../utilities";
import type { GroundTile, GroundType } from "../utilities/designEncoding";

// The Designer context object, its types and the `useDesigner` hook. They live
// apart from DesignerProvider (DesignerContext.tsx) so that file exports only a
// component and React Fast Refresh can hot-reload it.

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

// Requirement info with satisfaction status
export interface RequirementInfo {
  crop: string;
  needed: number;
  have: number;
  satisfied: boolean;
}

// Effect requirement (godseed-style mutations: the spot must hold these effects)
export interface EffectRequirementInfo {
  effect: string;
  satisfied: boolean;
}

// Mutation validation result
export interface MutationValidationInfo {
  isValid: boolean;
  missingRequirements: Array<RequirementInfo>;
  satisfiedRequirements: Array<RequirementInfo>;
  // Only for mutations whose eligibility is an effect condition (godseed)
  effectRequirements: Array<EffectRequirementInfo>;
}

export interface DesignerContextType {
  // Mode
  mode: DesignerMode;
  setMode: (mode: DesignerMode) => void;
  
  // Placements
  inputPlacements: DesignerPlacement[];
  targetPlacements: DesignerPlacement[];
  groundTiles: GroundTile[];
  selectedGround: GroundType | null;
  setSelectedGround: (ground: GroundType | null) => void;
  paintGround: (position: [number, number], ground: GroundType) => void;
  removeGround: (position: [number, number]) => void;
  clearGroundTiles: () => void;
  replaceGroundTiles: (tiles: GroundTile[]) => void;
  
  // Actions
  addPlacement: (placement: Omit<DesignerPlacement, "id">) => { success: boolean; error?: string };
  removePlacement: (id: string) => void;
  movePlacement: (id: string, newPosition: [number, number]) => { success: boolean; error?: string };
  clearInputPlacements: () => void;
  clearTargetPlacements: () => void;
  clearAllPlacements: () => void;
  /** Nudge, rotate or mirror the whole layout (inputs, targets and ground). */
  transformLayout: (transform: LayoutTransform) => { success: boolean; error?: string; droppedGround?: number };

  // Undo / redo over the whole layout (inputs, targets and ground)
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Group every change until `endEdit` into one undo step (a paint or drag
   * stroke on the grid). Calls nest.
   */
  beginEdit: () => void;
  endEdit: () => void;
  
  // Validation helpers
  isPositionOccupied: (position: [number, number], size: number, excludeId?: string) => boolean;
  isValidPlacement: (position: [number, number], size: number, excludeId?: string) => { valid: boolean; error?: string };
  isValidPlacementPosition: (position: [number, number], size: number) => { valid: boolean; error?: string };
  getPlacementAt: (row: number, col: number) => DesignerPlacement | undefined;
  
  // Selection for placement
  selectedCropForPlacement: SelectedCropForDesigner | null;
  setSelectedCropForPlacement: (crop: SelectedCropForDesigner | null) => void;
  isPlacementMode: boolean;
  
  // Hovered target for showing validation info
  hoveredTargetId: string | null;
  setHoveredTargetId: (id: string | null) => void;

  // Hovered input crop (for showing its effects)
  hoveredInputId: string | null;
  setHoveredInputId: (id: string | null) => void;

  // Effect propagation over the current design (inputs + targets)
  effectSimulation: EffectSimulation;
  
  // Load from calculator results
  loadFromSolverResult: (
    crops: Array<{ id: string; name: string; position: [number, number]; size: number }>,
    mutations: Array<{ id: string; name: string; position: [number, number]; size: number }>,
    groundTiles?: GroundTile[]
  ) => void;
  
  // Get all placements for display
  allPlacements: DesignerPlacement[];
  
  // Mutation validation
  getPossibleMutations: (
    mutations: MutationDefinition[]
  ) => Array<{ mutation: MutationDefinition; positions: [number, number][] }>;
  
  // Get validation info for a target placement (for showing missing requirements)
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
