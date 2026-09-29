import { analyseSustainability } from "./analysis/sustainability";
import { defaultGameData } from "./data/default";
import type { GameData } from "./data/types";
import { createLayoutResolver } from "./flow/layout";
import { validateScenario } from "./flow/validate";
import type { Env } from "./sim/context";
import { initState } from "./sim/init";
import { injectItems } from "./sim/inventory";
import { run } from "./sim/run";
import type { BatchResult, RunOptions, Scenario, SimulationState } from "./sim/state";

/**
 * The simulator over one immutable data set. It evaluates the scenario it is
 * given - it never generates, ranks, compares or repairs layouts.
 */
export function createEngine(data: GameData = defaultGameData()) {
  const env: Env = { data, resolveLayout: createLayoutResolver(data) };
  return {
    data,
    validate: (scenario: Scenario) => validateScenario(scenario, data),
    /** Starting state (the setup session has already laid every plot out). */
    initState: (scenario: Scenario) => initState(env, scenario),
    /** Advance `ticks` cycles. `run(state, 1)` is a step. */
    run: (state: SimulationState, ticks: number, opts?: RunOptions): BatchResult => run(env, state, ticks, opts),
    analyse: (state: SimulationState) => analyseSustainability(state, data),
    /** Add (or remove, negative) items in a live run's inventory. Returns a new state; time does not move. */
    addItems: (state: SimulationState, items: Record<string, number>) => injectItems(state, items),
  };
}

export type Engine = ReturnType<typeof createEngine>;
