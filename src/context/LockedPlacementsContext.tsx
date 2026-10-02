import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { LockedPlacement, SelectedCropForPlacement, LockDefinition } from "../types/greenhouse";
import { useGridState } from "./GridStateContext";
import { useToast } from "../components/ui/toastContext";
import {
  isPositionOccupiedByPlacements,
  findOverlappingPlacements,
  getPlacementAtCell,
  validateGridBounds,
  validateAllowedCells,
  generatePlacementId,
  LocalStorageManager,
} from "../utilities";

interface LockedPlacementsContextType {
  lockedPlacements: LockedPlacement[];
  
  addLockedPlacement: (placement: Omit<LockedPlacement, "id">) => { success: boolean; error?: string };
  removeLockedPlacement: (id: string) => void;
  moveLockedPlacement: (id: string, newPosition: [number, number]) => { success: boolean; error?: string };
  clearLockedPlacements: () => void;
  
  isPositionOccupied: (position: [number, number], size: number, excludeId?: string) => boolean;
  isValidPlacement: (position: [number, number], size: number, excludeId?: string) => { valid: boolean; error?: string };
  isValidPlacementPosition: (position: [number, number], size: number) => { valid: boolean; error?: string };
  getLockedPlacementAt: (row: number, col: number) => LockedPlacement | undefined;
  
  getLocksForAPI: () => LockDefinition[];
  
  selectedCropForPlacement: SelectedCropForPlacement | null;
  setSelectedCropForPlacement: (crop: SelectedCropForPlacement | null) => void;
  isPlacementMode: boolean;
  
  priorities: Record<string, number>;
  setPriority: (cropId: string, priority: number) => void;
  getPriority: (cropId: string) => number;
  isLoadingPriorities: boolean;
  defaultPriorities: Record<string, number>;
}

const LockedPlacementsContext = createContext<LockedPlacementsContextType | null>(null);

export const LockedPlacementsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { unlockedCells } = useGridState();
  const { toast } = useToast();
  const [lockedPlacements, setLockedPlacements] = useState<LockedPlacement[]>(() => {
    const saved = LocalStorageManager.loadLockedPlacements();
    return saved || [];
  });
  const [selectedCropForPlacement, setSelectedCropForPlacement] = useState<SelectedCropForPlacement | null>(null);
  const [priorities, setPriorities] = useState<Record<string, number>>(() => {
    const saved = LocalStorageManager.loadPriorities();
    return saved || {};
  });
  const [isLoadingPriorities, setIsLoadingPriorities] = useState(true);
  const [defaultPriorities, setDefaultPriorities] = useState<Record<string, number>>({});
  const isInitialLockedMount = useRef(true);
  
  useEffect(() => {
    const loadDefaultPriorities = async () => {
      try {
        const response = await fetch("/greenhouse/default_priorities.json");
        if (!response.ok) {
          throw new Error(`Failed to load default priorities: ${response.statusText}`);
        }
        const defaultPrioritiesData = await response.json();
        setDefaultPriorities(defaultPrioritiesData);
      } catch (err) {
        console.error("Error loading default priorities:", err);
        toast({
          title: "Warning",
          description: "Failed to load default crop priorities. Using empty priorities.",
          variant: "warning",
          duration: 5000,
        });
      } finally {
        setIsLoadingPriorities(false);
      }
    };
    
    loadDefaultPriorities();
  }, [toast]);
  
  useEffect(() => {
    if (isInitialLockedMount.current) {
      const saved = LocalStorageManager.loadLockedPlacements();
      isInitialLockedMount.current = false;
      if (!saved || saved.length === 0) {
        return; // don't write an empty list on mount
      }
    }
    LocalStorageManager.saveLockedPlacements(lockedPlacements);
  }, [lockedPlacements]);
  
  // Persist custom priorities once defaults have loaded; none clears the key.
  useEffect(() => {
    if (!isLoadingPriorities) {
      if (Object.keys(priorities).length > 0) {
        LocalStorageManager.savePriorities(priorities);
      } else {
        LocalStorageManager.clearPriorities();
      }
    }
  }, [priorities, isLoadingPriorities]);
  
  const prevUnlockedCellsRef = useRef<Set<string>>(unlockedCells);
  
  // Drop locked placements whose cells were locked, with a toast.
  useEffect(() => {
    if (prevUnlockedCellsRef.current === unlockedCells) {
      return;
    }
    prevUnlockedCellsRef.current = unlockedCells;
    
    const invalidPlacements: LockedPlacement[] = [];
    
    for (const placement of lockedPlacements) {
      const [row, col] = placement.position;
      const size = placement.size;
      
      let isValid = true;
      for (let dr = 0; dr < size; dr++) {
        for (let dc = 0; dc < size; dc++) {
          const cellKey = `${row + dr},${col + dc}`;
          if (!unlockedCells.has(cellKey)) {
            isValid = false;
            break;
          }
        }
        if (!isValid) break;
      }
      
      if (!isValid) {
        invalidPlacements.push(placement);
      }
    }
    
    if (invalidPlacements.length > 0) {
      setLockedPlacements(prev => 
        prev.filter(p => !invalidPlacements.some(inv => inv.id === p.id))
      );
      
      if (invalidPlacements.length === 1) {
        toast({
          title: "Locked placement removed",
          description: `The locked placement for "${invalidPlacements[0].crop}" was removed because the grid cells were locked.`,
          variant: "warning",
          duration: 5000,
        });
      } else {
        toast({
          title: "Locked placements removed",
          description: `${invalidPlacements.length} locked placements were removed because the grid cells were locked.`,
          variant: "warning",
          duration: 5000,
        });
      }
    }
  }, [unlockedCells, lockedPlacements, toast]);
  
  const isPositionOccupied = useCallback((
    position: [number, number],
    size: number,
    excludeId?: string
  ): boolean => {
    return isPositionOccupiedByPlacements(position, size, lockedPlacements, excludeId);
  }, [lockedPlacements]);
  
  // Bounds and unlocked cells only; no overlap check.
  const isValidPlacementPosition = useCallback((
    position: [number, number],
    size: number
  ): { valid: boolean; error?: string } => {
    const boundsValidation = validateGridBounds(position, size);
    if (!boundsValidation.valid) {
      return boundsValidation;
    }
    
    return validateAllowedCells(position, size, unlockedCells);
  }, [unlockedCells]);
  
  // Bounds, unlocked cells and overlap (used when moving).
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
      return { valid: false, error: "Position is occupied by another locked placement" };
    }
    
    return { valid: true };
  }, [isValidPlacementPosition, isPositionOccupied]);
  
  const getOverlappingPlacements = useCallback((
    position: [number, number],
    size: number,
    excludeId?: string
  ): LockedPlacement[] => {
    return findOverlappingPlacements(position, size, lockedPlacements, excludeId);
  }, [lockedPlacements]);
  
  // Replaces any overlapping locked placements.
  const addLockedPlacement = useCallback((
    placement: Omit<LockedPlacement, "id">
  ): { success: boolean; error?: string } => {
    const validation = isValidPlacementPosition(placement.position, placement.size);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    const newPlacement: LockedPlacement = {
      ...placement,
      id: generatePlacementId("placement"),
    };
    
    const overlapping = getOverlappingPlacements(placement.position, placement.size);
    const overlappingIds = new Set(overlapping.map(p => p.id));
    
    setLockedPlacements(prev => [
      ...prev.filter(p => !overlappingIds.has(p.id)),
      newPlacement,
    ]);
    
    return { success: true };
  }, [isValidPlacementPosition, getOverlappingPlacements]);
  
  const removeLockedPlacement = useCallback((id: string) => {
    setLockedPlacements(prev => prev.filter(p => p.id !== id));
  }, []);
  
  const moveLockedPlacement = useCallback((
    id: string,
    newPosition: [number, number]
  ): { success: boolean; error?: string } => {
    const placement = lockedPlacements.find(p => p.id === id);
    if (!placement) {
      return { success: false, error: "Placement not found" };
    }
    
    const validation = isValidPlacement(newPosition, placement.size, id);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    setLockedPlacements(prev =>
      prev.map(p =>
        p.id === id ? { ...p, position: newPosition } : p
      )
    );
    return { success: true };
  }, [lockedPlacements, isValidPlacement]);
  
  const clearLockedPlacements = useCallback(() => {
    setLockedPlacements([]);
  }, []);
  
  const getLockedPlacementAt = useCallback((
    row: number,
    col: number
  ): LockedPlacement | undefined => {
    return getPlacementAtCell(row, col, lockedPlacements);
  }, [lockedPlacements]);
  
  const getLocksForAPI = useCallback((): LockDefinition[] => {
    return lockedPlacements.map(p => ({
      name: p.crop,
      size: p.size,
      position: p.position,
    }));
  }, [lockedPlacements]);
  
  const setPriority = useCallback((cropId: string, priority: number) => {
    setPriorities(prev => {
      const defaultValue = defaultPriorities[cropId] || 0;
      
      if (priority === defaultValue) {
        // Only values that differ from the default are stored.
        const { [cropId]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      }
      return { ...prev, [cropId]: priority };
    });
  }, [defaultPriorities]);
  
  const getPriority = useCallback((cropId: string): number => {
    if (cropId in priorities) {
      return priorities[cropId];
    }
    return defaultPriorities[cropId] || 0;
  }, [priorities, defaultPriorities]);
  
  const value: LockedPlacementsContextType = {
    lockedPlacements,
    addLockedPlacement,
    removeLockedPlacement,
    moveLockedPlacement,
    clearLockedPlacements,
    isPositionOccupied,
    isValidPlacement,
    isValidPlacementPosition,
    getLockedPlacementAt,
    getLocksForAPI,
    selectedCropForPlacement,
    setSelectedCropForPlacement,
    isPlacementMode: selectedCropForPlacement !== null,
    priorities,
    setPriority,
    getPriority,
    isLoadingPriorities,
    defaultPriorities,
  };
  
  return (
    <LockedPlacementsContext.Provider value={value}>
      {children}
    </LockedPlacementsContext.Provider>
  );
};

export const useLockedPlacements = (): LockedPlacementsContextType => {
  const context = useContext(LockedPlacementsContext);
  if (!context) {
    throw new Error("useLockedPlacements must be used within a LockedPlacementsProvider");
  }
  return context;
};
