import { newRunner } from "../flow/runner";
import { ScenarioError, validateScenario } from "../flow/validate";
import { seedRng } from "../rng";
import { countUniqueCropGroups, cycleSeconds } from "../growth/clock";
import { newScratch, type Env } from "./context";
import { makeCycleCtx } from "./cycle";
import { convertAloeFragments, ledgerRow } from "./inventory";
import { applyStepLayout } from "./placement";
import { zeroSummary } from "./summary";
import type { PlotState, Scenario, SimulationState, TimedEvent } from "./state";

/** Base crops standing on any plot - the shared unique-crop count. */
export function uniqueCropsAcross(state: SimulationState, env: Env): number {
  const kinds = new Set<string>();
  for (const plot of state.plots) {
    for (const p of plot.plants) if (p.origin === "planted" && !p.isDeadPlant) kinds.add(p.kindId);
  }
  return countUniqueCropGroups(kinds, env.data);
}

/**
 * Build the starting state from a scenario. The player's setup session
 * happens here: every plot's starting step is laid out exactly as entered.
 * Setup is free and always succeeds - the starting inventory is only drawn on
 * once the run has to re-place something or a later step lays out.
 */
export function initState(env: Env, scenario: Scenario): { state: SimulationState; events: TimedEvent[] } {
  const issues = validateScenario(scenario, env.data);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new ScenarioError(errors);

  const input: Scenario = structuredClone(scenario);
  const plots: PlotState[] = input.plots.map((p) => ({
    id: p.id,
    plants: [],
    slots: [],
    groundTiles: {},
    groundOverrides: {},
    slotIneligibleCycles: {},
    watchStatus: {},
  }));

  const state: SimulationState = {
    version: 1,
    scenario: input,
    cycle: 0,
    elapsedSeconds: 0,
    rng: seedRng(input.settings.seed),
    plots,
    flows: input.plots.map((p) => newRunner(p, 0)),
    inventory: { ...input.startingInventory },
    ledger: {},
    debts: [],
    openDebts: {},
    uptime: {},
    summary: zeroSummary(input.plots.map((p) => p.id)),
    nextPlantId: 1,
    uniqueCropCount: 0,
    lastCycleSeconds: input.settings.config.cycleBaselineSeconds,
    lastCycleActive: true,
  };
  for (const item of Object.keys(state.inventory)) ledgerRow(state, item);
  convertAloeFragments(state);

  const events: TimedEvent[] = [];
  const ctx = makeCycleCtx(
    env,
    state,
    { cycle: 0, active: true, cycleSeconds: state.lastCycleSeconds, firesAt: 0, uniqueCropCount: 0 },
    events
  );
  for (const id of input.settings.config.plotOrder) {
    const plot = state.plots.find((p) => p.id === id);
    if (!plot) continue;
    applyStepLayout(plot, ctx.layoutFor(id), ctx, newScratch(), true, "setup");
  }

  state.uniqueCropCount = uniqueCropsAcross(state, env);
  state.lastCycleSeconds = cycleSeconds(input.settings.playerStats, state.uniqueCropCount, input.settings.config.cycleBaselineSeconds);
  return { state, events };
}
