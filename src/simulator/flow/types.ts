import type { ItemId, KindId, MutationId, Size } from "../data/types";

/** What a plot looks like during one step: standing plants plus labelled empty target cells. */
export interface LayoutSpec {
  /** Lowercase share-code cells: plants physically placed here. */
  plants: { kindId: KindId; row: number; col: number; size?: Size }[];
  /** Uppercase share-code cells: EMPTY cells where a mutation is expected to spawn. Nothing is placed. */
  slots: { mutationId: MutationId; row: number; col: number; size?: Size }[];
  /** Explicitly painted ground; unpainted cells outside plant/target footprints are AIR. */
  groundTiles?: { ground: string; row: number; col: number }[];
}

/** A step's layout: a share code (the normal form) or an explicit spec (tests, imports). */
export type StepLayout = { code: string } | LayoutSpec;

/** One leaf condition. Combine them with `ConditionGroup` (AND / OR) in a `Condition` list. */
export type Trigger =
  | { kind: "cycles"; n: number }
  | { kind: "inventoryAtLeast"; item: ItemId; qty: number }
  | { kind: "inventoryBelow"; item: ItemId; qty: number }
  | { kind: "allFullyGrown" }
  | { kind: "noneFullyGrown" }
  /** At least `count` (default 1) natural spawns of this mutation stand fully grown on the plot. */
  | { kind: "fullyGrown"; mutationId: MutationId; count?: number }
  | { kind: "decayImminent"; withinCycles: number }
  | { kind: "plantDecayed"; kindId: KindId }
  | { kind: "mutationSpawned"; mutationId: MutationId; count: number }
  /** Natural spawns of this mutation harvested on this plot since entering the step. */
  | { kind: "mutationHarvested"; mutationId: MutationId; count: number }
  /**
   * Target slots of this step's layout holding their labelled mutation
   * (growing or fully grown). count 0 = every target; otherwise at least `count`.
   */
  | { kind: "targetsFilled"; count: number }
  /**
   * The plot has entered the current step at least `count` times (this visit
   * included), counted since it last entered `sinceStep` (a step id), or
   * since the run started when that is omitted. "Every 3rd time through
   * step 2, go to step 3" = a route on step 2 with stepVisits(3, since step 3).
   */
  | { kind: "stepVisits"; count: number; sinceStep?: string };

export type TriggerKind = Trigger["kind"];

/** How a condition list combines its entries: every one (AND) or at least one (OR). */
export type ConditionMatch = "all" | "any";

/** A nested AND / OR group. An empty group never holds. */
export interface ConditionGroup {
  kind: "group";
  match: ConditionMatch;
  of: Condition[];
}

export type Condition = Trigger | ConditionGroup;

/**
 * A conditional jump to a chosen step. A step's routes are checked in order
 * before its normal exit; the first whose conditions hold wins.
 */
export interface StepRoute {
  /** Target step id. */
  to: string;
  when: Condition[];
  /** How `when` combines (default "all"). An empty `when` never holds. */
  match?: ConditionMatch;
}

export type SpawnedHarvestPolicy = "whenFullyGrown" | "beforeDecay" | "never";
/**
 * A natural spawn standing in as a layout input (hybrid flows, see
 * `spawnsFillLayoutInputs`):
 * - keep: leave it standing while the layout uses it; it is harvested when a
 *   step change clears it (if fully grown), or just before it would decay.
 * - harvest: treat it like any other spawn (spawnedHarvest); the layout
 *   input is then re-placed from inventory.
 */
export type LayoutInputSpawnPolicy = "keep" | "harvest";
export type BaseCropUpkeepPolicy = "leaveUntilDecay" | "harvestWhenGrown" | "harvestBeforeDecay";
export type WateringPolicy = "toMax" | "never";

/** What the player does during an active session. Scenario default, then per plot, then per step. */
export interface Policies {
  spawnedHarvest: SpawnedHarvestPolicy;
  /** Natural spawns the current layout uses as inputs (hybrid flows). */
  layoutInputSpawns: LayoutInputSpawnPolicy;
  baseCropUpkeep: BaseCropUpkeepPolicy;
  watering: WateringPolicy;
  gateInteractions: {
    wakeSnoozling: boolean;
    vacuumRat: boolean;
    /** Discharge Thunderlings (charge back to 0) each session. */
    dischargeThunderling: boolean;
    noctilumeTime: boolean;
    feedFleshtrap: boolean;
    /** Break Devourer roots. */
    clearRoots: boolean;
  };
  /** Clear Dead Plants and re-place missing layout plants from inventory. */
  replaceDecayed: boolean;
  /**
   * Restore the ground under empty target footprints when it no longer matches
   * the target mutation (e.g. Chorus Fruit left End Stone on a slot).
   * Optional so policies saved before it existed still load (missing = on).
   */
  fixGround?: boolean;
}

export type PolicyOverrides = Partial<Omit<Policies, "gateInteractions">> & {
  gateInteractions?: Partial<Policies["gateInteractions"]>;
};

export interface FlowStep {
  id: string;
  label?: string;
  layout: StepLayout;
  /** The normal exit's conditions (combined per `exitMatch`). An empty list never exits. */
  exit: Condition[];
  /** How `exit` combines (default "all", AND). */
  exitMatch?: ConditionMatch;
  /**
   * Step id the normal exit goes to. Omitted = the following step (or the
   * first step on a looping flow; a non-looping flow holds its last step).
   */
  next?: string;
  /** Conditional jumps to chosen steps, checked in order before the normal exit. */
  routes?: StepRoute[];
  policies?: PolicyOverrides;
  /** Break every plant on entry instead of keeping identical ones. */
  fullClear?: boolean;
  /**
   * Target cells whose uptime the sustainability check records, as slot
   * anchor keys ("row,col"). Omitted = every target in the layout; [] = none.
   */
  watch?: string[];
}

/**
 * One plot's flow. Steps run in order unless a step's `next` or
 * `routes` send the plot elsewhere; they never reference another plot.
 */
export interface Flow {
  steps: FlowStep[];
  loop: boolean;
  /** Step the plot starts on; lets a user offset plots deliberately. */
  startIndex: number;
}
