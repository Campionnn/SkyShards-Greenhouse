import { analyseSustainability } from "./analysis/sustainability";
import { defaultGameData } from "./data/default";
import type { GameData } from "./data/types";
import { createLayoutResolver } from "./flow/layout";
import { validateScenario } from "./flow/validate";
import type { Env } from "./sim/context";
import { initState } from "./sim/init";
import { injectItems } from "./sim/inventory";
import { replayCycle } from "./sim/replay";
import { run } from "./sim/run";
import type { StopPoint } from "./sim/stops";
import type { BatchResult, RunOptions, Scenario, SimulationState } from "./sim/state";

/** Test-only engine options; the app never passes any. */
export interface EngineTestOptions {
  /** Water lost per cycle instead of `WATER_LOSS_PER_CYCLE` (0 = no water loss). */
  waterLossPerCycle?: number;
}

/** Simulator over one immutable data set. Evaluates scenarios only; never generates or ranks layouts. */
export function createEngine(data: GameData = defaultGameData(), testOptions: EngineTestOptions = {}) {
  const env: Env = { data, resolveLayout: createLayoutResolver(data) };
  if (testOptions.waterLossPerCycle !== undefined) env.waterLossPerCycle = testOptions.waterLossPerCycle;
  return {
    data,
    validate: (scenario: Scenario) => validateScenario(scenario, data),
    /** Starting state, after the setup session has laid out every plot. */
    initState: (scenario: Scenario) => initState(env, scenario),
    /** Advance `ticks` cycles. `run(state, 1)` is a step. */
    run: (state: SimulationState, ticks: number, opts?: RunOptions): BatchResult => run(env, state, ticks, opts),
    /**
     * Stepping inside a cycle: replay the cycle starting at `state` and list its stop points,
     * copying the state at the first one `pick` accepts (sim/replay.ts). Never moves time.
     */
    replayCycle: (state: SimulationState, pick?: (stop: StopPoint, ordinal: number) => boolean) => replayCycle(env, state, pick),
    analyse: (state: SimulationState) => analyseSustainability(state, data),
    /** Add (negative: remove) inventory items. Returns a new state; time does not move. */
    addItems: (state: SimulationState, items: Record<string, number>) => injectItems(state, items),
  };
}

export type Engine = ReturnType<typeof createEngine>;
