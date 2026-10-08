import type { EffectSimulation } from "../../utilities/effectSimulation";
import type { SimConfig } from "../config";
import type { GameData, KindId, Size } from "../data/types";
import type { PriceSource } from "../economy/prices";
import type { FlowStep, Policies, StepLayout } from "../flow/types";
import type { ScriptRuntime } from "../script/runtime";
import type { FlowRunnerState, PlayerStats, PlotId, PlotState, ScenarioPlot, SimulationState, SlotLabel, TickEvent } from "./state";

/** A step layout resolved against game data: sizes filled in, origin decided. */
export interface ResolvedLayout {
  /** Sorted by anchor (row, col). */
  plants: { kindId: KindId; row: number; col: number; size: Size; origin: "planted" | "placed" }[];
  slots: SlotLabel[];
  /** Painted ground plus ground inferred from target footprints. */
  groundTiles: Record<string, string>;
}

/** Per-engine, immutable. */
export interface Env {
  data: GameData;
  resolveLayout(layout: StepLayout): ResolvedLayout;
}

/** Per-plot, per-cycle scratch shared by tick and player phases. Never stored in state, so Sets are fine. */
export interface TickScratch {
  /** Plant ids with `stage < readyStage` when growth reached them (before advancing); the water phase drains these. */
  notFullyGrown: Set<number>;
  /** The effect simulation from the `effects` phase (Godseed eligibility at spawn). */
  effects: EffectSimulation | null;
  /** The player session moved this plot to a new step this cycle. */
  stepChanged: boolean;
}

export const newScratch = (): TickScratch => ({ notFullyGrown: new Set(), effects: null, stepChanged: false });

/**
 * Per-cycle context. `state` is the run's working copy; a plot's phases touch
 * only that plot plus the shared inventory, ledger and summary.
 */
export interface CycleCtx {
  env: Env;
  state: SimulationState;
  config: SimConfig;
  stats: PlayerStats;
  prices: PriceSource;
  cycle: number;
  active: boolean;
  cycleSeconds: number;
  /** Simulated time (s) at which this cycle fires. */
  firesAt: number;
  uniqueCropCount: number;
  /** Record an event; also feeds the plot's in-step trigger counters. */
  emit(plotId: PlotId, event: TickEvent): void;
  /** Merged policies: scenario, then plot, then step overrides. */
  policiesFor(plotId: PlotId): Policies;
  layoutFor(plotId: PlotId): ResolvedLayout;
  stepFor(plotId: PlotId): FlowStep;
  flowFor(plotId: PlotId): { def: ScenarioPlot; runner: FlowRunnerState };
  /** Cycles until the player is next active (>= 1, or Infinity). */
  cyclesUntilNextActive(): number;
  /** The scenario's scripts (src/simulator/script), or null when it has none. */
  scripts: ScriptRuntime | null;
}

/** One named step of `TICK_PHASES` (sim/tick.ts) or, on active cycles, `PLAYER_PHASES` (sim/player.ts). */
export interface Phase {
  id: string;
  /** One-line description for docs and tests; unused by the engine. */
  summary: string;
  run(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void;
}
