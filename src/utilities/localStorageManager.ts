/**
 * Local Storage Manager for SkyShards
 * 
 * Provides a centralized utility for saving and loading application state to/from localStorage.
 * Handles grid configuration, priorities, designer state, locked placements, and mutation targets.
 */

import type { SelectedMutation } from "../types/greenhouse";
import type { LockedPlacement } from "../types/greenhouse";
import type { DesignerPlacement } from "../context";

// Storage keys
const STORAGE_KEYS = {
  GRID_CONFIG: "skyshards-grid-config",
  PRIORITIES: "skyshards-priorities",
  DESIGNER_INPUTS: "skyshards-designer-inputs",
  DESIGNER_TARGETS: "skyshards-designer-targets",
  LOCKED_PLACEMENTS: "skyshards-locked-placements",
  MUTATION_TARGETS: "skyshards-mutation-targets",
  EFFECT_WEIGHTS: "skyshards-effect-weights",
} as const;

// Type Definitions

interface GridConfigData {
  unlockedCells: string[]; // Array of "row,col" strings
}

interface PrioritiesData {
  priorities: Record<string, number>;
}

interface DesignerInputsData {
  placements: DesignerPlacement[];
}

interface DesignerTargetsData {
  placements: DesignerPlacement[];
}

interface LockedPlacementsData {
  placements: LockedPlacement[];
}

interface MutationTargetsData {
  targets: SelectedMutation[];
}

// LocalStorageManager Class

export class LocalStorageManager {
  /**
   * Generic method to save data to localStorage
   */
  private static save<T>(key: string, data: T): boolean {
    try {
      const serialized = JSON.stringify(data);
      localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      console.error(`Failed to save ${key} to localStorage:`, error);
      return false;
    }
  }

  /**
   * Generic method to load data from localStorage
   */
  private static load<T>(key: string): T | null {
    try {
      const serialized = localStorage.getItem(key);
      if (serialized === null) {
        return null;
      }
      return JSON.parse(serialized) as T;
    } catch (error) {
      console.error(`Failed to load ${key} from localStorage:`, error);
      return null;
    }
  }

  /**
   * Generic method to remove data from localStorage
   */
  private static remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove ${key} from localStorage:`, error);
    }
  }

  // Grid Configuration

  /**
   * Save grid configuration (unlocked cells)
   */
  static saveGridConfig(unlockedCells: Set<string>): boolean {
    const data: GridConfigData = {
      unlockedCells: Array.from(unlockedCells),
    };
    return this.save(STORAGE_KEYS.GRID_CONFIG, data);
  }

  /**
   * Load grid configuration (unlocked cells)
   */
  static loadGridConfig(): Set<string> | null {
    const data = this.load<GridConfigData>(STORAGE_KEYS.GRID_CONFIG);
    if (!data) return null;

    return new Set(data.unlockedCells);
  }

  /**
   * Clear grid configuration
   */
  static clearGridConfig(): void {
    this.remove(STORAGE_KEYS.GRID_CONFIG);
  }

  // Priorities

  /**
   * Save crop priorities
   */
  static savePriorities(priorities: Record<string, number>): boolean {
    const data: PrioritiesData = {
      priorities,
    };
    return this.save(STORAGE_KEYS.PRIORITIES, data);
  }

  /**
   * Load crop priorities
   */
  static loadPriorities(): Record<string, number> | null {
    const data = this.load<PrioritiesData>(STORAGE_KEYS.PRIORITIES);
    if (!data) return null;

    return data.priorities;
  }

  /**
   * Clear priorities
   */
  static clearPriorities(): void {
    this.remove(STORAGE_KEYS.PRIORITIES);
  }

  // Designer - Input Placements

  /**
   * Save designer input placements
   */
  static saveDesignerInputs(placements: DesignerPlacement[]): boolean {
    const data: DesignerInputsData = {
      placements,
    };
    return this.save(STORAGE_KEYS.DESIGNER_INPUTS, data);
  }

  /**
   * Load designer input placements
   */
  static loadDesignerInputs(): DesignerPlacement[] | null {
    const data = this.load<DesignerInputsData>(STORAGE_KEYS.DESIGNER_INPUTS);
    if (!data) return null;

    return data.placements;
  }

  /**
   * Clear designer input placements
   */
  static clearDesignerInputs(): void {
    this.remove(STORAGE_KEYS.DESIGNER_INPUTS);
  }

  // Designer - Target Placements

  /**
   * Save designer target placements
   */
  static saveDesignerTargets(placements: DesignerPlacement[]): boolean {
    const data: DesignerTargetsData = {
      placements,
    };
    return this.save(STORAGE_KEYS.DESIGNER_TARGETS, data);
  }

  /**
   * Load designer target placements
   */
  static loadDesignerTargets(): DesignerPlacement[] | null {
    const data = this.load<DesignerTargetsData>(STORAGE_KEYS.DESIGNER_TARGETS);
    if (!data) return null;

    return data.placements;
  }

  /**
   * Clear designer target placements
   */
  static clearDesignerTargets(): void {
    this.remove(STORAGE_KEYS.DESIGNER_TARGETS);
  }

  /**
   * Clear all designer placements (both inputs and targets)
   */
  static clearAllDesignerPlacements(): void {
    this.clearDesignerInputs();
    this.clearDesignerTargets();
  }

  // Locked Placements (Calculator)

  /**
   * Save locked placements
   */
  static saveLockedPlacements(placements: LockedPlacement[]): boolean {
    const data: LockedPlacementsData = {
      placements,
    };
    return this.save(STORAGE_KEYS.LOCKED_PLACEMENTS, data);
  }

  /**
   * Load locked placements
   */
  static loadLockedPlacements(): LockedPlacement[] | null {
    const data = this.load<LockedPlacementsData>(STORAGE_KEYS.LOCKED_PLACEMENTS);
    if (!data) return null;

    return data.placements;
  }

  /**
   * Clear locked placements
   */
  static clearLockedPlacements(): void {
    this.remove(STORAGE_KEYS.LOCKED_PLACEMENTS);
  }

  // Mutation Targets (Calculator)

  /**
   * Save mutation targets
   */
  static saveMutationTargets(targets: SelectedMutation[]): boolean {
    const data: MutationTargetsData = {
      targets,
    };
    return this.save(STORAGE_KEYS.MUTATION_TARGETS, data);
  }

  /**
   * Load mutation targets
   */
  static loadMutationTargets(): SelectedMutation[] | null {
    const data = this.load<MutationTargetsData>(STORAGE_KEYS.MUTATION_TARGETS);
    if (!data) return null;

    return data.targets;
  }

  /**
   * Clear mutation targets
   */
  static clearMutationTargets(): void {
    this.remove(STORAGE_KEYS.MUTATION_TARGETS);
  }

  // Effect Weights (Calculator)

  /**
   * Save the effect weights (effect id -> weight); zero weights are dropped
   */
  static saveEffectWeights(weights: Record<string, number>): boolean {
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(weights)) {
      if (typeof v === "number" && Number.isFinite(v) && v !== 0) cleaned[k] = v;
    }
    return this.save(STORAGE_KEYS.EFFECT_WEIGHTS, cleaned);
  }

  /**
   * Load the effect weights. Also drops the retired unique-crops key.
   */
  static loadEffectWeights(): Record<string, number> | null {
    try {
      localStorage.removeItem("skyshards-unique-crops");
    } catch {
      // ignore
    }
    const data = this.load<Record<string, number>>(STORAGE_KEYS.EFFECT_WEIGHTS);
    if (!data || typeof data !== "object") return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "number" && Number.isFinite(v) && v !== 0) out[k] = v;
    }
    return out;
  }

  /**
   * Clear the effect weights
   */
  static clearEffectWeights(): void {
    this.remove(STORAGE_KEYS.EFFECT_WEIGHTS);
  }

  // Utility Methods

  /**
   * Clear all saved data
   */
  static clearAll(): void {
    this.clearGridConfig();
    this.clearPriorities();
    this.clearDesignerInputs();
    this.clearDesignerTargets();
    this.clearLockedPlacements();
    this.clearMutationTargets();
    this.clearEffectWeights();
  }

  /**
   * Check if localStorage is available
   */
  static isAvailable(): boolean {
    try {
      const test = "__localStorage_test__";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get storage usage information (approximate)
   */
  static getStorageInfo(): { used: number; keys: string[] } {
    let used = 0;
    const keys: string[] = [];

    try {
      for (const key of Object.values(STORAGE_KEYS)) {
        const item = localStorage.getItem(key);
        if (item) {
          used += item.length;
          keys.push(key);
        }
      }
    } catch (error) {
      console.error("Failed to get storage info:", error);
    }

    return { used, keys };
  }
}
