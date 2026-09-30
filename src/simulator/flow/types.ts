import type { ItemId, KindId, MutationId, Size } from "../data/types";

/** What a plot looks like during one stage: standing plants plus labelled empty target cells. */
export interface LayoutSpec {
  /** Lowercase share-code cells: plants physically placed here. */
  plants: { kindId: KindId; row: number; col: number; size?: Size }[];
  /** Uppercase share-code cells: EMPTY cells where a mutation is expected to spawn. Nothing is placed. */
  slots: { mutationId: MutationId; row: number; col: number; size?: Size }[];
  /** Explicitly painted ground; unpainted cells outside plant/target footprints are AIR. */
  groundTiles?: { ground: string; row: number; col: number }[];
}

/** A stage's layout: a share code (the normal form) or an explicit spec (tests, imports). */
export type StageLayout = { code: string } | LayoutSpec;

/** Leave a stage when ALL of its triggers hold (AND). An empty list never exits. */
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
  /** Natural spawns of this mutation harvested on this plot since entering the stage. */
  | { kind: "mutationHarvested"; mutationId: MutationId; count: number }
  /**
   * Target slots of this stage's layout holding their labelled mutation
   * (growing or fully grown). count 0 = every target; otherwise at least `count`.
   */
  | { kind: "targetsFilled"; count: number };

export type TriggerKind = Trigger["kind"];

export type SpawnedHarvestPolicy = "whenFullyGrown" | "beforeDecay" | "never";
/**
 * A natural spawn standing in as a layout input (hybrid rotations, see
 * `spawnsFillLayoutInputs`):
 * - keep: leave it standing while the layout uses it; it is harvested when a
 *   stage change clears it (if fully grown), or just before it would decay.
 * - harvest: treat it like any other spawn (spawnedHarvest); the layout
 *   input is then re-placed from inventory.
 */
export type LayoutInputSpawnPolicy = "keep" | "harvest";
export type BaseCropUpkeepPolicy = "leaveUntilDecay" | "harvestWhenGrown" | "harvestBeforeDecay";
export type WateringPolicy = "toMax" | "never";

/** What the player does during an active session. Scenario default, then per plot, then per stage. */
export interface Policies {
  spawnedHarvest: SpawnedHarvestPolicy;
  /** Natural spawns the current layout uses as inputs (hybrid rotations). */
  layoutInputSpawns: LayoutInputSpawnPolicy;
  baseCropUpkeep: BaseCropUpkeepPolicy;
  watering: WateringPolicy;
  gateInteractions: {
    wakeSnoozling: boolean;
    vacuumRat: boolean;
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

export interface FlowStage {
  id: string;
  label?: string;
  layout: StageLayout;
  exit: Trigger[];
  policies?: PolicyOverrides;
  /** Break every plant on entry instead of keeping identical ones. */
  fullClear?: boolean;
  /**
   * Target cells whose uptime the sustainability check records, as slot
   * anchor keys ("row,col"). Omitted = every target in the layout; [] = none.
   */
  watch?: string[];
}

/** One plot's rotation. Stages are sequential within this plot only. */
export interface Flow {
  stages: FlowStage[];
  loop: boolean;
  /** Stage the plot starts on; lets a user offset plots deliberately. */
  startIndex: number;
}
