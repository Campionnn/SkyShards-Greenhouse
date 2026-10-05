// Test builders shared by simulator suites. Not part of the engine.

import type { SimConfig } from "./config";
import { defaultGameData } from "./data/default";
import type { GameData, KindId, MinimumMutations } from "./data/types";
import { createEngine, type Engine } from "./engine";
import type { Condition, Flow, FlowStep, LayoutSpec, PolicyOverrides, StepLayout } from "./flow/types";
import { defaultSettings } from "./scenario";
import { DEVOURER_ROOT, insertPlant, newPlant, newRoot } from "./sim/plants";
import type { ActivitySchedule, Origin, PlantState, PlayerStats, Scenario, SimulationState } from "./sim/state";

export const engine = createEngine();

/**
 * Test-only game data variants. Decay timers and minimum mutations come only
 * from data.json (no config overrides), so tests that need other values run on
 * an engine built from a patched copy of the data. The app always uses data.json.
 */
export interface DataPatch {
  /** Every kind decays on its timer alone (minimum mutations null). */
  timerOnly?: boolean;
  /** Growing base crops never decay (decay 0). */
  noBaseCropDecay?: boolean;
  /** Per-kind decay days (0 = never). */
  decayDays?: Record<KindId, number>;
  /** Per-kind minimum mutations (null = timer only). */
  minimumMutations?: Record<KindId, MinimumMutations>;
}

export function patchedData(patch: DataPatch, base: GameData = defaultGameData()): GameData {
  const data = structuredClone(base);
  const kind = (id: KindId) => data.crops[id] ?? data.mutations[id];
  if (patch.timerOnly) for (const id of [...data.cropIds, ...data.mutationIds]) kind(id).minimumMutations = null;
  if (patch.noBaseCropDecay) for (const id of data.cropIds) if (data.crops[id].growthStages !== null) data.crops[id].decayDays = 0;
  for (const [id, days] of Object.entries(patch.decayDays ?? {})) kind(id).decayDays = days;
  for (const [id, min] of Object.entries(patch.minimumMutations ?? {})) kind(id).minimumMutations = min;
  return data;
}

/** An engine over patched game data (see `DataPatch`). */
export const engineWith = (patch: DataPatch): Engine => createEngine(patchedData(patch));

/** No minimum mutations for any kind, so decay is timer-only. */
export const TIMER_ONLY = engineWith({ timerOnly: true });
/** Growing base crops never decay. */
export const NO_BASE_CROP_DECAY = engineWith({ noBaseCropDecay: true });
/** Both of the above. */
export const TIMER_ONLY_NO_BASE_CROP_DECAY = engineWith({ timerOnly: true, noBaseCropDecay: true });

/**
 * Player stats patch: a huge Bioanalysis bonus pushes every non-empty spawn pool
 * past the spawn pool floor (100), so some eligible mutation takes every roll and
 * relative weights are kept. Replaces the removed `blankFillTo: 1` setting.
 */
export const ALWAYS_SPAWN: Pick<PlayerStats, "mutationChanceBonus"> = { mutationChanceBonus: 1e6 };

/** Real share codes from SHARE_CODES_AND_LAYOUTS.md (A: prerequisites, B: chorus fruit). */
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

/**
 * A step whose `exit` conditions (if any) lead to the following step; pass more
 * exits (e.g. jumps to other steps) in `extra.exits`, which go first, then the `exit` one.
 */
export function step(id: string, spec: StepLayout, exit: Condition[] = [], extra: Partial<FlowStep> = {}): FlowStep {
  const { exits = [], ...rest } = extra;
  return { id, label: id, layout: spec, ...rest, exits: [...exits, ...(exit.length ? [{ when: exit }] : [])] };
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

/** Zeroed player stats (4 h cycles, 1x yields), independent of the app's max-stat defaults. */
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
  /** 0 so the unique crop count equals the crops planted. */
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

export function start(sc: Scenario, eng: Engine = engine): SimulationState {
  return eng.initState(sc).state;
}

/** Insert a plant directly onto a plot (white-box setup). Pass the run's engine when it uses patched data. */
export function inject(
  state: SimulationState,
  plotId: number,
  kindId: string,
  row: number,
  col: number,
  origin: Origin,
  patch: Partial<PlantState> = {},
  eng: Engine = engine
): PlantState {
  const plot = state.plots.find((p) => p.id === plotId)!;
  const p =
    kindId === DEVOURER_ROOT
      ? newRoot(state, row, col, state.cycle)
      : newPlant(state, eng.data, state.scenario.settings.config, kindId, row, col, origin, state.cycle);
  Object.assign(p, patch);
  insertPlant(plot, p);
  return p;
}

export const plantAt = (state: SimulationState, plotId: number, row: number, col: number): PlantState | undefined =>
  state.plots.find((p) => p.id === plotId)!.plants.find((p) => row >= p.row && row < p.row + p.size && col >= p.col && col < p.col + p.size);

/** Never online: no harvesting, watering or upkeep. */
export const NEVER_ACTIVE: ActivitySchedule = { kind: "windows", windows: [] };

/** Run n single-cycle `run(state, 1)` calls, keeping each result. */
export function runCycles(state: SimulationState, n: number, eng: Engine = engine) {
  let s = state;
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = eng.run(s, 1);
    results.push(r);
    s = r.state;
  }
  return { state: s, results };
}
