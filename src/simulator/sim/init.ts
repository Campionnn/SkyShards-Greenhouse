import { CYCLE_BASELINE_SECONDS } from "../config";
import { newRunner } from "../flow/runner";
import { ScenarioError, validateScenario } from "../flow/validate";
import { seedRng } from "../rng";
import { countUniqueCropGroups, cycleSeconds, effectiveUniqueCrops } from "../growth/clock";
import { scenarioUsesScripts } from "../script/overrides";
import { emptyScriptsState, ScriptRuntime } from "../script/runtime";
import { newScratch, type Env, type TickScratch } from "./context";
import { makeCycleCtx } from "./cycle";
import { convertAloeFragments, ledgerRow } from "./inventory";
import { applyStepLayout } from "./placement";
import { isDry } from "./plants";
import { zeroSummary } from "./summary";
import type { PlotState, Scenario, SimulationState, TimedEvent } from "./state";

/** Unique base-crop groups standing across all plots, excluding dried-out crops. */
export function uniqueCropsAcross(state: SimulationState, env: Env): number {
  const kinds = new Set<string>();
  for (const plot of state.plots) {
    for (const p of plot.plants) if (p.origin === "planted" && !p.isDeadPlant && !isDry(p)) kinds.add(p.kindId);
  }
  return countUniqueCropGroups(kinds, env.data);
}

/**
 * Build the starting state. Each plot's starting step is laid out for free
 * (setup never draws on the starting inventory).
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
    uniqueCropsStanding: 0,
    lastCycleSeconds: CYCLE_BASELINE_SECONDS,
    lastCycleActive: true,
  };
  for (const item of Object.keys(state.inventory)) ledgerRow(state, item);
  convertAloeFragments(state);
  // Only scenarios that use scripts carry script state, so the rest are unchanged.
  if (scenarioUsesScripts(input)) state.scripts = emptyScriptsState(input.settings.seed);

  const events: TimedEvent[] = [];
  const scripts = state.scripts ? ScriptRuntime.create(state, env) : null;
  const ctx = makeCycleCtx(
    env,
    state,
    { cycle: 0, active: true, cycleSeconds: state.lastCycleSeconds, firesAt: 0, uniqueCropCount: 0 },
    events,
    scripts
  );
  const scratches = new Map<number, TickScratch>();
  for (const id of input.settings.config.plotOrder) {
    const plot = state.plots.find((p) => p.id === id);
    if (!plot) continue;
    const scratch = newScratch();
    scratches.set(id, scratch);
    applyStepLayout(plot, ctx.layoutFor(id), ctx, scratch, true, "setup");
  }

  state.uniqueCropsStanding = uniqueCropsAcross(state, env);
  state.uniqueCropCount = effectiveUniqueCrops(state.uniqueCropsStanding, input.settings.playerStats.floraShard);
  state.lastCycleSeconds = cycleSeconds(input.settings.playerStats, state.uniqueCropCount);

  if (scripts) {
    // Top-level code, then onStart, with the starting layouts built (the player is online).
    scripts.setCycle(ctx, scratches);
    scripts.runTopLevel();
    scripts.callHook("onStart");
    scripts.save();
  }
  return { state, events };
}
