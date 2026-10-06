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
  /**
   * Collected in total since the run started: starting inventory + everything produced
   * (harvests, conversions, cleared Dead Plants) + items added mid-run. Spending never
   * lowers it, so it reads the same whichever plot uses the items, and when.
   */
  | { kind: "collectedAtLeast"; item: ItemId; qty: number }
  /**
   * The inventory can't fill what this step's layout is missing: for some placed item
   * (mutation, fermento, dead plant; not base crops or fire), more cells lack it than the
   * inventory holds. Checked on arrival it reads "can't build this layout".
   */
  | { kind: "layoutShort" }
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
   * Every plant of this mutation on the plot (Dead Plants excluded) is at growth
   * stage `stage` or higher. Needs at least one such plant to hold.
   */
  | { kind: "lowestStageAtLeast"; mutationId: MutationId; stage: number }
  /**
   * The exact complement of `lowestStageAtLeast`: some plant of this mutation is
   * below growth stage `stage`, or there is none on the plot.
   */
  | { kind: "lowestStageBelow"; mutationId: MutationId; stage: number }
  /** Some plant of this mutation on the plot (Dead Plants excluded) is at growth stage `stage` or higher. */
  | { kind: "highestStageAtLeast"; mutationId: MutationId; stage: number }
  /**
   * The exact complement of `highestStageAtLeast`: every plant of this mutation is
   * below growth stage `stage`, or there is none on the plot.
   */
  | { kind: "highestStageBelow"; mutationId: MutationId; stage: number }
  /**
   * Target slots of this step's layout holding their labelled mutation
   * (growing or fully grown). count 0 = every target; otherwise at least `count`.
   */
  | { kind: "targetsFilled"; count: number }
  /**
   * The plot has entered the current step at least `count` times (this visit
   * included) since it last entered step `sinceStep`, or since the run start.
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
 * One way out of a step: "go to `to` when `when` holds". A step's exits are
 * checked in order; the first whose conditions hold wins.
 */
export interface StepExit {
  when: Condition[];
  /** How `when` combines (default "all"). An empty `when` never holds. */
  match?: ConditionMatch;
  /**
   * Target step id. Omitted = the following step; past the end, step 0 if the
   * flow loops, else the plot holds this final step. May name the current step
   * (re-enters it: layout re-applied, counters reset).
   */
  to?: string;
  /**
   * Also check this exit when the plot arrives at its step, before the step's
   * layout is built: if it already holds, the plot goes straight on to `to`
   * and this step is skipped (no layout, no cycle spent in it). Chains through
   * further steps' on-arrival exits.
   */
  checkOnEntry?: boolean;
}

export type SpawnedHarvestPolicy = "whenFullyGrown" | "beforeDecay" | "never";
/**
 * A natural spawn used as a layout input (hybrid flows, `spawnsFillLayoutInputs`):
 * - keep: leave it; harvested when a step change clears it (if fully grown) or just before decay.
 * - harvest: follow spawnedHarvest; the input is then re-placed from inventory.
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
   * Restore the ground under empty target footprints that no longer matches
   * the target (e.g. Chorus Fruit End Stone). Missing = on.
   */
  fixGround?: boolean;
  /**
   * Break natural spawns of another kind standing on the current step's target cells
   * (harvested if fully grown), e.g. leftovers from the previous step. Missing = on.
   */
  clearTargetBlockers?: boolean;
}

export type PolicyOverrides = Partial<Omit<Policies, "gateInteractions">> & {
  gateInteractions?: Partial<Policies["gateInteractions"]>;
};

export interface FlowStep {
  id: string;
  label?: string;
  layout: StepLayout;
  /** Ways out of this step, checked in order; the first that holds wins. Empty = the plot stays. */
  exits: StepExit[];
  policies?: PolicyOverrides;
  /** Break every plant on entry instead of keeping identical ones. */
  fullClear?: boolean;
  /** Slot anchor keys ("row,col") whose uptime is recorded. Omitted = all targets; [] = none. */
  watch?: string[];
}

/** One plot's flow. Steps run in order unless an exit names another step; never references another plot. */
export interface Flow {
  steps: FlowStep[];
  loop: boolean;
  /** Step the plot starts on. */
  startIndex: number;
}
