/**
 * Types for the player-facing Rose Dragon Guide.
 *
 * The Guide turns "what I own + where each plot is" into the shipped flow's own decision for that
 * exact situation, by running each plot script's `onStart` hook in a zero-time projection. A real
 * login visits Plot 1, then 2, then 3 against one shared inventory, so the projection does the same:
 * each plot decides against the stock the plots before it left behind. Monte Carlo is used only for
 * the forecast (how long, how many Dead Plants / Fermento, which farms come next).
 */
import type { Settings } from "../simulator/sim/state";

export type PlotId = number;

/** One grid cell, matching the script API's `{ row, col }` shape. */
export interface Cell {
  row: number;
  col: number;
}

/** A target mutation the player says is standing on one of the farm's target cells. */
export interface StandingPlant extends Cell {
  /** Mutation id (`"glasscorn"`, `"magic_jellybean"`, ...). */
  kind: string;
  /** Growth stage, as shown by the game. */
  stage: number;
  /** The player's "it is fully grown" answer. */
  fullyGrown: boolean;
}

/**
 * What the player reported about the farm in front of them. Every cell is a real layout anchor
 * picked on the farm picture, so a fact always lands on the plant it describes.
 */
export interface PlotFacts {
  /** Anchors of paid layout inputs that are gone (decayed, blown up, eaten by roots, ...). */
  missing: Cell[];
  /** Targets standing on their target cells. */
  standing: StandingPlant[];
  /** The Devourer farm was harvested or lost a plant since it was built. */
  devourerRefresh: boolean;
}

/**
 * One plot in a check-in.
 *
 * `facts` undefined means the player has not looked: the projection then assumes the farm is
 * complete with nothing growing, and the UI says so. `acted` means the player already did this
 * plot during the current check-in, so it is not decided again (re-running a plot that already
 * spent stock this login is exactly the double-spend the Guide must avoid).
 */
export interface PlotInput {
  farm: string;
  facts?: PlotFacts;
  acted?: boolean;
  /** The facts were reported at an earlier visit: still used, but the card asks to check them. */
  factsFromEarlier?: boolean;
}

/** Script memory the Guide carries between check-ins (the flow's `shared.builtOnce`). */
export interface GuideMemory {
  builtOnce: Record<string, number>;
}

/** Everything a projection or forecast needs. */
export interface GuideInput {
  inventory: Record<string, number>;
  plots: Record<PlotId, PlotInput>;
  settings: Settings;
  memory?: GuideMemory;
}

export interface ItemCount {
  item: string;
  count: number;
}

/** A product still holding a plot: the script needs it and it is below its high mark. */
export interface WaitFor {
  item: string;
  /** How many the player has now. */
  have: number;
  /** The mark the script is working toward. */
  target: number;
}

/**
 * What the script decided for a plot.
 * - enter: move to another farm (`to`). `to === "hub"` means clear to empty farmland and wait;
 *   `to === "supplies"` means the plot is blocked on Dead Plants / Fermento.
 * - stay: keep the farm (re-placing what is missing when the stock covers it).
 * - refresh: rebuild the same farm (Devourer after a harvest or lost ring input).
 * - done: every goal item is owned.
 */
export type PlotAction = "enter" | "stay" | "refresh" | "done";

export interface PlacedCell extends Cell {
  kind: string;
  /** Taken from the inventory (false: a free base crop or fire). */
  paid: boolean;
}

/** One plot's projected session. */
export interface PlotOutcome {
  plotId: PlotId;
  from: string;
  to: string;
  action: PlotAction;
  /** The script's machine reason (`idle`, `satisfied commons`, `working rares`, ...). */
  why: string;
  waitFor: WaitFor[];
  /** Paid inputs still missing after the session (the stock could not cover them). */
  short: ItemCount[];
  /** Their anchors: the next check-in starts with these marked missing. */
  shortCells: Cell[];
  /** Paid items placed this session, by item. Deterministic: this is what confirming subtracts. */
  spent: ItemCount[];
  /** Exact cells of everything placed this session (paid and free). */
  placedCells: PlacedCell[];
  /** Spawned targets the script harvested this session (Jellybeans, Aloe, Shellfruit), as plants. */
  harvested: ItemCount[];
  /**
   * Items those harvests are guaranteed to give that this same session placed again (e.g. popped
   * Shellfruit placed straight into Phantomleaf + Timestalk). Confirming credits these before
   * subtracting `spent`, so a placement paid for by this visit's own harvest isn't lost.
   */
  selfFunded: ItemCount[];
  /** Fully grown targets the player reported, which should be harvested this visit. */
  harvestReady: ItemCount[];
  /** Inventory before and after this plot's session, in the projected login. */
  inventoryBefore: Record<string, number>;
  inventoryAfter: Record<string, number>;
  /** `shared.builtOnce` after this plot's session (memory for the next check-in). */
  builtOnce: Record<string, number>;
  /** When `to` is the supplies step or empty farmland: the farm more Dead Plants / Fermento would start, and how many more. */
  supplyBlock?: { farm: string; need: ItemCount[] };
}

/** One farm visit in a simulated run. */
export interface Visit {
  plotId: PlotId;
  farm: string;
  startCycle: number;
  cycles: number;
  startSeconds: number;
  seconds: number;
}

/** One simulated run of a check-in. */
export interface RunTimeline {
  seed: number;
  visits: Visit[];
  /** Each plot's farm sequence, for the medoid comparison. */
  farms: Record<PlotId, string[]>;
  cycles: number;
  elapsedSeconds: number;
  logins: number;
  done: boolean;
  debtEvents: number;
  /** Stock of each supply (Dead Plant, Fermento) the run needed from the start (owned minus its lowest point). */
  supplyNeed: Record<string, number>;
  /** Seconds into the run when each supply first ran out (null: never). */
  supplyShortAt: Record<string, number | null>;
}

export interface Spread {
  median: number;
  p10: number;
  p90: number;
}

/** A row of the reconciled supplies list. */
export interface SupplyRow {
  item: string;
  /** Stock the forecast needed to own from the start (90th percentile of the runs). */
  needed: number;
  owned: number;
  /** How many more to farm on top of what is owned (0 when covered). */
  more: number;
  /** Typical seconds until the owned stock runs out (null when it lasts). */
  shortIn: number | null;
}

/** The aggregated forecast. */
export interface Forecast {
  seeds: number;
  completed: number;
  /** Null when no run finished: a capped run is not a completion time. */
  seconds: Spread | null;
  logins: Spread | null;
  supplies: SupplyRow[];
  medoidSeed: number;
}

/** One lane segment of the plan timeline, taken from the medoid run. */
export interface PlanSegment {
  plotId: PlotId;
  farm: string;
  startSeconds: number;
  seconds: number;
  /** Share of runs that visit this farm on this plot at all. */
  share: number;
}

export interface Plan {
  medoidSeed: number;
  totalSeconds: number;
  lanes: Record<PlotId, PlanSegment[]>;
}
