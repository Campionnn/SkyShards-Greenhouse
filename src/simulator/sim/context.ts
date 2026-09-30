import type { EffectSimulation } from "../../utilities/effectSimulation";
import type { SimConfig } from "../config";
import type { GameData, KindId, Size } from "../data/types";
import type { PriceSource } from "../economy/prices";
import type { FlowStage, Policies, StageLayout } from "../flow/types";
import type { FlowRunnerState, PlayerStats, PlotId, PlotState, ScenarioPlot, SimulationState, SlotLabel, TickEvent } from "./state";

/** A stage layout resolved against game data: sizes filled in, origin decided. */
export interface ResolvedLayout {
  /** Sorted by anchor (row, col). */
  plants: { kindId: KindId; row: number; col: number; size: Size; origin: "planted" | "placed" }[];
  slots: SlotLabel[];
  /** Explicit painted bare ground plus automatically inferred target-footprint ground. */
  groundTiles: Record<string, string>;
}

/** Per-engine, immutable. */
export interface Env {
  data: GameData;
  resolveLayout(layout: StageLayout): ResolvedLayout;
}

/**
 * Per-plot, per-cycle scratch space shared by that plot's sub-steps (both
 * the game tick and the player session). Built fresh every cycle and never
 * stored in state, so it may hold Sets and objects.
 */
export interface TickScratch {
  /** Plants that advanced a stage this cycle (water loss). */
  advanced: Set<number>;
  /** The effect simulation from the `effects` sub-step (Godseed eligibility at spawn). */
  effects: EffectSimulation | null;
  /** The player session moved this plot to a new stage this cycle. */
  stageChanged: boolean;
}

export const newScratch = (): TickScratch => ({ advanced: new Set(), effects: null, stageChanged: false });

/**
 * Everything one cycle needs besides the plot itself. `state` is the run's
 * working copy: a tick touches only its own plot plus the shared inventory,
 * ledger and summary (the only channels between plots).
 */
export interface CycleCtx {
  env: Env;
  state: SimulationState;
  config: SimConfig;
  stats: PlayerStats;
  prices: PriceSource;
  cycle: number;
  active: boolean;
  stageSeconds: number;
  /** Simulated time (s) at which this cycle fires. */
  firesAt: number;
  uniqueCropCount: number;
  /** Record an event. spawned / decayed / harvested also feed the plot's in-stage trigger counters. */
  emit(plotId: PlotId, event: TickEvent): void;
  /** Policies in force for a plot right now (scenario, then plot, then stage overrides). */
  policiesFor(plotId: PlotId): Policies;
  /** The current stage's layout for a plot. */
  layoutFor(plotId: PlotId): ResolvedLayout;
  /** The current stage of a plot's rotation. */
  stageFor(plotId: PlotId): FlowStage;
  /** A plot's rotation definition and its runner. */
  flowFor(plotId: PlotId): { def: ScenarioPlot; runner: FlowRunnerState };
  /** Cycles until the player is next active (>= 1, or Infinity). */
  cyclesUntilNextActive(): number;
}

/**
 * One named sub-step of a cycle. A cycle is two ordered lists of these:
 * the game tick (`TICK_STEPS`, sim/tick.ts), which happens instantly for
 * every plot, then - on active cycles only - the player session
 * (`PLAYER_STEPS`, sim/player.ts), which stands for everything the player
 * does at some point during the cycle. Reorder, add or remove behaviour by
 * editing those lists.
 */
export interface SubStep {
  id: string;
  /** One line: what it does. Shown in docs and tests, not in the engine. */
  summary: string;
  run(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void;
}
