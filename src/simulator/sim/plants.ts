import { FLESHTRAP_INITIAL_HUNGER, HALT_WATER, type SimConfig } from "../config";
import { kindDef } from "../data/load";
import { ALOE_OPTIMAL_STAGE } from "../growth/aloe";
import type { GameData, KindDef, KindId, MinimumMutations, MutationDef, Size } from "../data/types";
import { footprint, TOTAL_CELLS } from "../grid/cells";
import type { Origin, PlantState, PlotState, SimulationState } from "./state";

export const DEAD_PLANT = "dead_plant";
/** Devourer root: not in data.json; the player clears it. */
export const DEVOURER_ROOT = "devourer_root";
export const isRoot = (p: PlantState): boolean => p.kindId === DEVOURER_ROOT;

/** Decay timer in days: data.json `decay`. 0 = never decays. */
export function decayDaysOf(def: Pick<KindDef, "decayDays">): number {
  return def.decayDays;
}

/** Minimum mutations from data.json (null = timer only). Unknown kinds (roots): null. */
export function minimumMutationsOf(kindId: KindId, data: GameData): MinimumMutations {
  return kindDef(data, kindId)?.minimumMutations ?? null;
}

/**
 * Stage a natural spawn enters at: 1, so an N-stage mutation needs N-1 growth
 * ticks. 0-stage kinds (Gloomgourd, Lonelily, Shellfruit) stay at 0, fully grown on spawn.
 */
export const spawnStageOf = (growthStages: number): number => Math.min(1, growthStages);

export const JELLYBEAN = "magic_jellybean";
/** From this stage a Jellybean broken early still drops (x1 at 12). Normal harvest waits for stage 120. */
export const JELLYBEAN_MIN_HARVEST_STAGE = 12;

/** Stage at which a kind counts as fully grown and harvestable. */
export function readyStageOf(m: MutationDef, config: SimConfig): number {
  if (m.id === "glasscorn") return Math.min(7, m.growthStages); // harvestable at stages 7-8
  // Harvestable at any stage. "Fully grown" is the fixed harvest stage, or 14 (the every-cycle
  // optimum) under auto, where the player picks the actual stage each session (sim/player.ts).
  if (m.id === "all_in_aloe") {
    const stage = config.aloeAutoHarvest ? ALOE_OPTIMAL_STAGE : Math.floor(config.aloeHarvestStage);
    return Math.max(1, Math.min(m.growthStages, stage));
  }
  return m.growthStages;
}

/**
 * Starting decay timer in seconds (null = never): the kind's data.json decay
 * days, running from placement or spawn (a spawn's growth time included).
 * Whether it actually decays at 0 also depends on minimum mutations (sim/decay.ts).
 */
export function initialDecaySeconds(data: GameData, kindId: KindId): number | null {
  const def = kindDef(data, kindId);
  if (!def) return null;
  const days = decayDaysOf(def);
  return days > 0 ? days * 86400 : null;
}

export function newPlant(
  state: SimulationState,
  data: GameData,
  config: SimConfig,
  kindId: KindId,
  row: number,
  col: number,
  origin: Origin,
  cycle: number
): PlantState {
  const def = kindDef(data, kindId);
  if (!def) throw new Error(`Unknown kind "${kindId}"`);
  const size = def.size as Size;
  const plant: PlantState = {
    id: state.nextPlantId++,
    kindId,
    row,
    col,
    size,
    origin,
    stage: 0,
    growthStages: 0,
    readyStage: 0,
    fullyGrownAtCycle: null,
    decaySecondsRemaining: initialDecaySeconds(data, kindId),
    timesMutated: 0,
    mutatesRemaining: minimumMutationsOf(kindId, data),
    water: 0, // everything starts at 0; only player watering raises it
    held: [],
    lockedEffects: null,
    isDeadPlant: false,
    isRival: false,
    skipNextGrowth: false,
    gate: {},
  };

  if (def.kind === "mutation") {
    plant.growthStages = def.growthStages;
    plant.readyStage = readyStageOf(def, config);
    if (origin === "placed") {
      // Placed items go in fully grown and are never harvested.
      plant.stage = def.growthStages;
      plant.fullyGrownAtCycle = cycle;
    } else {
      plant.stage = spawnStageOf(def.growthStages);
    }
    if (kindId === "fleshtrap") plant.gate.hunger = FLESHTRAP_INITIAL_HUNGER;
    // Only a growing Thunderling builds charge.
    if (kindId === "thunderling" && origin !== "placed") plant.gate.charge = 0;
    // Priming rules: sim/explosion.ts.
    if (kindId === "blastberry") plant.gate.primed = false;
    if (kindId === "turtlellini") plant.gate.exploded = 0;
  } else {
    plant.growthStages = def.growthStages ?? 0;
    plant.readyStage = plant.growthStages;
    if (def.growthStages === null) plant.fullyGrownAtCycle = cycle;
  }
  return plant;
}

/** A Devourer root in one cell. */
export function newRoot(state: SimulationState, row: number, col: number, cycle: number): PlantState {
  return {
    id: state.nextPlantId++,
    kindId: DEVOURER_ROOT,
    row,
    col,
    size: 1,
    origin: "placed",
    stage: 0,
    growthStages: 0,
    readyStage: 0,
    fullyGrownAtCycle: cycle,
    decaySecondsRemaining: null,
    // No minimum, never credited, never decays, never drinks.
    timesMutated: 0,
    mutatesRemaining: null,
    water: 0,
    held: [],
    lockedEffects: null,
    isDeadPlant: false,
    isRival: false,
    skipNextGrowth: false,
    gate: {},
  };
}

/**
 * Turn a plant into a dead_plant in place (new id, same footprint) with the
 * dead_plant timer and fresh minimum-mutation counters, so it never decays on
 * its own; the player clears it.
 */
export function convertToDeadPlant(state: SimulationState, data: GameData, plant: PlantState): void {
  plant.id = state.nextPlantId++;
  plant.kindId = DEAD_PLANT;
  plant.origin = "placed";
  plant.isDeadPlant = true;
  plant.isRival = false;
  plant.stage = 0;
  plant.growthStages = 0;
  plant.readyStage = 0;
  plant.fullyGrownAtCycle = null;
  plant.decaySecondsRemaining = initialDecaySeconds(data, DEAD_PLANT);
  plant.timesMutated = 0;
  plant.mutatesRemaining = minimumMutationsOf(DEAD_PLANT, data);
  plant.lockedEffects = null;
  plant.held = [];
  plant.skipNextGrowth = false;
  plant.gate = {};
}

export function sortPlants(plot: PlotState): void {
  plot.plants.sort((a, b) => a.row - b.row || a.col - b.col || a.id - b.id);
}

export function insertPlant(plot: PlotState, plant: PlantState): void {
  plot.plants.push(plant);
  sortPlants(plot);
}

export function removePlant(plot: PlotState, plant: PlantState): void {
  const i = plot.plants.indexOf(plant);
  if (i >= 0) plot.plants.splice(i, 1);
}

export type Occupancy = (PlantState | null)[];

/** Cell index -> plant covering it (every footprint cell). */
export function buildOccupancy(plot: PlotState): Occupancy {
  const occ: Occupancy = new Array(TOTAL_CELLS).fill(null);
  for (const p of plot.plants) {
    for (const idx of footprint(p.row, p.col, p.size)) occ[idx] = p;
  }
  return occ;
}

export function isFootprintFree(occ: Occupancy, row: number, col: number, size: number): boolean {
  return footprint(row, col, size).every((idx) => occ[idx] === null);
}

/**
 * Dried out: water at or below `HALT_WATER` halts the plant. It doesn't grow,
 * give or relay effects (still receives them), or count for requirements or
 * unique crops; it still blocks Lonelily and keeps decaying. Watering clears it.
 * Derived from `water` alone; relies on `HALT_WATER` < 0 so plants that never
 * lose water (start 0, placed, roots) can't be dry.
 */
export const isDry = (p: PlantState): boolean => !p.isDeadPlant && p.water <= HALT_WATER;

export const isFullyGrown = (p: PlantState): boolean => !p.isDeadPlant && p.stage >= p.readyStage && p.lockedEffects !== null;

/**
 * Whether removing it gives drops: fully grown spawns and base crops, plus
 * spawned All-in Aloe at any stage and Jellybean from stage 12.
 */
export const isHarvestable = (p: PlantState): boolean =>
  (p.origin === "spawned" || p.origin === "planted") &&
  !p.isDeadPlant &&
  (isFullyGrown(p) ||
    (p.origin === "spawned" && (p.kindId === "all_in_aloe" || (p.kindId === JELLYBEAN && p.stage >= JELLYBEAN_MIN_HARVEST_STAGE))));
