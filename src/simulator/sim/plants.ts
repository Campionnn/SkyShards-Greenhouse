import type { SimConfig } from "../config";
import { kindDef } from "../data/load";
import type { GameData, KindId, MutationDef, Size } from "../data/types";
import { footprint, TOTAL_CELLS } from "../grid/cells";
import type { Origin, PlantState, PlotState, SimulationState } from "./state";

export const DEAD_PLANT = "dead_plant";
/** A Devourer root: its own entity (not in data.json), cleared by the player. */
export const DEVOURER_ROOT = "devourer_root";
export const isRoot = (p: PlantState): boolean => p.kindId === DEVOURER_ROOT;

export function decayDaysOf(m: MutationDef, config: SimConfig): number {
  return config.decayDaysOverrides[m.id] ?? m.decayDays;
}

/**
 * The stage a natural spawn enters at. Mutations appear at stage 1 (not 0),
 * so an N-stage mutation needs N-1 growth ticks and a 0-stage one (Gloomgourd,
 * Lonelily, Shellfruit...) is fully grown the tick it spawns. Capped at the
 * kind's own stage count so a 0-stage mutation stays at 0.
 */
export const spawnStageOf = (growthStages: number): number => Math.min(1, growthStages);

export const JELLYBEAN = "magic_jellybean";
/**
 * From this stage a Magic Jellybean the player breaks early (stage change,
 * blocking a layout cell) still drops its items and bundle (x1 at 12, rising).
 * The player's own harvest still waits for stage 120.
 */
export const JELLYBEAN_MIN_HARVEST_STAGE = 12;

/** Stage at which a kind counts as fully grown and harvestable. */
export function readyStageOf(m: MutationDef, config: SimConfig): number {
  if (m.id === "glasscorn") return Math.min(7, m.growthStages); // harvestable at stages 7-8
  // Harvestable at any stage; "fully grown" is the stage the player harvests at (14 is optimal).
  if (m.id === "all_in_aloe") return Math.max(1, Math.min(m.growthStages, Math.floor(config.aloeHarvestStage)));
  return m.growthStages;
}

/**
 * A natural spawn's decay timer in seconds (Q16b). It runs from the tick the
 * mutation spawns - it does NOT wait until it is fully grown, so the stages it
 * spends growing come out of the same timer. null = it never decays.
 */
export function spawnedDecaySeconds(m: MutationDef, config: SimConfig, cycleSeconds: number): number | null {
  if (config.harvestWindowCycles > 0) return config.harvestWindowCycles * cycleSeconds;
  const days = decayDaysOf(m, config);
  return days > 0 ? days * 86400 : null;
}

function baseCropDecaySeconds(config: SimConfig): number | null {
  return config.baseCropDecayHours > 0 ? config.baseCropDecayHours * 3600 : null;
}

/** The timer a freshly planted / placed / spawned plant starts with. */
export function initialDecaySeconds(
  data: GameData,
  config: SimConfig,
  kindId: KindId,
  origin: Origin,
  cycleSeconds: number
): number | null {
  const m = data.mutations[kindId];
  // A natural spawn decays from the tick it appears, even while it grows.
  if (origin === "spawned") return m ? spawnedDecaySeconds(m, config, cycleSeconds) : null;
  if (m) {
    const days = decayDaysOf(m, config);
    return days > 0 ? days * 86400 : null;
  }
  const c = data.crops[kindId];
  if (c && c.growthStages === null) return config.nullStageKindsDecay ? baseCropDecaySeconds(config) : null;
  return baseCropDecaySeconds(config);
}

export function newPlant(
  state: SimulationState,
  data: GameData,
  config: SimConfig,
  kindId: KindId,
  row: number,
  col: number,
  origin: Origin,
  cycle: number,
  /** Cycle length now, for a spawn's `harvestWindowCycles` timer. */
  cycleSeconds: number
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
    decaySecondsRemaining: initialDecaySeconds(data, config, kindId, origin, cycleSeconds),
    water: config.maxWater,
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
      // Placed items go in fully grown: an input and buff source, never harvested.
      plant.stage = def.growthStages;
      plant.fullyGrownAtCycle = cycle;
    } else {
      plant.stage = spawnStageOf(def.growthStages);
    }
    if (kindId === "fleshtrap") plant.gate.hunger = config.fleshtrapInitialHunger;
    // A spawned Thunderling grows and so builds charge; a placed one never grows.
    if (kindId === "thunderling" && origin !== "placed") plant.gate.charge = 0;
    // Primed once fully grown (natural) or at the next tick after placing (see sim/explosion.ts).
    if (kindId === "blastberry") plant.gate.primed = false;
    if (kindId === "turtlellini") plant.gate.exploded = 0;
    // Soggybud grows by drawing water from its neighbours, starting dry.
    if (kindId === "soggybud" && origin === "spawned") plant.water = 0;
  } else {
    plant.growthStages = def.growthStages ?? 0;
    plant.readyStage = plant.growthStages;
    if (def.growthStages === null) plant.fullyGrownAtCycle = cycle;
  }
  return plant;
}

/** A Devourer root in one cell. */
export function newRoot(state: SimulationState, config: SimConfig, row: number, col: number, cycle: number): PlantState {
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
    water: config.maxWater,
    held: [],
    lockedEffects: null,
    isDeadPlant: false,
    isRival: false,
    skipNextGrowth: false,
    gate: {},
  };
}

/** Turn a plant into the Dead Plant it leaves behind (same footprint, a real dead_plant). */
export function convertToDeadPlant(state: SimulationState, plant: PlantState): void {
  plant.id = state.nextPlantId++;
  plant.kindId = DEAD_PLANT;
  plant.origin = "placed";
  plant.isDeadPlant = true;
  plant.isRival = false;
  plant.stage = 0;
  plant.growthStages = 0;
  plant.readyStage = 0;
  plant.fullyGrownAtCycle = null;
  plant.decaySecondsRemaining = null;
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

/** cell index -> the plant covering it. Every footprint cell maps to the same plant. */
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

export const isFullyGrown = (p: PlantState): boolean => !p.isDeadPlant && p.stage >= p.readyStage && p.lockedEffects !== null;

/**
 * Does taking this plant off give its drops (rather than just breaking it)?
 * Only natural spawns and base crops. All-in Aloe drops at any stage, Magic
 * Jellybean from stage 12 - before the stage the player normally waits for
 * (e.g. when a step change removes it).
 */
export const isHarvestable = (p: PlantState): boolean =>
  (p.origin === "spawned" || p.origin === "planted") &&
  !p.isDeadPlant &&
  (isFullyGrown(p) ||
    (p.origin === "spawned" && (p.kindId === "all_in_aloe" || (p.kindId === JELLYBEAN && p.stage >= JELLYBEAN_MIN_HARVEST_STAGE))));
