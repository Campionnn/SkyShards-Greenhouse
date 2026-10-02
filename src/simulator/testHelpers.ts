// Builders shared by the simulator's test suites. Not part of the engine.

import type { SimConfig } from "./config";
import { createEngine } from "./engine";
import type { Condition, Flow, FlowStep, LayoutSpec, PolicyOverrides, StepLayout } from "./flow/types";
import { defaultSettings } from "./scenario";
import { DEVOURER_ROOT, insertPlant, newPlant, newRoot } from "./sim/plants";
import type { ActivitySchedule, Origin, PlantState, PlayerStats, Scenario, SimulationState } from "./sim/state";

export const engine = createEngine();

/** The two real share codes from SHARE_CODES_AND_LAYOUTS.md (Layout A: prerequisites, Layout B: chorus fruit). */
export const LAYOUT_A_CODE =
  "RctJDsIwEETRC_0FY4AlhAzXsNs2CeDExICElMNjr_Jq0ypVBzo8RyyODWtGDggrDJE9BSe2fFHs5pFfujwhfUSm-TmG--PmnDE-u1ZVXfuyL33nnLV9prMYhxil0Y0MlxQRLTJkS7fsVKtb9XmfX5PK_g";
export const LAYOUT_B_CODE = "q9QxNNQpqjE0rUlKSkwCYj09vSTHRBDUS9ZLTEwEikLEwKIgFkgwCSQLEksCiyVCgB4cJENwsh4qAAA";

type Cellish = [kindId: string, row: number, col: number];

export function layout(plants: Cellish[] = [], slots: Cellish[] = []): LayoutSpec {
  return {
    plants: plants.map(([kindId, row, col]) => ({ kindId, row, col })),
    slots: slots.map(([mutationId, row, col]) => ({ mutationId, row, col })),
  };
}

export function step(id: string, spec: StepLayout, exit: Condition[] = [], extra: Partial<FlowStep> = {}): FlowStep {
  return { id, label: id, layout: spec, exit, ...extra };
}

export function flow(steps: FlowStep[], loop = false, startIndex = 0): Flow {
  return { steps, loop, startIndex };
}

export interface ScenarioOptions {
  seed?: number;
  config?: Partial<SimConfig>;
  stats?: Partial<PlayerStats>;
  activity?: ActivitySchedule;
  policies?: PolicyOverrides;
  inventory?: Record<string, number>;
}

/**
 * Mechanics tests run against a zeroed player (4 h steps, 1x yields) so their
 * expected numbers stay independent of the app's max-stat defaults.
 */
export const BASELINE_TEST_STATS: PlayerStats = {
  cropGrowth: 0,
  speedAttribute: 0,
  growthUpgradeTier: 0,
  farmingFortune: 0,
  plantYieldUpgrade: 0,
  evergreenChip: 0,
  mutationChanceBonus: 0,
  miningFortune: 100,
  overbloom: 0,
  armorSet: "none",
  startTimeOfDay: 0,
  /** 0, so mechanics tests still see exactly the crops they planted. */
  floraShard: 0,
};

export function scenario(flows: Flow[], opts: ScenarioOptions = {}): Scenario {
  const settings = defaultSettings();
  if (opts.seed !== undefined) settings.seed = opts.seed;
  settings.config = { ...settings.config, ...opts.config };
  settings.playerStats = { ...BASELINE_TEST_STATS, ...opts.stats };
  if (opts.activity) settings.activity = opts.activity;
  if (opts.policies) {
    const { gateInteractions, ...rest } = opts.policies;
    settings.policies = { ...settings.policies, ...rest, gateInteractions: { ...settings.policies.gateInteractions, ...gateInteractions } };
  }
  return {
    plots: flows.map((f, i) => ({ id: i + 1, flow: f })),
    startingInventory: opts.inventory ?? {},
    settings,
  };
}

/** One plot holding one static layout. */
export function singlePlot(spec: LayoutSpec, opts: ScenarioOptions = {}): Scenario {
  return scenario([flow([step("only", spec)])], opts);
}

export function start(sc: Scenario): SimulationState {
  return engine.initState(sc).state;
}

/** Put a plant straight onto a plot (white-box setup for single-rule tests). */
export function inject(
  state: SimulationState,
  plotId: number,
  kindId: string,
  row: number,
  col: number,
  origin: Origin,
  patch: Partial<PlantState> = {}
): PlantState {
  const plot = state.plots.find((p) => p.id === plotId)!;
  const p =
    kindId === DEVOURER_ROOT
      ? newRoot(state, state.scenario.settings.config, row, col, state.cycle)
      : newPlant(state, engine.data, state.scenario.settings.config, kindId, row, col, origin, state.cycle, state.lastCycleSeconds);
  Object.assign(p, patch);
  insertPlant(plot, p);
  return p;
}

export const plantAt = (state: SimulationState, plotId: number, row: number, col: number): PlantState | undefined =>
  state.plots.find((p) => p.id === plotId)!.plants.find((p) => row >= p.row && row < p.row + p.size && col >= p.col && col < p.col + p.size);

/** Never online: no harvesting, watering or upkeep. */
export const NEVER_ACTIVE: ActivitySchedule = { kind: "windows", windows: [] };

/** Cycle-by-cycle stepping helper: the only loop tests use is over run(state, 1). */
export function runCycles(state: SimulationState, n: number) {
  let s = state;
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = engine.run(s, 1);
    results.push(r);
    s = r.state;
  }
  return { state: s, results };
}
