import type { EffectSimulation } from "../../utilities/effectSimulation";
import type { SimConfig } from "../config";
import type { GameData, KindId, Size } from "../data/types";
import type { PriceSource } from "../economy/prices";
import type { EffectsKey, EffectsMemo, ForcedEffects } from "../effects/adapter";
import type { FlowStep, Policies, StepLayout } from "../flow/types";
import type { ScriptRuntime } from "../script/runtime";
import type { CycleProbe } from "./stops";
import type { EffortKind, FlowRunnerState, PlayerStats, PlotId, PlotState, ScenarioPlot, SimulationState, SlotLabel, TickEvent } from "./state";

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
  /**
   * TEST ONLY: water loss per cycle instead of `WATER_LOSS_PER_CYCLE` (`createEngine(data,
   * { waterLossPerCycle })`, testHelpers `NO_WATER_LOSS`). The app never sets it.
   */
  waterLossPerCycle?: number;
}

/** Per-plot, per-cycle scratch shared by tick and player phases. Never stored in state, so Sets are fine. */
export interface TickScratch {
  /** Plant ids with `stage < readyStage` when growth reached them (before advancing); the water phase drains these. */
  notFullyGrown: Set<number>;
  /** The effect simulation from the `effects` phase (Godseed eligibility at spawn). */
  effects: EffectSimulation | null;
  /** Plot fingerprint (`effectsKey`) `effects` and every `held` were computed for; null = unknown. */
  effectsKey: EffectsKey | null;
  /** Recent effect computations of this plot (effects/adapter.ts), reused when a layout comes back. */
  effectsHistory?: EffectsMemo[];
  /** The player session moved this plot to a new step this cycle. */
  stepChanged: boolean;
  /** Debug forced effects (script/overrides.ts `forcedEffectsOf`): added to every matching plant's `held`. */
  forcedEffects?: ForcedEffects;
  /** Effort (sim/effort.ts): this plot's watering is already counted this session. */
  effortWatered?: boolean;
  /** Effort (sim/effort.ts): plants the player put down this session, by id, and the action counted for it. */
  effortPlaced?: Map<number, { kind: EffortKind; w: number }>;
}

export const newScratch = (forced?: ForcedEffects): TickScratch => ({
  notFullyGrown: new Set(),
  effects: null,
  effectsKey: null,
  stepChanged: false,
  ...(forced && Object.keys(forced).length ? { forcedEffects: forced } : {}),
});

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
  /** Effort (sim/effort.ts): a Noctilume time change is already counted this session (all plots). */
  effortNoctilume?: boolean;
  /**
   * Stop points (sim/stops.ts): set only when run() was given `RunOptions.probe` (stepping inside a
   * cycle). Absent in every normal run; each call site is guarded by `if (ctx.probe)`. Read only.
   */
  probe?: CycleProbe;
}

/** One named step of `TICK_PHASES` (sim/tick.ts) or, on active cycles, `PLAYER_PHASES` (sim/player.ts). */
export interface Phase {
  id: string;
  /** One-line description for docs and tests; unused by the engine. */
  summary: string;
  run(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void;
}
