/** Typed JSON persistence of app state in localStorage. Failures are logged, not thrown. */

import type { SelectedMutation } from "../types/greenhouse";
import type { LockedPlacement } from "../types/greenhouse";
import type { DesignerPlacement } from "../context";
import type { Scenario } from "../simulator";
import type { GroundTile } from "./designEncoding";
import type { StoredSolverLayout } from "./layoutHandoff";

const STORAGE_KEYS = {
  GRID_CONFIG: "skyshards-grid-config",
  PRIORITIES: "skyshards-priorities",
  DESIGNER_INPUTS: "skyshards-designer-inputs",
  DESIGNER_TARGETS: "skyshards-designer-targets",
  DESIGNER_GROUND: "skyshards-designer-ground",
  LOCKED_PLACEMENTS: "skyshards-locked-placements",
  MUTATION_TARGETS: "skyshards-mutation-targets",
  EFFECT_WEIGHTS: "skyshards-effect-weights",
  SIMULATOR_SCENARIO: "skyshards-simulator-scenario",
  LAST_SOLVER_LAYOUT: "skyshards-last-solver-layout",
} as const;

interface GridConfigData {
  unlockedCells: string[]; // "row,col" keys
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

export class LocalStorageManager {
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

  private static remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Failed to remove ${key} from localStorage:`, error);
    }
  }

  static saveGridConfig(unlockedCells: Set<string>): boolean {
    const data: GridConfigData = {
      unlockedCells: Array.from(unlockedCells),
    };
    return this.save(STORAGE_KEYS.GRID_CONFIG, data);
  }

  static loadGridConfig(): Set<string> | null {
    const data = this.load<GridConfigData>(STORAGE_KEYS.GRID_CONFIG);
    if (!data) return null;

    return new Set(data.unlockedCells);
  }

  static clearGridConfig(): void {
    this.remove(STORAGE_KEYS.GRID_CONFIG);
  }

  static savePriorities(priorities: Record<string, number>): boolean {
    const data: PrioritiesData = {
      priorities,
    };
    return this.save(STORAGE_KEYS.PRIORITIES, data);
  }

  static loadPriorities(): Record<string, number> | null {
    const data = this.load<PrioritiesData>(STORAGE_KEYS.PRIORITIES);
    if (!data) return null;

    return data.priorities;
  }

  static clearPriorities(): void {
    this.remove(STORAGE_KEYS.PRIORITIES);
  }

  static saveDesignerInputs(placements: DesignerPlacement[]): boolean {
    const data: DesignerInputsData = {
      placements,
    };
    return this.save(STORAGE_KEYS.DESIGNER_INPUTS, data);
  }

  static loadDesignerInputs(): DesignerPlacement[] | null {
    const data = this.load<DesignerInputsData>(STORAGE_KEYS.DESIGNER_INPUTS);
    if (!data) return null;

    return data.placements;
  }

  static clearDesignerInputs(): void {
    this.remove(STORAGE_KEYS.DESIGNER_INPUTS);
  }

  static saveDesignerTargets(placements: DesignerPlacement[]): boolean {
    const data: DesignerTargetsData = {
      placements,
    };
    return this.save(STORAGE_KEYS.DESIGNER_TARGETS, data);
  }

  static loadDesignerTargets(): DesignerPlacement[] | null {
    const data = this.load<DesignerTargetsData>(STORAGE_KEYS.DESIGNER_TARGETS);
    if (!data) return null;

    return data.placements;
  }

  static clearDesignerTargets(): void {
    this.remove(STORAGE_KEYS.DESIGNER_TARGETS);
  }

  /** Clears designer inputs, targets and ground tiles. */
  static clearAllDesignerPlacements(): void {
    this.clearDesignerInputs();
    this.clearDesignerTargets();
    this.clearDesignerGroundTiles();
  }

  // Ground tiles painted on bare Designer cells.
  static saveDesignerGroundTiles(tiles: GroundTile[]): boolean {
    return this.save(STORAGE_KEYS.DESIGNER_GROUND, { tiles });
  }

  static loadDesignerGroundTiles(): GroundTile[] | null {
    const data = this.load<{ tiles: GroundTile[] }>(STORAGE_KEYS.DESIGNER_GROUND);
    return Array.isArray(data?.tiles) ? data.tiles : null;
  }

  static clearDesignerGroundTiles(): void {
    this.remove(STORAGE_KEYS.DESIGNER_GROUND);
  }

  static saveLockedPlacements(placements: LockedPlacement[]): boolean {
    const data: LockedPlacementsData = {
      placements,
    };
    return this.save(STORAGE_KEYS.LOCKED_PLACEMENTS, data);
  }

  static loadLockedPlacements(): LockedPlacement[] | null {
    const data = this.load<LockedPlacementsData>(STORAGE_KEYS.LOCKED_PLACEMENTS);
    if (!data) return null;

    return data.placements;
  }

  static clearLockedPlacements(): void {
    this.remove(STORAGE_KEYS.LOCKED_PLACEMENTS);
  }

  static saveMutationTargets(targets: SelectedMutation[]): boolean {
    const data: MutationTargetsData = {
      targets,
    };
    return this.save(STORAGE_KEYS.MUTATION_TARGETS, data);
  }

  static loadMutationTargets(): SelectedMutation[] | null {
    const data = this.load<MutationTargetsData>(STORAGE_KEYS.MUTATION_TARGETS);
    if (!data) return null;

    return data.targets;
  }

  static clearMutationTargets(): void {
    this.remove(STORAGE_KEYS.MUTATION_TARGETS);
  }

  /** Effect id -> weight; zero and non-finite weights are dropped on save and load. */
  static saveEffectWeights(weights: Record<string, number>): boolean {
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(weights)) {
      if (typeof v === "number" && Number.isFinite(v) && v !== 0) cleaned[k] = v;
    }
    return this.save(STORAGE_KEYS.EFFECT_WEIGHTS, cleaned);
  }

  static loadEffectWeights(): Record<string, number> | null {
    const data = this.load<Record<string, number>>(STORAGE_KEYS.EFFECT_WEIGHTS);
    if (!data || typeof data !== "object") return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "number" && Number.isFinite(v) && v !== 0) out[k] = v;
    }
    return out;
  }

  static clearEffectWeights(): void {
    this.remove(STORAGE_KEYS.EFFECT_WEIGHTS);
  }

  static saveSimulatorScenario(scenario: Scenario): boolean {
    return this.save(STORAGE_KEYS.SIMULATOR_SCENARIO, scenario);
  }

  /** Only shape-checked; the caller validates the scenario before use. */
  static loadSimulatorScenario(): Scenario | null {
    const data = this.load<Scenario>(STORAGE_KEYS.SIMULATOR_SCENARIO);
    if (!data || typeof data !== "object" || !Array.isArray(data.plots)) return null;
    return data;
  }

  static clearSimulatorScenario(): void {
    this.remove(STORAGE_KEYS.SIMULATOR_SCENARIO);
  }

  /** Last finished Calculator result, offered by the Simulator's layout picker. */
  static saveLastSolverLayout(layout: StoredSolverLayout): boolean {
    return this.save(STORAGE_KEYS.LAST_SOLVER_LAYOUT, layout);
  }

  static loadLastSolverLayout(): StoredSolverLayout | null {
    const data = this.load<StoredSolverLayout>(STORAGE_KEYS.LAST_SOLVER_LAYOUT);
    if (!data || typeof data.code !== "string" || !data.code) return null;
    return { code: data.code, name: typeof data.name === "string" ? data.name : "Calculator result", savedAt: Number(data.savedAt) || 0 };
  }

  static clearLastSolverLayout(): void {
    this.remove(STORAGE_KEYS.LAST_SOLVER_LAYOUT);
  }

  /** Clears every key except the simulator scenario. */
  static clearAll(): void {
    this.clearGridConfig();
    this.clearPriorities();
    this.clearDesignerInputs();
    this.clearDesignerTargets();
    this.clearDesignerGroundTiles();
    this.clearLockedPlacements();
    this.clearMutationTargets();
    this.clearEffectWeights();
    this.clearLastSolverLayout();
  }

  static isAvailable(): boolean {
    try {
      const test = "__localStorage_test__";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  /** Approximate usage in characters across this app's keys. */
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
