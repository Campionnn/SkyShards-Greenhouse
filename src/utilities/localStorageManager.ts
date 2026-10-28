/** Typed JSON persistence of app state in localStorage. Failures are logged, not thrown. */

import type { SelectedMutation } from "../types/greenhouse";
import type { LockedPlacement } from "../types/greenhouse";
import type { DesignerPlacement } from "../context";
import type { ProfileMode, Scenario } from "../simulator";
// Direct path: just the small Bazaar module, not the whole simulator.
import { DEFAULT_BAZAAR_PRICING, type BazaarOverride, type BazaarPricing, type BazaarQuote } from "../simulator/economy/bazaar";
import type { GroundTile } from "./designEncoding";
import type { StoredSolverLayout } from "./layoutHandoff";
import { TARGET_DISPLAYS, type TargetDisplay } from "../constants/styles";

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
  GUIDE_STATE: "skyshards-guide-state",
  GUIDE_STATE_2PLOTS: "skyshards-guide-state-2plots",
  GUIDE_VARIANT: "skyshards-guide-variant",
  GUIDE_HOWTO: "skyshards-guide-howto",
  GUIDE_FLOW_TOTALS: "skyshards-guide-flow-totals",
  GUIDE_FLOW_TOTALS_2PLOTS: "skyshards-guide-flow-totals-2plots",
  LAST_SOLVER_LAYOUT: "skyshards-last-solver-layout",
  PROFILE_MODE: "skyshards-profile-mode",
  TARGET_DISPLAY: "skyshards-target-display",
  INPUTS_HIDDEN: "skyshards-inputs-hidden",
  BAZAAR_PRICES: "skyshards-bazaar-prices",
  BAZAAR_PRICING: "skyshards-bazaar-pricing",
  BAZAAR_OVERRIDES: "skyshards-bazaar-overrides",
  AUTH_TOKEN: "skyshards-auth-token",
} as const;

/**
 * The Guide keeps the player's greenhouse (inventory, each plot's farm and facts, settings, script
 * memory) so a revisit picks up where they left off. It is validated against the flow on load
 * (`restoreState` in src/guide/checkin.ts); versions before 2 are discarded, 2 is migrated.
 */
export interface StoredGuideState {
  version: 2 | 3;
  inventory: Record<string, number>;
  plots: Record<number, { farm: string; facts?: unknown; acted?: boolean; factsFromEarlier?: boolean }>;
  settings: Scenario["settings"];
  memory: { builtOnce: Record<string, number> };
  /** Check-in interval in real hours; null = daily time windows. */
  checkEvery?: number | null;
  /** This visit's confirmations (exact stock changes), so Undo survives a reload. */
  confirmations?: Record<number, { plotId: number; before: { farm: string }; delta: Record<string, number>; memory: { builtOnce: Record<string, number> } }>;
  /** Forecast precision the player last chose. */
  precision?: "quick" | "normal" | "thorough";
  /** The last Hypixel import (src/guide/checkin.ts `LastImport`), for "Import again". */
  lastImport?: { username: string; profileId: string; profileName: string; fetchedAt: number; appliedAt?: number; items: Record<string, number> };
}

/** The Guide's whole-flow totals: per mutation, the typical amount the flow uses from an empty start. */
export interface StoredFlowTotals {
  /** Flow fingerprint + the schedule and stats the runs used. */
  key: string;
  runs: number;
  totals: Record<string, number>;
}

/** Cached Bazaar prices: when they were fetched (ms), the API's own timestamp, and quotes by simulator item id. */
export interface StoredBazaarPrices {
  /** How the quotes were derived (`BAZAAR_PRICES_VERSION`); older caches are dropped and refetched. */
  version?: number;
  fetchedAt: number;
  lastUpdated: number;
  quotes: Record<string, BazaarQuote>;
}

/** 2: base crops priced from their double-compacted product, per crop. */
export const BAZAAR_PRICES_VERSION = 2;

/** The Guide's flow version: all three plots, or only Plots 1 and 2. */
export type GuideVariant = "three" | "two";
const guideKey = (variant: GuideVariant) => (variant === "two" ? STORAGE_KEYS.GUIDE_STATE_2PLOTS : STORAGE_KEYS.GUIDE_STATE);

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

  /**
   * The Guide's greenhouse and settings, one per flow version: `skyshards-guide-state` for the
   * three-plot flow, `skyshards-guide-state-2plots` for the two-plot one (their plots and farms differ).
   */
  static saveGuideState(state: StoredGuideState, variant: GuideVariant = "three"): boolean {
    return this.save(guideKey(variant), state);
  }

  /** Only shape-checked here; the Guide validates it against the flow before use. Old shapes are dropped. */
  static loadGuideState(variant: GuideVariant = "three"): StoredGuideState | null {
    const data = this.load<StoredGuideState>(guideKey(variant));
    if (!data || typeof data !== "object" || (data.version !== 2 && data.version !== 3)) return null;
    return data;
  }

  static clearGuideState(variant: GuideVariant = "three"): void {
    this.remove(guideKey(variant));
  }

  /** Which flow version the Guide shows (`skyshards-guide-variant`); three plots unless chosen. */
  static saveGuideVariant(variant: GuideVariant): boolean {
    return this.save(STORAGE_KEYS.GUIDE_VARIANT, variant);
  }

  static loadGuideVariant(): GuideVariant {
    return this.load<string>(STORAGE_KEYS.GUIDE_VARIANT) === "two" ? "two" : "three";
  }

  /**
   * The Guide's whole-flow totals (`skyshards-guide-flow-totals[-2plots]`): simulated runs of the
   * flow from an empty start are slow, so they are remembered for the flow file and settings they
   * were measured with (`key`).
   */
  static saveGuideFlowTotals(value: StoredFlowTotals, variant: GuideVariant = "three"): boolean {
    return this.save(variant === "two" ? STORAGE_KEYS.GUIDE_FLOW_TOTALS_2PLOTS : STORAGE_KEYS.GUIDE_FLOW_TOTALS, value);
  }

  static loadGuideFlowTotals(variant: GuideVariant = "three"): StoredFlowTotals | null {
    const data = this.load<StoredFlowTotals>(variant === "two" ? STORAGE_KEYS.GUIDE_FLOW_TOTALS_2PLOTS : STORAGE_KEYS.GUIDE_FLOW_TOTALS);
    if (!data || typeof data !== "object" || typeof data.key !== "string" || !data.totals || typeof data.totals !== "object") return null;
    const totals: Record<string, number> = {};
    for (const [item, n] of Object.entries(data.totals)) if (typeof n === "number" && Number.isFinite(n) && n > 0) totals[item] = Math.round(n);
    return { key: data.key, runs: typeof data.runs === "number" ? data.runs : 0, totals };
  }

  /** Whether the Guide's "How to use this guide" panel is folded away (`skyshards-guide-howto`). */
  static saveGuideHowToHidden(hidden: boolean): boolean {
    return this.save(STORAGE_KEYS.GUIDE_HOWTO, hidden);
  }

  static loadGuideHowToHidden(): boolean {
    return this.load<boolean>(STORAGE_KEYS.GUIDE_HOWTO) === true;
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

  /**
   * Site-wide profile mode (`skyshards-profile-mode`): "ironman" (no Bazaar, the default) or
   * "normal" (buys and sells on the Bazaar). Any page can read it; the Simulator applies it.
   */
  static saveProfileMode(mode: ProfileMode): boolean {
    return this.save(STORAGE_KEYS.PROFILE_MODE, mode);
  }

  static loadProfileMode(): ProfileMode {
    return this.load<string>(STORAGE_KEYS.PROFILE_MODE) === "normal" ? "normal" : "ironman";
  }

  /** How the Calculator and Designer grids draw target mutations (`skyshards-target-display`), shared by both. */
  static saveTargetDisplay(display: TargetDisplay): boolean {
    return this.save(STORAGE_KEYS.TARGET_DISPLAY, display);
  }

  static loadTargetDisplay(): TargetDisplay {
    const value = this.load<string>(STORAGE_KEYS.TARGET_DISPLAY);
    return TARGET_DISPLAYS.includes(value as TargetDisplay) ? (value as TargetDisplay) : "solid";
  }

  /** Whether the Calculator and Designer grids hide input crops (`skyshards-inputs-hidden`), shared by both. */
  static saveInputsHidden(hidden: boolean): boolean {
    return this.save(STORAGE_KEYS.INPUTS_HIDDEN, hidden);
  }

  static loadInputsHidden(): boolean {
    return this.load<boolean>(STORAGE_KEYS.INPUTS_HIDDEN) === true;
  }

  /** The last Bazaar prices fetched (greenhouse items only), shown while a fresh fetch runs or fails. */
  static saveBazaarPrices(snapshot: StoredBazaarPrices): boolean {
    return this.save(STORAGE_KEYS.BAZAAR_PRICES, snapshot);
  }

  static loadBazaarPrices(): StoredBazaarPrices | null {
    const data = this.load<StoredBazaarPrices>(STORAGE_KEYS.BAZAAR_PRICES);
    if (!data || typeof data !== "object" || typeof data.fetchedAt !== "number" || !data.quotes || typeof data.quotes !== "object") return null;
    // Prices cached by an older version (quick_status prices, raw-crop prices) are dropped and refetched.
    if (data.version !== BAZAAR_PRICES_VERSION) return null;
    return data;
  }

  /** Buy / sell side and sales tax for Bazaar prices. */
  static saveBazaarPricing(pricing: BazaarPricing): boolean {
    return this.save(STORAGE_KEYS.BAZAAR_PRICING, pricing);
  }

  static loadBazaarPricing(): BazaarPricing {
    const data = this.load<Partial<BazaarPricing>>(STORAGE_KEYS.BAZAAR_PRICING);
    const tax = Number(data?.taxPercent);
    return {
      buy: data?.buy === "order" ? "order" : DEFAULT_BAZAAR_PRICING.buy,
      sell: data?.sell === "instant" ? "instant" : DEFAULT_BAZAAR_PRICING.sell,
      taxPercent: Number.isFinite(tax) && tax >= 0 && tax <= 100 ? tax : DEFAULT_BAZAAR_PRICING.taxPercent,
    };
  }

  /** Manual Bazaar prices per item (`skyshards-bazaar-overrides`), replacing a manipulated live price. */
  static saveBazaarOverrides(overrides: Record<string, BazaarOverride>): boolean {
    return this.save(STORAGE_KEYS.BAZAAR_OVERRIDES, overrides);
  }

  static loadBazaarOverrides(): Record<string, BazaarOverride> {
    const data = this.load<Record<string, unknown>>(STORAGE_KEYS.BAZAAR_OVERRIDES);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
    const out: Record<string, BazaarOverride> = {};
    for (const [id, raw] of Object.entries(data)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const o: BazaarOverride = {};
      if (ok(r.lowestSellOffer)) o.lowestSellOffer = r.lowestSellOffer;
      if (ok(r.highestBuyOrder)) o.highestBuyOrder = r.highestBuyOrder;
      if (Object.keys(o).length) out[id] = o;
    }
    return out;
  }

  /** Leaderboard login (`skyshards-auth-token`): the API's JWT, stored raw (not JSON). */
  static saveAuthToken(token: string): boolean {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
      return true;
    } catch (error) {
      console.error("Failed to save the auth token:", error);
      return false;
    }
  }

  static loadAuthToken(): string | null {
    try {
      const t = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      return t && t.trim() ? t : null;
    } catch {
      return null;
    }
  }

  static clearAuthToken(): void {
    this.remove(STORAGE_KEYS.AUTH_TOKEN);
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
