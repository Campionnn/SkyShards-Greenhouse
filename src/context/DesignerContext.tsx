import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { MutationDefinition } from "../types/greenhouse";
import {
  isPositionOccupiedByPlacements,
  findOverlappingPlacements,
  doPlacementsOverlapByPlacement,
  getPlacementAtCell,
  validateGridBounds,
  generatePlacementId,
  LocalStorageManager,
  simulateEffects,
  SPECIAL_EFFECT_SETS,
  transformLayout as applyLayoutTransform,
  createEditRecorder,
  emptyHistory,
  invertTransform,
  recordEdit,
  redoStep,
  undoStep,
} from "../utilities";
import type { LayoutHistory, LayoutSnapshot, LayoutTransform } from "../utilities";
import { GROUND_TYPES, type GroundTile, type GroundType } from "../utilities/designEncoding";
import {
  DesignerContext,
  type DesignerContextType,
  type DesignerPlacement,
  type EffectRequirementInfo,
  type MutationValidationInfo,
  type RequirementInfo,
  type SelectedCropForDesigner,
  type DesignerMode,
} from "./designerContextValue";

// The context object, types and `useDesigner` live in designerContextValue.ts so
// this file exports only a component, as React Fast Refresh requires.
export type {
  DesignerContextType,
  DesignerMode,
  DesignerPlacement,
  EffectRequirementInfo,
  MutationValidationInfo,
  RequirementInfo,
  SelectedCropForDesigner,
} from "./designerContextValue";

function resolveOverlaps(
  inputs: DesignerPlacement[],
  targets: DesignerPlacement[]
): { inputs: DesignerPlacement[]; targets: DesignerPlacement[] } {
  const keptInputs: DesignerPlacement[] = [];
  for (const placement of inputs) {
    if (!keptInputs.some(kept => doPlacementsOverlapByPlacement(kept, placement))) {
      keptInputs.push(placement);
    }
  }

  const keptTargets: DesignerPlacement[] = [];
  for (const placement of targets) {
    const clashes =
      keptInputs.some(kept => doPlacementsOverlapByPlacement(kept, placement)) ||
      keptTargets.some(kept => doPlacementsOverlapByPlacement(kept, placement));
    if (!clashes) {
      keptTargets.push(placement);
    }
  }

  return { inputs: keptInputs, targets: keptTargets };
}

function normalizeGroundTiles(tiles: GroundTile[], placements: DesignerPlacement[]): GroundTile[] {
  const unique = new Map<string, GroundTile>();
  for (const tile of tiles) {
    const [row, col] = tile.position;
    if (!GROUND_TYPES.includes(tile.ground) || !Number.isInteger(row) || !Number.isInteger(col) ||
        row < 0 || row >= 10 || col < 0 || col >= 10 || getPlacementAtCell(row, col, placements)) continue;
    unique.set(`${row},${col}`, { ground: tile.ground, position: [row, col] });
  }
  return [...unique.values()];
}

interface DesignerProviderProps {
  children: React.ReactNode;
  /** Starting placements; when omitted, the saved layout is restored from localStorage. */
  initialPlacements?: { inputs: DesignerPlacement[]; targets: DesignerPlacement[]; groundTiles?: GroundTile[] };
  /** Save to and restore from localStorage (Designer page); off for embedded editors. */
  persist?: boolean;
  /**
   * Called on every placement change after mount. `transform` is set for a
   * whole-layout nudge/rotate/mirror so the owner can move cell-keyed data
   * (e.g. the simulator's watched targets).
   */
  onChange?: (inputs: DesignerPlacement[], targets: DesignerPlacement[], groundTiles: GroundTile[], transform?: LayoutTransform) => void;
}

export const DesignerProvider: React.FC<DesignerProviderProps> = ({ children, initialPlacements, persist = true, onChange }) => {
  const [mode, setMode] = useState<DesignerMode>("inputs");
  // Both lists are loaded together so overlaps between them can be resolved.
  const [savedPlacements] = useState(() => initialPlacements
    ? resolveOverlaps(initialPlacements.inputs, initialPlacements.targets)
    : resolveOverlaps(
        (persist && LocalStorageManager.loadDesignerInputs()) || [],
        (persist && LocalStorageManager.loadDesignerTargets()) || []
      ));
  const [inputPlacements, setInputPlacements] = useState<DesignerPlacement[]>(savedPlacements.inputs);
  const [targetPlacements, setTargetPlacements] = useState<DesignerPlacement[]>(savedPlacements.targets);
  const [groundTiles, setGroundTiles] = useState<GroundTile[]>(() => normalizeGroundTiles(
    initialPlacements?.groundTiles ?? ((persist && LocalStorageManager.loadDesignerGroundTiles()) || []),
    [...savedPlacements.inputs, ...savedPlacements.targets]
  ));
  const [selectedGround, setSelectedGroundState] = useState<GroundType | null>(null);
  const [selectedCropForPlacement, setSelectedCropState] = useState<SelectedCropForDesigner | null>(null);
  const setSelectedGround = useCallback((ground: GroundType | null) => {
    setSelectedGroundState(ground);
    if (ground) setSelectedCropState(null);
  }, []);
  const setSelectedCropForPlacement = useCallback((crop: SelectedCropForDesigner | null) => {
    setSelectedCropState(crop);
    if (crop) setSelectedGroundState(null);
  }, []);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [hoveredInputId, setHoveredInputId] = useState<string | null>(null);
  const isInitialInputsMount = useRef(true);
  const isInitialTargetsMount = useRef(true);
  
  useEffect(() => {
    if (!persist) return;
    if (isInitialInputsMount.current) {
      const saved = LocalStorageManager.loadDesignerInputs();
      isInitialInputsMount.current = false;
      if (!saved || saved.length === 0) {
        return; // don't write an empty list on mount
      }
    }
    LocalStorageManager.saveDesignerInputs(inputPlacements);
  }, [inputPlacements, persist]);
  
  useEffect(() => {
    if (!persist) return;
    if (isInitialTargetsMount.current) {
      const saved = LocalStorageManager.loadDesignerTargets();
      isInitialTargetsMount.current = false;
      if (!saved || saved.length === 0) {
        return; // don't write an empty list on mount
      }
    }
    LocalStorageManager.saveDesignerTargets(targetPlacements);
  }, [targetPlacements, persist]);

  useEffect(() => {
    if (persist) LocalStorageManager.saveDesignerGroundTiles(groundTiles);
  }, [groundTiles, persist]);

  // ---- Edits and undo / redo -------------------------------------------------
  // `layoutRef` is the source of truth: each edit reads the latest layout from
  // it and writes back synchronously, then mirrors it into React state. A fast
  // drag fires several edits per render, so render-time state would lose cells.
  // History is recorded in the same call, so one stroke is one undo step.
  const layoutRef = useRef<LayoutSnapshot<DesignerPlacement>>({ inputs: inputPlacements, targets: targetPlacements, groundTiles });
  const [history, setHistory] = useState<LayoutHistory<DesignerPlacement>>(emptyHistory);
  const historyRef = useRef(history);
  const strokeRef = useRef<number | null>(null);
  const editCounterRef = useRef(0);
  const [recorder] = useState(() => createEditRecorder<DesignerPlacement>((entry) => {
    historyRef.current = recordEdit(historyRef.current, entry);
    setHistory(historyRef.current);
  }));
  const beginEdit = useCallback(() => {
    strokeRef.current = ++editCounterRef.current;
  }, []);
  const endEdit = useCallback(() => {
    strokeRef.current = null;
  }, []);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pendingTransformRef = useRef<LayoutTransform | undefined>(undefined);

  /** Shows a layout, updating only the lists that changed. */
  const show = useCallback((next: LayoutSnapshot<DesignerPlacement>) => {
    const prev = layoutRef.current;
    layoutRef.current = next;
    if (next.inputs !== prev.inputs) setInputPlacements(next.inputs);
    if (next.targets !== prev.targets) setTargetPlacements(next.targets);
    if (next.groundTiles !== prev.groundTiles) setGroundTiles(next.groundTiles);
  }, []);

  /** Applies one edit; `fn` returns the next layout or null for no-op. Edits in a stroke share an undo step. */
  const apply = useCallback((
    fn: (layout: LayoutSnapshot<DesignerPlacement>) => LayoutSnapshot<DesignerPlacement> | null,
    transform?: LayoutTransform
  ): boolean => {
    const before = layoutRef.current;
    const next = fn(before);
    if (!next) return false;
    recorder.touch(strokeRef.current ?? ++editCounterRef.current, before, transform);
    if (transform) pendingTransformRef.current = transform;
    show(next);
    recorder.commit(next);
    return true;
  }, [recorder, show]);

  // Report changes after mount to the embedding owner.
  const isInitialChangeMount = useRef(true);
  useEffect(() => {
    if (isInitialChangeMount.current) {
      isInitialChangeMount.current = false;
      return;
    }
    const transform = pendingTransformRef.current;
    pendingTransformRef.current = undefined;
    onChangeRef.current?.(inputPlacements, targetPlacements, groundTiles, transform);
  }, [inputPlacements, targetPlacements, groundTiles]);

  const restore = useCallback((snapshot: LayoutSnapshot<DesignerPlacement>, transform: LayoutTransform | undefined) => {
    pendingTransformRef.current = transform;
    show(snapshot);
    setHoveredTargetId(null);
    setHoveredInputId(null);
  }, [show]);

  const undo = useCallback((): boolean => {
    recorder.close(layoutRef.current);
    const step = undoStep(historyRef.current, layoutRef.current);
    if (!step) return false;
    historyRef.current = step.history;
    setHistory(step.history);
    // Report the inverse transform so cell-keyed owner data follows.
    restore(step.entry.snapshot, step.entry.transform && invertTransform(step.entry.transform));
    return true;
  }, [recorder, restore]);

  const redo = useCallback((): boolean => {
    recorder.close(layoutRef.current);
    const step = redoStep(historyRef.current, layoutRef.current);
    if (!step) return false;
    historyRef.current = step.history;
    setHistory(step.history);
    restore(step.entry.snapshot, step.entry.transform);
    return true;
  }, [recorder, restore]);

  const paintGround = useCallback((position: [number, number], ground: GroundType) => {
    const [row, col] = position;
    apply(l => {
      if (!GROUND_TYPES.includes(ground) || row < 0 || row >= 10 || col < 0 || col >= 10 ||
          getPlacementAtCell(row, col, [...l.inputs, ...l.targets])) return null;
      if (l.groundTiles.some(t => t.position[0] === row && t.position[1] === col && t.ground === ground)) return null;
      const other = l.groundTiles.filter(t => t.position[0] !== row || t.position[1] !== col);
      return { ...l, groundTiles: [...other, { ground, position: [row, col] }] };
    });
  }, [apply]);

  const removeGround = useCallback((position: [number, number]) => {
    apply(l => {
      const kept = l.groundTiles.filter(t => t.position[0] !== position[0] || t.position[1] !== position[1]);
      return kept.length === l.groundTiles.length ? null : { ...l, groundTiles: kept };
    });
  }, [apply]);
  const clearGroundTiles = useCallback(() => {
    apply(l => (l.groundTiles.length ? { ...l, groundTiles: [] } : null));
  }, [apply]);
  const replaceGroundTiles = useCallback((tiles: GroundTile[]) => {
    apply(l => ({ ...l, groundTiles: normalizeGroundTiles(tiles, [...l.inputs, ...l.targets]) }));
  }, [apply]);

  const allPlacements = useMemo(() => {
    return [...inputPlacements, ...targetPlacements];
  }, [inputPlacements, targetPlacements]);

  // Inputs are plants that give buffs; targets are slots that only receive (as in the solver).
  const effectSimulation = useMemo(() => {
    return simulateEffects([
      ...inputPlacements.map(p => ({ id: p.cropId, position: p.position, size: p.size })),
      ...targetPlacements.map(p => ({ id: p.cropId, position: p.position, size: p.size, isSlot: true })),
    ]);
  }, [inputPlacements, targetPlacements]);
  
  const isPositionOccupied = useCallback((
    position: [number, number],
    size: number,
    excludeId?: string
  ): boolean => {
    return isPositionOccupiedByPlacements(position, size, allPlacements, excludeId);
  }, [allPlacements]);
  
  // Bounds only: every designer cell counts as unlocked.
  const isValidPlacementPosition = useCallback((
    position: [number, number],
    size: number
  ): { valid: boolean; error?: string } => {
    return validateGridBounds(position, size);
  }, []);
  
  const isValidPlacement = useCallback((
    position: [number, number],
    size: number,
    excludeId?: string
  ): { valid: boolean; error?: string } => {
    const positionValidation = isValidPlacementPosition(position, size);
    if (!positionValidation.valid) {
      return positionValidation;
    }
    
    if (isPositionOccupied(position, size, excludeId)) {
      return { valid: false, error: "Position is occupied by another placement" };
    }
    
    return { valid: true };
  }, [isValidPlacementPosition, isPositionOccupied]);
  
  const addPlacement = useCallback((
    placement: Omit<DesignerPlacement, "id">
  ): { success: boolean; error?: string } => {
    const validation = isValidPlacementPosition(placement.position, placement.size);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    const newPlacement: DesignerPlacement = {
      ...placement,
      id: generatePlacementId("designer"),
    };
    const [row, col] = placement.position;
    const size = placement.size;
    
    apply(l => {
      // Painting over existing placements replaces them.
      const overlappingIds = new Set(findOverlappingPlacements(placement.position, size, [...l.inputs, ...l.targets]).map(p => p.id));
      const dropOverlapping = (list: DesignerPlacement[]) => {
        const next = list.filter(p => !overlappingIds.has(p.id));
        return next.length === list.length ? list : next;
      };
      let inputs = dropOverlapping(l.inputs);
      let targets = dropOverlapping(l.targets);
      if (mode === "inputs") inputs = [...inputs, newPlacement];
      else targets = [...targets, newPlacement];
      // A placement replaces ground tiles under its footprint.
      const ground = l.groundTiles.filter(t =>
        t.position[0] < row || t.position[0] >= row + size || t.position[1] < col || t.position[1] >= col + size
      );
      return { inputs, targets, groundTiles: ground.length === l.groundTiles.length ? l.groundTiles : ground };
    });
    
    return { success: true };
  }, [isValidPlacementPosition, apply, mode]);
  
  const removePlacement = useCallback((id: string) => {
    apply(l => {
      const inputs = l.inputs.filter(p => p.id !== id);
      const targets = l.targets.filter(p => p.id !== id);
      if (inputs.length === l.inputs.length && targets.length === l.targets.length) return null;
      return {
        ...l,
        inputs: inputs.length === l.inputs.length ? l.inputs : inputs,
        targets: targets.length === l.targets.length ? l.targets : targets,
      };
    });
  }, [apply]);
  
  const movePlacement = useCallback((
    id: string,
    newPosition: [number, number]
  ): { success: boolean; error?: string } => {
    const l = layoutRef.current;
    const all = [...l.inputs, ...l.targets];
    const placement = all.find(p => p.id === id);
    if (!placement) {
      return { success: false, error: "Placement not found" };
    }
    
    const positionValidation = validateGridBounds(newPosition, placement.size);
    if (!positionValidation.valid) {
      return { success: false, error: positionValidation.error };
    }
    if (isPositionOccupiedByPlacements(newPosition, placement.size, all, id)) {
      return { success: false, error: "Position is occupied by another placement" };
    }
    
    const size = placement.size;
    const moveIn = (list: DesignerPlacement[]) =>
      list.some(p => p.id === id) ? list.map(p => p.id === id ? { ...p, position: newPosition } : p) : list;
    apply(cur => ({
      inputs: moveIn(cur.inputs),
      targets: moveIn(cur.targets),
      groundTiles: cur.groundTiles.filter(t =>
        t.position[0] < newPosition[0] || t.position[0] >= newPosition[0] + size ||
        t.position[1] < newPosition[1] || t.position[1] >= newPosition[1] + size
      ),
    }));
    return { success: true };
  }, [apply]);
  
  const clearInputPlacements = useCallback(() => {
    apply(l => (l.inputs.length ? { ...l, inputs: [] } : null));
  }, [apply]);
  
  const clearTargetPlacements = useCallback(() => {
    apply(l => (l.targets.length ? { ...l, targets: [] } : null));
  }, [apply]);
  
  const clearAllPlacements = useCallback(() => {
    apply(l => (l.inputs.length || l.targets.length || l.groundTiles.length ? { inputs: [], targets: [], groundTiles: [] } : null));
  }, [apply]);

  const transformLayout = useCallback((transform: LayoutTransform): { success: boolean; error?: string; droppedGround?: number } => {
    const l = layoutRef.current;
    if (l.inputs.length === 0 && l.targets.length === 0 && l.groundTiles.length === 0) {
      return { success: false, error: "The layout is empty" };
    }
    const next = applyLayoutTransform(l, transform);
    if (!next) {
      return { success: false, error: "Something would move off the grid" };
    }
    apply(() => ({
      inputs: next.inputs,
      targets: next.targets,
      groundTiles: normalizeGroundTiles(next.groundTiles, [...next.inputs, ...next.targets]),
    }), transform);
    return { success: true, droppedGround: next.droppedGround };
  }, [apply]);
  
  const getPlacementAt = useCallback((
    row: number,
    col: number
  ): DesignerPlacement | undefined => {
    // Reads layoutRef so a fast erase stroke finds pieces not yet rendered.
    const l = layoutRef.current;
    return getPlacementAtCell(row, col, [...l.inputs, ...l.targets]);
  }, [allPlacements]); // eslint-disable-line react-hooks/exhaustive-deps -- new identity whenever the layout renders
  
  const loadFromSolverResult = useCallback((
    crops: Array<{ id: string; name: string; position: [number, number]; size: number }>,
    mutations: Array<{ id: string; name: string; position: [number, number]; size: number }>,
    tiles: GroundTile[] = []
  ) => {
    const newInputs: DesignerPlacement[] = crops.map(crop => ({
      id: generatePlacementId("designer"),
      cropId: crop.id,
      cropName: crop.name,
      size: crop.size,
      position: crop.position,
      isMutation: false,
    }));
    
    const newTargets: DesignerPlacement[] = mutations.map(mutation => ({
      id: generatePlacementId("designer"),
      cropId: mutation.id,
      cropName: mutation.name,
      size: mutation.size,
      position: mutation.position,
      isMutation: true,
    }));
    
    const resolved = resolveOverlaps(newInputs, newTargets);
    // Undoable.
    apply(() => ({
      inputs: resolved.inputs,
      targets: resolved.targets,
      groundTiles: normalizeGroundTiles(tiles, [...resolved.inputs, ...resolved.targets]),
    }));
    setSelectedGroundState(null);
    setSelectedCropState(null);
  }, [apply]);
  
  // Spots where each mutation's requirements are met by the current inputs.
  const getPossibleMutations = useCallback((
    mutations: MutationDefinition[]
  ): Array<{ mutation: MutationDefinition; positions: [number, number][] }> => {
    const results: Array<{ mutation: MutationDefinition; positions: [number, number][] }> = [];
    
    const cropAtCell = new Map<string, string>();
    for (const placement of inputPlacements) {
      const [row, col] = placement.position;
      for (let dr = 0; dr < placement.size; dr++) {
        for (let dc = 0; dc < placement.size; dc++) {
          cropAtCell.set(`${row + dr},${col + dc}`, placement.cropId);
        }
      }
    }
    
    for (const mutation of mutations) {
      const validPositions: [number, number][] = [];

      // Effect-based (godseed): the spot must hold every required effect and be free of input crops.
      if (SPECIAL_EFFECT_SETS[mutation.id]) {
        for (let row = 0; row <= 10 - mutation.size; row++) {
          for (let col = 0; col <= 10 - mutation.size; col++) {
            let coversInput = false;
            for (let dr = 0; dr < mutation.size && !coversInput; dr++) {
              for (let dc = 0; dc < mutation.size; dc++) {
                if (cropAtCell.has(`${row + dr},${col + dc}`)) { coversInput = true; break; }
              }
            }
            if (coversInput) continue;
            if (effectSimulation.isSpecialEligible(mutation.id, [row, col], mutation.size)) {
              validPositions.push([row, col]);
            }
          }
        }
        if (validPositions.length > 0) {
          results.push({ mutation, positions: validPositions });
        }
        continue;
      }

      for (let row = 0; row <= 10 - mutation.size; row++) {
        for (let col = 0; col <= 10 - mutation.size; col++) {
          const posValid = isValidPlacementPosition([row, col], mutation.size);
          if (!posValid.valid) continue;
          
          const adjacentCropCounts = new Map<string, Set<string>>();
          
          // Distinct neighbouring cells per crop, 8-way around the footprint.
          for (let dr = 0; dr < mutation.size; dr++) {
            for (let dc = 0; dc < mutation.size; dc++) {
              const cellRow = row + dr;
              const cellCol = col + dc;
              
              const neighbors = [
                [cellRow - 1, cellCol],
                [cellRow + 1, cellCol],
                [cellRow, cellCol - 1],
                [cellRow, cellCol + 1],
                [cellRow - 1, cellCol - 1],
                [cellRow - 1, cellCol + 1],
                [cellRow + 1, cellCol - 1],
                [cellRow + 1, cellCol + 1],
              ];
              
              for (const [nr, nc] of neighbors) {
                if (nr >= row && nr < row + mutation.size && 
                    nc >= col && nc < col + mutation.size) continue;
                
                const crop = cropAtCell.get(`${nr},${nc}`);
                if (crop) {
                  if (!adjacentCropCounts.has(crop)) {
                    adjacentCropCounts.set(crop, new Set());
                  }
                  adjacentCropCounts.get(crop)!.add(`${nr},${nc}`);
                }
              }
            }
          }
          
          const requirementsMet = mutation.requirements.every(req => {
            const cellsOfThisCrop = adjacentCropCounts.get(req.crop);
            return cellsOfThisCrop && cellsOfThisCrop.size >= req.count;
          });
          
          if (requirementsMet) {
            validPositions.push([row, col]);
          }
        }
      }
      
      if (validPositions.length > 0) {
        results.push({ mutation, positions: validPositions });
      }
    }
    
    return results;
  }, [inputPlacements, isValidPlacementPosition, effectSimulation]);
  
  // Which requirements of a target placement are met.
  const getTargetValidation = useCallback((
    targetId: string,
    mutations: MutationDefinition[]
  ): MutationValidationInfo => {
    const target = targetPlacements.find(t => t.id === targetId);
    if (!target) {
      return { isValid: false, missingRequirements: [], satisfiedRequirements: [], effectRequirements: [] };
    }

    const mutationDef = mutations.find(m => m.id === target.cropId);
    if (!mutationDef) {
      return { isValid: false, missingRequirements: [], satisfiedRequirements: [], effectRequirements: [] };
    }

    // Effect-based (godseed): checks held effects instead of crop counts.
    const requiredEffects = SPECIAL_EFFECT_SETS[mutationDef.id];
    if (requiredEffects) {
      const missing = new Set(
        effectSimulation.missingSpecialEffects(mutationDef.id, target.position, target.size)
      );
      const effectRequirements: EffectRequirementInfo[] = requiredEffects.map(effect => ({
        effect,
        satisfied: !missing.has(effect),
      }));
      return {
        isValid: missing.size === 0,
        missingRequirements: [],
        satisfiedRequirements: [],
        effectRequirements,
      };
    }
    
    const cropAtCell = new Map<string, string>();
    for (const placement of inputPlacements) {
      const [row, col] = placement.position;
      for (let dr = 0; dr < placement.size; dr++) {
        for (let dc = 0; dc < placement.size; dc++) {
          cropAtCell.set(`${row + dr},${col + dc}`, placement.cropId);
        }
      }
    }
    
    // Distinct neighbouring cells per crop, 8-way around the footprint.
    const [row, col] = target.position;
    const adjacentCropCounts = new Map<string, Set<string>>();
    
    for (let dr = 0; dr < target.size; dr++) {
      for (let dc = 0; dc < target.size; dc++) {
        const cellRow = row + dr;
        const cellCol = col + dc;

        const neighbors = [
          [cellRow - 1, cellCol],
          [cellRow + 1, cellCol],
          [cellRow, cellCol - 1],
          [cellRow, cellCol + 1],
          [cellRow - 1, cellCol - 1],
          [cellRow - 1, cellCol + 1],
          [cellRow + 1, cellCol - 1],
          [cellRow + 1, cellCol + 1],
        ];
        
        for (const [nr, nc] of neighbors) {
          if (nr >= row && nr < row + target.size &&
              nc >= col && nc < col + target.size) continue;
          
          const crop = cropAtCell.get(`${nr},${nc}`);
          if (crop) {
            if (!adjacentCropCounts.has(crop)) {
              adjacentCropCounts.set(crop, new Set());
            }
            adjacentCropCounts.get(crop)!.add(`${nr},${nc}`);
          }
        }
      }
    }
    
    const missingRequirements: Array<RequirementInfo> = [];
    const satisfiedRequirements: Array<RequirementInfo> = [];
    let isValid = true;
    
    for (const req of mutationDef.requirements) {
      const cellsOfThisCrop = adjacentCropCounts.get(req.crop);
      const have = cellsOfThisCrop ? cellsOfThisCrop.size : 0;
      const requirementInfo: RequirementInfo = {
        crop: req.crop,
        needed: req.count,
        have,
        satisfied: false,
      };
      
      if (have < req.count) {
        isValid = false;
        requirementInfo.satisfied = false;
        missingRequirements.push(requirementInfo);
      } else {
        requirementInfo.satisfied = true;
        satisfiedRequirements.push(requirementInfo);
      }
    }
    
    return { isValid, missingRequirements, satisfiedRequirements, effectRequirements: [] };
  }, [inputPlacements, targetPlacements, effectSimulation]);
  
  const value: DesignerContextType = {
    mode,
    setMode,
    inputPlacements,
    targetPlacements,
    groundTiles,
    selectedGround,
    setSelectedGround,
    paintGround,
    removeGround,
    clearGroundTiles,
    replaceGroundTiles,
    addPlacement,
    removePlacement,
    movePlacement,
    clearInputPlacements,
    clearTargetPlacements,
    clearAllPlacements,
    transformLayout,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    beginEdit,
    endEdit,
    isPositionOccupied,
    isValidPlacement,
    isValidPlacementPosition,
    getPlacementAt,
    selectedCropForPlacement,
    setSelectedCropForPlacement,
    isPlacementMode: selectedCropForPlacement !== null,
    hoveredTargetId,
    setHoveredTargetId,
    hoveredInputId,
    setHoveredInputId,
    effectSimulation,
    loadFromSolverResult,
    allPlacements,
    getPossibleMutations,
    getTargetValidation,
  };
  
  return (
    <DesignerContext.Provider value={value}>
      {children}
    </DesignerContext.Provider>
  );
};
