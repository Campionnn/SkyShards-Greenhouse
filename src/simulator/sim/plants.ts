import type { SimConfig } from "../config";
import { kindDef } from "../data/load";
import type { GameData, KindDef, KindId, MinimumMutations, MutationDef, Size } from "../data/types";
import { footprint, TOTAL_CELLS } from "../grid/cells";
import type { Origin, PlantState, PlotState, SimulationState } from "./state";

export const DEAD_PLANT = "dead_plant";
/** A Devourer root: its own entity (not in data.json), cleared by the player. */
export const DEVOURER_ROOT = "devourer_root";
export const isRoot = (p: PlantState): boolean => p.kindId === DEVOURER_ROOT;

/**
 * A kind's decay timer in DAYS: `decayDaysOverrides` first (any kind, crops
 * included), else data.json (`decay`). 0 = it never decays.
 */
export function decayDaysOf(def: Pick<KindDef, "id" | "decayDays">, config: Pick<SimConfig, "decayDaysOverrides">): number {
  return config.decayDaysOverrides?.[def.id] ?? def.decayDays;
}

/**
 * A kind's minimum mutation value with `minimumMutationsOverrides` applied
 * ("none" = N/A, timer-only). Unknown kinds (Devourer roots) have none.
 */
export function minimumMutationsOf(
  kindId: KindId,
  data: GameData,
  config: Pick<SimConfig, "minimumMutationsOverrides">
): MinimumMutations {
  const o = config.minimumMutationsOverrides?.[kindId];
  if (o !== undefined) return o === "none" ? null : o;
  return kindDef(data, kindId)?.minimumMutations ?? null;
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

/**
 * The timer a freshly planted / placed / spawned plant starts with, in
 * seconds; null = it never decays. Only the TIMER: whether it actually decays
 * when the timer runs out also depends on its minimum mutations (sim/decay.ts).
 * - a natural spawn: `spawnedDecaySeconds` (harvestWindowCycles, else its decay days);
 * - anything else: its kind's decay days (`decayDaysOf`): 3 for base crops
 *   and dead_plant, 0 (never) for fire and fermento, the mutation's own for
 *   placed items.
 */
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
  const def = kindDef(data, kindId);
  if (!def) return null;
  const days = decayDaysOf(def, config);
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
    timesMutated: 0,
    mutatesRemaining: minimumMutationsOf(kindId, data, config),
    // Everything starts at 0 water (user-confirmed): planted base crops,
    // placed items and natural spawns alike. Only the player's watering
    // (player `water` phase) raises it; Soggybud draws from neighbours.
    water: 0,
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
    // Not in data.json: no minimum, never credited (never a requirement), never decays.
    timesMutated: 0,
    mutatesRemaining: null,
    water: 0, // like every plant; a root never drinks or gets drunk from
    held: [],
    lockedEffects: null,
    isDeadPlant: false,
    isRival: false,
    skipNextGrowth: false,
    gate: {},
  };
}

/**
 * Turn a plant into the Dead Plant it leaves behind (same footprint, a real
 * dead_plant). It gets the dead_plant timer (3 days, overrides applied) and
 * fresh counters (helped 0 times, its own minimum of 10 left): having never
 * helped, it doesn't decay on its own - the player clears it at the next
 * session.
 */
export function convertToDeadPlant(state: SimulationState, data: GameData, config: SimConfig, plant: PlantState): void {
  plant.id = state.nextPlantId++;
  plant.kindId = DEAD_PLANT;
  plant.origin = "placed";
  plant.isDeadPlant = true;
  plant.isRival = false;
  plant.stage = 0;
  plant.growthStages = 0;
  plant.readyStage = 0;
  plant.fullyGrownAtCycle = null;
  plant.decaySecondsRemaining = initialDecaySeconds(data, config, DEAD_PLANT, "placed", 0);
  plant.timesMutated = 0;
  plant.mutatesRemaining = minimumMutationsOf(DEAD_PLANT, data, config);
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

/**
 * Dried out (0.27.2): water at or below `haltWater` halts a plant instead of
 * killing it. A dry plant doesn't grow, gives and relays no effects (it still
 * receives them), doesn't count toward mutation requirements or the unique
 * crop bonus, but still physically blocks Lonelily and keeps decaying.
 * Watering it (player `water` phase) un-halts it.
 *
 * Derived from `water` alone, no extra state: only plants that consume water
 * (base crops, spawns that need watering) can get there. Every plant starts
 * at 0 water (above the threshold), Soggybud never drains a neighbour below
 * 0, and placed plants and roots never lose water - as long as `haltWater`
 * stays below 0.
 */
export const isDry = (p: PlantState, config: Pick<SimConfig, "haltWater">): boolean => !p.isDeadPlant && p.water <= config.haltWater;

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
