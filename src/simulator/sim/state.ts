import type { SimConfig } from "../config";
import type { EffectId, ItemId, KindId, MutationId, Size } from "../data/types";
import type { Flow, Policies, PolicyOverrides } from "../flow/types";
import type { ArmorSet } from "../economy/rareCrops";
import type { RngState } from "../rng";

// SimulationState is plain data (no Map, Set, class or closure) so it survives
// structuredClone, postMessage and JSON, and run() stays splittable.

export type PlotId = number;

/**
 * - planted: base crop from a layout. Free, grows, harvestable.
 * - placed:  item from inventory (mutation, fire, fermento, dead_plant). Fully grown on placement,
 *            not harvestable, drops nothing; decay timer starts at placement.
 * - spawned: natural spawn. Grows, harvestable; decay timer starts at spawn, so growth time counts against it.
 */
export type Origin = "planted" | "placed" | "spawned";

export interface PlantState {
  id: number;
  kindId: KindId;
  row: number;
  col: number;
  size: Size;
  origin: Origin;
  stage: number;
  growthStages: number;
  /** Stage at which it counts as fully grown (Glasscorn 7, All-in Aloe configurable). */
  readyStage: number;
  fullyGrownAtCycle: number | null;
  /**
   * Seconds until the decay timer runs out; null = never decays. On expiry it decays only if its
   * minimum mutations are met (sim/decay.ts), else the timer is extended by `decayExtensionHours`.
   */
  decaySecondsRemaining: number | null;
  /** Mutation spawns this plant was credited as a requirement for. */
  timesMutated: number;
  /**
   * Kind's minimum mutations (overrides applied) minus `timesMutated`; may go negative.
   * "infinite": never decays (Magic Jellybean). null: no minimum, timer-only decay (also Devourer roots).
   */
  mutatesRemaining: number | "infinite" | null;
  water: number;
  /** Raw held effects (drives propagation and Godseed). */
  held: EffectId[];
  /** Effective effects latched when it became fully grown; yield uses these. */
  lockedEffects: EffectId[] | null;
  /** Dead Plant left by decay (kindId "dead_plant"). Drying out halts instead (sim/plants.ts `isDry`). */
  isDeadPlant: boolean;
  /** Spawned into a labelled slot whose target is a different mutation. */
  isRival: boolean;
  skipNextGrowth: boolean;
  gate: {
    asleep?: boolean;
    ratAlive?: boolean;
    hunger?: number;
    /** Thunderling (spawned only): +2000 per stage grown; halts at the max until discharged. */
    charge?: number;
    /** Blastberry: explodes when broken once primed. Natural: primed when fully grown; placed: at the next tick. */
    primed?: boolean;
    /** Turtlellini: times caught in a Blastberry explosion (2 = Shellfruit). */
    exploded?: number;
  };
}

export interface SlotLabel {
  mutationId: MutationId;
  row: number;
  col: number;
  size: Size;
}

export interface PlotState {
  id: PlotId;
  /** Sorted by (row, col). Every iteration over plants uses this order. */
  plants: PlantState[];
  slots: SlotLabel[];
  /** Physical layout ground (paint and inferred plant/target footprints). Missing cells are AIR. Reset on step change. */
  groundTiles: Record<string, string>;
  /** Ground changed in play (Chorus Fruit converts landing cells to end_stone). */
  groundOverrides: Record<string, string>;
  /** Slot anchor key -> consecutive cycles its target has been ineligible. */
  slotIneligibleCycles: Record<string, number>;
  /** Watched slot anchor key -> what the uptime check saw there this cycle. Reset on step change. */
  watchStatus: Record<string, WatchStatus>;
}

/**
 * A watched target cell for one cycle, as seen at its spawn roll:
 * - growing:      target mutation stands there
 * - halted:       target stands there dried out (downtime only)
 * - ready:        empty and the target could spawn now
 * - requirements: empty, target cannot spawn (neighbours or ground missing)
 * - blocked:      something else is in the way (rival, Dead Plant, root, overlapping footprint)
 * Uptime = (growing + ready) / watched. Only `requirements` makes a run not sustainable.
 */
export type WatchStatus = "growing" | "halted" | "ready" | "requirements" | "blocked";

export interface UptimeCounts {
  /** Cell-cycles watched. */
  watched: number;
  growing: number;
  ready: number;
  requirements: number;
  blocked: number;
  /** Target stood on its cell dried out. Downtime only. */
  halted: number;
}

export interface SpotUptime extends UptimeCounts {
  mutationId: MutationId;
  row: number;
  col: number;
  /** First cycle it sat empty without its requirements. */
  firstRequirementsCycle: number | null;
  /** Longest run of consecutive watched cycles without its requirements. */
  longestRequirementsStreak: number;
  currentRequirementsStreak: number;
  /** Last cycle it was watched (a streak only continues over consecutive cycles). */
  lastCycle: number;
}

export interface FlowRunnerState {
  plotId: PlotId;
  stepIndex: number;
  cyclesInStep: number;
  /** Counters since entering the current step. */
  spawnedInStep: Record<MutationId, number>;
  decayedInStep: Record<KindId, number>;
  /** Natural spawns harvested since entering the step. Optional for older saved states. */
  harvestedInStep?: Record<MutationId, number>;
  /** Triggers fired on an inactive cycle; the layout is applied at the next player session. */
  pendingTransition: boolean;
  /** Target step index of the pending change (route target or exit `next`). Missing = next step. */
  pendingTarget?: number;
  /** A non-looping flow that reached its last step's exit: the plot holds that step. */
  finished: boolean;
  history: { stepId: string; stepIndex: number; startCycle: number; endCycle: number | null }[];
}

export interface PlayerStats {
  cropGrowth: number;
  speedAttribute: number;
  /** Greenhouse Growth Speed Upgrade tier 0..9 (tier 9 jumps to +50%). */
  growthUpgradeTier: number;
  farmingFortune: number;
  /** Plant Yield Greenhouse Upgrade, 0 .. 0.20. */
  plantYieldUpgrade: number;
  /** Evergreen Chip, 0 .. 0.60; multiplies all crop-bundle drops (base crops and mutations). */
  evergreenChip: number;
  /** Bioanalysis: 0.05 Talisman, 0.10 Ring, 0.15 Artifact. Scales the spawn pool's mutation arm (`applyMutationChanceBonus`). */
  mutationChanceBonus: number;
  miningFortune: number;
  /** Uncapped. Rare Crop chances x (1 + overbloom / 100): armor Rare Crops and Ethereal Vine, not Harvest Bounty. */
  overbloom: number;
  /** Farming armor, assumed 4/4 pieces; its tiered bonus rolls Rare Crops on every harvest. */
  armorSet: ArmorSet;
  /** Hour of day (0..24) at cycle 0, for time-window schedules. */
  startTimeOfDay: number;
  /**
   * Flora shard, 0-10: added to unique crop groups standing for the Unique Crop Bonus (capped at
   * `uniqueCropCap`). May be missing in old saves: `withDefaults` (SimulatorPage.tsx) fills it and
   * `effectiveUniqueCrops` treats missing as 0.
   */
  floraShard: number;
}

/** When the player is online. All harvesting, watering, upkeep and gate interaction happens then. */
export type ActivitySchedule =
  | { kind: "everyN"; n: number; offset: number }
  | { kind: "windows"; windows: { from: number; to: number }[] };

export interface Settings {
  seed: number;
  playerStats: PlayerStats;
  activity: ActivitySchedule;
  /** Off = the player never comes online, regardless of `activity`. Missing = on. */
  playerActions?: boolean;
  policies: Policies;
  config: SimConfig;
}

export interface ScenarioPlot {
  id: PlotId;
  flow: Flow;
  policies?: PolicyOverrides;
}

/** The whole input. The cycle count is an argument to run(), not part of the scenario. */
export interface Scenario {
  plots: ScenarioPlot[];
  startingInventory: Record<ItemId, number>;
  settings: Settings;
}

export interface LedgerRow {
  produced: number;
  consumed: number;
  /** Units a required spend could not get. */
  shortfall: number;
  minStock: number;
  firstStockoutCycle: number | null;
}

export interface DebtEvent {
  cycle: number;
  plotId: PlotId;
  item: ItemId;
  needed: number;
  available: number;
  shortfall: number;
  row: number;
  col: number;
  action: string;
}

export interface PerPlotSummary {
  revenue: number;
  spawned: number;
  harvested: number;
  decayed: number;
  destroyed: number;
}

export interface RunSummary {
  cyclesRun: number;
  elapsedSeconds: number;
  /** Everything valued at NPC price when harvested. */
  coinsRealised: number;
  /** rareDrops: Harvest Bounty. rareCrops: armor Rare Crops and Ethereal Vine (Overbloom-boosted). */
  revenue: { crops: number; rareDrops: number; rareCrops: number; mutationItems: number };
  /** Coins; 0 in NPC-only mode (base crops are free, mutation items have no NPC price). */
  costs: { replacements: number; supplies: number };
  profit: number;
  coinsPerDay: number;
  mutationsPerDay: number;
  rivals: { spawned: number; cleared: number };
  spawned: Record<MutationId, number>;
  harvested: Record<KindId, number>;
  /** Plants lost to decay, by kind. */
  decayed: Record<KindId, number>;
  /**
   * Decay timer expiries extended because the minimum mutations were not met, by kind; once per
   * expiry. May be missing in old states: created on first use, read as empty by the UI.
   */
  extended: Record<KindId, number>;
  destroyed: Record<KindId, number>;
  /** Dry-outs (water reached haltWater), by kind; counted per dry-out. */
  driedOut: Record<KindId, number>;
  /** Items spent placing plants, by item. */
  placedItems: Record<ItemId, number>;
  /** Rare Crops dropped (armor bonus + mutation Ethereal Vine), by item. */
  rareCrops: Record<ItemId, number>;
  /** Items the user added to the live run's inventory, by item. Never revenue. */
  injected: Record<ItemId, number>;
  /** Re-placements after something decayed or was destroyed. */
  replacements: number;
  debtEvents: number;
  unfilledCellCycles: number;
  /** Watched target cells, all plots and steps together (cell-cycles). */
  uptime: UptimeCounts;
  perPlot: Record<string, PerPlotSummary>;
}

export interface SimulationState {
  version: 1;
  scenario: Scenario;
  cycle: number;
  elapsedSeconds: number;
  rng: RngState;
  plots: PlotState[];
  flows: FlowRunnerState[];
  inventory: Record<ItemId, number>;
  ledger: Record<ItemId, LedgerRow>;
  /** Stored debt events (capped); summary.debtEvents has the full count. */
  debts: DebtEvent[];
  /** "plot:row,col:item" -> an unresolved shortfall episode. */
  openDebts: Record<string, true>;
  /** Per watched spot: plot id -> step id -> slot anchor key -> counters. */
  uptime: Record<string, Record<string, Record<string, SpotUptime>>>;
  summary: RunSummary;
  nextPlantId: number;
  /** Effective unique crop count for the Unique Crop Bonus, all plots, recomputed each cycle; capped at `config.uniqueCropCap`. */
  uniqueCropCount: number;
  /** Raw unique crop groups standing across all plots, before Flora and the cap. */
  uniqueCropsStanding: number;
  lastCycleSeconds: number;
  lastCycleActive: boolean;
}

// ---- Events: the trace every number can be explained from ----

export type TickEvent =
  | { kind: "advanced"; plantId: number; kindId: KindId; stage: number }
  | { kind: "fullyGrown"; plantId: number; kindId: KindId; row: number; col: number }
  | { kind: "growthBlocked"; plantId: number; kindId: KindId; gate: string }
  | { kind: "growthSkipped"; plantId: number; kindId: KindId; reason: "water" }
  | { kind: "reset"; plantId: number; kindId: KindId; row: number; col: number; fromStage: number }
  | { kind: "exploded"; plantId: number; row: number; col: number }
  | { kind: "rootSpread"; row: number; col: number; fromRow: number; fromCol: number }
  | { kind: "converted"; from: ItemId; to: ItemId; count: number }
  | { kind: "decayed"; plantId: number; kindId: KindId; row: number; col: number }
  /** Decay timer ran out with minimum mutations unmet and was extended. `combined`: its kind's pool, null when not pooled. */
  | { kind: "decayExtended"; plantId: number; kindId: KindId; row: number; col: number;
      mutatesRemaining: number | "infinite" | null; combined: number | "infinite" | null }
  /** Water reached HALT_WATER: no growth, no effects given, not counted, until watered. */
  | { kind: "driedOut"; plantId: number; kindId: KindId; row: number; col: number }
  | { kind: "harvested"; plantId: number; kindId: KindId; row: number; col: number; origin: Origin;
      drops: Record<ItemId, number>; coinValue: number; rival: boolean }
  | { kind: "spawned"; plantId: number; mutationId: MutationId; row: number; col: number; rival: boolean; slotTarget: MutationId | null }
  | { kind: "placed"; plantId: number; kindId: KindId; row: number; col: number; origin: Origin; replacement: boolean }
  | { kind: "removed"; plantId: number; kindId: KindId; row: number; col: number; reason: string }
  /** The player restored the ground under an empty target cell to what its mutation needs. */
  | { kind: "groundFixed"; row: number; col: number; from: string | null; to: string; mutationId: MutationId }
  | { kind: "destroyed"; plantId: number; kindId: KindId; row: number; col: number; by: string }
  | { kind: "teleported"; plantId: number; kindId: KindId; fromRow: number; fromCol: number; row: number; col: number }
  | { kind: "debt"; item: ItemId; row: number; col: number; needed: number; available: number }
  | { kind: "stepChanged"; fromStep: string; toStep: string; stepIndex: number }
  | { kind: "playerSession" };

export type TickEventKind = TickEvent["kind"];

export type TimedEvent = TickEvent & { cycle: number; plotId: PlotId };

export type RetainEvents = "all" | "summary" | "none";

export interface RunOptions {
  /** 'all' = every event; 'summary' = only the last cycle's events; 'none' = aggregates only. */
  retainEvents?: RetainEvents;
  onProgress?: (p: { cycle: number; done: number; total: number; summary: RunSummary }) => void;
  /** Minimum wall-clock gap between progress callbacks. */
  progressIntervalMs?: number;
  signal?: AbortSignal;
}

export interface BatchResult {
  /** Feed straight back into run() to continue. */
  state: SimulationState;
  events: TimedEvent[];
  eventCounts: Partial<Record<TickEventKind, number>>;
  cyclesRun: number;
  /** True if the call stopped early (abort). */
  truncated: boolean;
  /** Cumulative as of the end of this call, not a delta. */
  summary: RunSummary;
}
