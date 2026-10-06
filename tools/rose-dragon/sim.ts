/**
 * Simulation harness for the Rose Dragon flow: the player preset from the task,
 * scenario building, and run-until-done helpers. Drives the real engine
 * (src/simulator) exactly like the /simulator page does (createEngine + run).
 */
import { createEngine } from "../../src/simulator/engine";
import { defaultSettings } from "../../src/simulator/scenario";
import type { Scenario, ScenarioPlot, SimulationState } from "../../src/simulator/sim/state";
import type { PolicyOverrides } from "../../src/simulator/flow/types";

export const engine = createEngine();

/** The player the flow is built for (task brief). Flora 0, Bioanalysis 0, online every 3 cycles. */
export const PLAYER_STATS = {
  cropGrowth: 100,
  speedAttribute: 0,
  growthUpgradeTier: 5,
  farmingFortune: 0, // doesn't matter
  plantYieldUpgrade: 0.1,
  evergreenChip: 0.3,
  mutationChanceBonus: 0,
  miningFortune: 1000,
  overbloom: 0, // doesn't matter
  armorSet: "none" as const, // doesn't matter
  startTimeOfDay: 0,
  floraShard: 0,
};

/** Online every 3 cycles (task brief). The ONLINE_EVERY env var overrides it for stress tests. */
export const ONLINE_EVERY = Number(process.env.ONLINE_EVERY ?? 3);

/** Purchased supplies: broad tests start with a big finite stock, never unlimited placement. */
export const FREE_STOCK: Record<string, number> = { fermento: 5000, dead_plant: 5000 };

export const LEGENDARY_GOAL: Record<string, number> = {
  all_in_aloe: 2,
  devourer: 2,
  glasscorn: 2,
  phantomleaf: 2,
  timestalk: 2,
};

export function makeScenario(
  plots: ScenarioPlot[],
  inventory: Record<string, number>,
  seed: number,
  policies: PolicyOverrides = {}
): Scenario {
  const settings = defaultSettings();
  settings.seed = seed;
  settings.playerStats = { ...settings.playerStats, ...PLAYER_STATS };
  settings.activity = { kind: "everyN", n: ONLINE_EVERY, offset: 0 };
  settings.policies = { ...settings.policies, ...policies, gateInteractions: { ...settings.policies.gateInteractions, ...(policies.gateInteractions ?? {}) } } as typeof settings.policies;
  return { plots: structuredClone(plots), startingInventory: { ...inventory }, settings };
}

export function goalMet(state: SimulationState, goal = LEGENDARY_GOAL): boolean {
  return Object.entries(goal).every(([k, n]) => (state.inventory[k] ?? 0) >= n);
}

export function allFinished(state: SimulationState): boolean {
  return state.flows.every((f) => f.finished);
}

export interface RunReport {
  seed: number;
  cycles: number;
  days: number;
  goalMet: boolean;
  finished: boolean;
  inventory: Record<string, number>;
  /** Per plot: [stepId, cycles in it] in order (skipped steps marked). */
  history: Record<number, { step: string; cycles: number; skipped?: boolean }[]>;
  /** Fraction of cycles each plot spent in a step whose layout has at least one target. */
  debtEvents: number;
  state: SimulationState;
}

export function runUntil(
  scenario: Scenario,
  opts: { maxCycles?: number; chunk?: number; stop?: (s: SimulationState) => boolean } = {}
): RunReport {
  const { state: s0 } = engine.initState(scenario);
  let state = s0;
  const max = opts.maxCycles ?? 3000;
  const chunk = opts.chunk ?? 3;
  const stop = opts.stop ?? ((s: SimulationState) => goalMet(s) && allFinished(s));
  while (state.cycle < max) {
    state = engine.run(state, chunk, { retainEvents: "none" }).state;
    if (stop(state)) break;
  }
  const history: RunReport["history"] = {};
  for (const f of state.flows) {
    history[f.plotId] = f.history.map((h) => ({
      step: h.stepId,
      cycles: (h.endCycle ?? state.cycle) - h.startCycle,
      ...(h.skipped ? { skipped: true } : {}),
    }));
  }
  return {
    seed: scenario.settings.seed,
    cycles: state.cycle,
    days: +(state.elapsedSeconds / 86400).toFixed(1),
    goalMet: goalMet(state),
    finished: allFinished(state),
    inventory: Object.fromEntries(Object.entries(state.inventory).filter(([, v]) => v !== 0)),
    history,
    debtEvents: state.summary.debtEvents,
    state,
  };
}
