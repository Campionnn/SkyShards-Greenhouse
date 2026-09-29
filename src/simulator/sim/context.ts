import type { SimConfig } from "../config";
import type { GameData, KindId, Size } from "../data/types";
import type { PriceSource } from "../economy/prices";
import type { Policies, StageLayout } from "../flow/types";
import type { TickScratch } from "./harvest";
import type { PlayerStats, PlotId, PlotState, SimulationState, SlotLabel, TickEvent } from "./state";

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
  emit(plotId: PlotId, event: TickEvent): void;
  /** Policies in force for a plot this cycle (scenario, then plot, then stage overrides). */
  policiesFor(plotId: PlotId): Policies;
  /** The current stage's layout for a plot. */
  layoutFor(plotId: PlotId): ResolvedLayout;
  /** Called at the start of a plot's player session; applies a pending stage change. */
  onPlayerSession(plot: PlotState, scratch: TickScratch): void;
  /** Cycles until the player is next active (>= 1, or Infinity). */
  cyclesUntilNextActive(): number;
}
