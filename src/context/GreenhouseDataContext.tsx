import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { CropDefinition, MutationDefinition, SelectedMutation } from "../types/greenhouse";
import greenhouseData from "../../public/greenhouse/data.json";
import defaultEffectWeights from "../../public/greenhouse/default_effect_weights.json";
import { LocalStorageManager } from "../utilities";

/** Solver defaults, and the only weights whose solutions the server caches. */
const DEFAULT_EFFECT_WEIGHTS: Record<string, number> = defaultEffectWeights;

interface GreenhouseDataContextType {
  crops: CropDefinition[];
  mutations: MutationDefinition[];
  isLoading: boolean;
  error: string | null;
  
  // mutations for solving
  selectedMutations: SelectedMutation[];
  addMutation: (id: string, name: string) => void;
  removeMutation: (id: string) => void;
  updateMutationMode: (id: string, mode: "maximize" | "target") => void;
  updateMutationTargetCount: (id: string, count: number) => void;
  clearSelectedMutations: () => void;
  
  // Effect weights for the solver (effect id -> weight in "spots"; 0 = ignored)
  effectWeights: Record<string, number>;
  setEffectWeight: (effectId: string, value: number) => void;
  resetEffectWeights: () => void;
  // Maximizing gloomgourd alone is about raw spawn rate, so the weights are
  // dropped for that solve unless the user keeps them.
  weightsOverridden: boolean;
  canOverrideWeights: boolean;
  setKeepWeights: (keep: boolean) => void;
  // What a solve should actually send.
  effectiveEffectWeights: Record<string, number>;
  
  // mutation definition
  getMutationDef: (id: string) => MutationDefinition | undefined;
  getCropDef: (id: string) => CropDefinition | undefined;
}

const GreenhouseDataContext = createContext<GreenhouseDataContextType | null>(null);

// Load data from JSON
function loadGreenhouseData() {
  const crops: CropDefinition[] = [];
  const mutations: MutationDefinition[] = [];

  // Convert crops object to array with IDs
  for (const [id, crop] of Object.entries(greenhouseData.crops)) {
    crops.push({
      id,
      name: crop.name,
      size: crop.size,
      priority: 0,
      ground: crop.ground,
      growth_stages: crop.growth_stages,
      positive_buffs: crop.positive_buffs,
      negative_buffs: crop.negative_buffs,
      isMutation: false,
    });
  }

  // Convert mutations object to array with IDs
  for (const [id, mutation] of Object.entries(greenhouseData.mutations)) {
    mutations.push({
      id,
      name: mutation.name,
      size: mutation.size,
      ground: mutation.ground,
      requirements: mutation.requirements,
      special: (mutation as any).special,
      rarity: mutation.rarity,
      growth_stages: mutation.growth_stages,
      positive_buffs: mutation.positive_buffs,
      negative_buffs: mutation.negative_buffs,
      drops: mutation.drops,
    });

    // Also add mutation as a crop option
    crops.push({
      id,
      name: mutation.name,
      size: mutation.size,
      priority: 0,
      ground: mutation.ground,
      growth_stages: mutation.growth_stages,
      positive_buffs: mutation.positive_buffs,
      negative_buffs: mutation.negative_buffs,
      isMutation: true,
    });
  }

  return { crops, mutations };
}

export const GreenhouseDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [crops, setCrops] = useState<CropDefinition[]>([]);
  const [mutations, setMutations] = useState<MutationDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedMutations, setSelectedMutations] = useState<SelectedMutation[]>(() => {
    // Try to load from localStorage
    const saved = LocalStorageManager.loadMutationTargets();
    return saved || [];
  });
  const isInitialMutationsMount = useRef(true);
  
  // Saved weights win; otherwise the defaults, which are also the only
  // weights whose solutions the server caches (see DEFAULT_EFFECT_WEIGHTS).
  const [effectWeights, setEffectWeightsState] = useState<Record<string, number>>(() => {
    return LocalStorageManager.loadEffectWeights() ?? { ...DEFAULT_EFFECT_WEIGHTS };
  });

  // Load data from JSON on mount
  useEffect(() => {
    try {
      const { crops: cropsData, mutations: mutationsData } = loadGreenhouseData();
      setCrops(cropsData);
      setMutations(mutationsData);
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load greenhouse data");
      setIsLoading(false);
    }
  }, []);
  
  // Save mutation targets to localStorage when they change (but not empty defaults)
  useEffect(() => {
    if (isInitialMutationsMount.current) {
      const saved = LocalStorageManager.loadMutationTargets();
      isInitialMutationsMount.current = false;
      if (!saved || saved.length === 0) {
        return; // Don't save empty array on initial mount
      }
    }
    LocalStorageManager.saveMutationTargets(selectedMutations);
  }, [selectedMutations]);
  
  const addMutation = useCallback((id: string, name: string) => {
    setSelectedMutations(prev => {
      if (prev.some(m => m.id === id)) return prev;
      return [...prev, { id, name, mode: "target", targetCount: 1 }];
    });
  }, []);
  
  const removeMutation = useCallback((id: string) => {
    setSelectedMutations(prev => prev.filter(m => m.id !== id));
  }, []);
  
  const updateMutationMode = useCallback((id: string, mode: "maximize" | "target") => {
    setSelectedMutations(prev =>
      prev.map(m => (m.id === id ? { ...m, mode } : m))
    );
  }, []);
  
  const updateMutationTargetCount = useCallback((id: string, count: number) => {
    setSelectedMutations(prev =>
      prev.map(m => (m.id === id ? { ...m, targetCount: count } : m))
    );
  }, []);
  
  const clearSelectedMutations = useCallback(() => {
    setSelectedMutations([]);
  }, []);
  
  const setEffectWeight = useCallback((effectId: string, value: number) => {
    setEffectWeightsState(prev => {
      const next = { ...prev };
      const clamped = Math.max(-100, Math.min(100, value));
      if (!Number.isFinite(clamped) || clamped === 0) {
        delete next[effectId];
      } else {
        next[effectId] = clamped;
      }
      LocalStorageManager.saveEffectWeights(next);
      return next;
    });
  }, []);

  const resetEffectWeights = useCallback(() => {
    setEffectWeightsState({ ...DEFAULT_EFFECT_WEIGHTS });
    LocalStorageManager.saveEffectWeights(DEFAULT_EFFECT_WEIGHTS);
  }, []);

  // Gloomgourd on its own: solve for spawn rate, unless the user says otherwise.
  const [keepWeights, setKeepWeights] = useState(false);
  const canOverrideWeights = useMemo(
    () =>
      selectedMutations.length === 1 &&
      selectedMutations[0].id === "gloomgourd" &&
      selectedMutations[0].mode === "maximize",
    [selectedMutations]
  );
  const weightsOverridden = canOverrideWeights && !keepWeights;
  const effectiveEffectWeights = useMemo(
    () => (weightsOverridden ? {} : effectWeights),
    [weightsOverridden, effectWeights]
  );
  
  const getMutationDef = useCallback((id: string): MutationDefinition | undefined => {
    return mutations.find(m => m.id === id);
  }, [mutations]);
  
  const getCropDef = useCallback((id: string): CropDefinition | undefined => {
    return crops.find(c => c.id === id);
  }, [crops]);
  
  const value: GreenhouseDataContextType = {
    crops,
    mutations,
    isLoading,
    error,
    selectedMutations,
    addMutation,
    removeMutation,
    updateMutationMode,
    updateMutationTargetCount,
    clearSelectedMutations,
    effectWeights,
    setEffectWeight,
    resetEffectWeights,
    weightsOverridden,
    canOverrideWeights,
    setKeepWeights,
    effectiveEffectWeights,
    getMutationDef,
    getCropDef,
  };
  
  return (
    <GreenhouseDataContext.Provider value={value}>
      {children}
    </GreenhouseDataContext.Provider>
  );
};

export const useGreenhouseData = (): GreenhouseDataContextType => {
  const context = useContext(GreenhouseDataContext);
  if (!context) {
    throw new Error("useGreenhouseData must be used within a GreenhouseDataProvider");
  }
  return context;
};
