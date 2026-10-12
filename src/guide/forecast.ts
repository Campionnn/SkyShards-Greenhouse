/**
 * The Monte Carlo half of the Guide.
 *
 * Decisions are exact; the future is not. A forecast plays the same check-in forward from many
 * seeds: first the login projection (the same one the cards show), then `engine.run` one cycle at a
 * time until every plot is Done or the cycle cap is hit.
 *
 * Bought supplies: the flow sends a plot to its "supplies" step when Dead Plants or Fermento are the
 * only thing stopping it, and that step tells the player to buy more. The forecast models exactly
 * that: when a plot sits on "supplies" it tops the stock up the way the step's label says, and
 * records how far the stock would have fallen without the top-ups. So the shopping list is
 * "what you would have to buy on top of what you own", and a run never stalls just for lack of a
 * Bazaar trip.
 */
import type { SimulationState } from "../simulator/sim/state";
import { BOUGHT_SUPPLIES, DONE, HUB, SUPPLIES, type FlowsFile } from "./flow";
import { projectLogin, type GuideEnv } from "./project";
import type { GuideInput, PlotId, RunTimeline, Visit } from "./types";

/** A top-up when a plot is waiting on supplies (the flow's "supplies" step label). */
export const SUPPLY_TOP_UP: Record<string, number> = { dead_plant: 250, fermento: 50 };
export const DEFAULT_MAX_CYCLES = 3000;

/** Seed lists per precision. Deterministic: the same check-in and seeds give the same forecast. */
export const PRECISION_SEEDS: Record<"quick" | "normal" | "thorough", number[]> = {
  quick: range(1, 12),
  normal: range(1, 32),
  thorough: range(1, 96),
};

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

const onSupplies = (state: SimulationState) =>
  state.flows.some((runner) => {
    const def = state.scenario.plots.find((p) => p.id === runner.plotId);
    return def?.flow.steps[runner.stepIndex]?.id === SUPPLIES;
  });

/** Run one seed to Done (or the cap) and summarise its timeline. */
export function runOne(flow: FlowsFile, input: GuideInput, seed: number, guideEnv: GuideEnv, maxCycles = DEFAULT_MAX_CYCLES): RunTimeline {
  const seeded: GuideInput = { ...input, settings: { ...input.settings, seed } };
  const { state: start, halt } = projectLogin(flow, seeded, guideEnv);
  if (halt) throw new Error(`Seed ${seed} halted during the first login: ${halt}`);
  let state = start;
  let logins = 1;
  const injected: Record<string, number> = {};
  const lowest: Record<string, number> = {};
  const track = () => {
    for (const item of BOUGHT_SUPPLIES) {
      const without = (state.inventory[item] ?? 0) - (injected[item] ?? 0);
      lowest[item] = Math.min(lowest[item] ?? Infinity, without);
    }
  };
  track();
  // Seconds elapsed at the start of each cycle, to turn cycle spans into real time.
  const secondsAt: number[] = [0];
  while (!state.flows.every((f) => f.finished) && state.cycle < maxCycles && !state.scripts?.halt) {
    if (onSupplies(state)) {
      state = guideEnv.engine.addItems(state, SUPPLY_TOP_UP);
      for (const [item, qty] of Object.entries(SUPPLY_TOP_UP)) injected[item] = (injected[item] ?? 0) + qty;
    }
    state = guideEnv.engine.run(state, 1, { retainEvents: "none" }).state;
    secondsAt[state.cycle] = state.elapsedSeconds;
    if (state.lastCycleActive) logins += 1;
    track();
  }
  const at = (cycle: number) => secondsAt[Math.min(cycle, secondsAt.length - 1)] ?? state.elapsedSeconds;

  const visits: Visit[] = [];
  const farms: Record<PlotId, string[]> = {};
  for (const runner of state.flows) {
    const list: string[] = [];
    for (const entry of runner.history) {
      if (entry.skipped) continue;
      const end = entry.endCycle ?? state.cycle;
      const cycles = Math.max(0, end - entry.startCycle);
      // A zero-length hub or supplies stop, and the final Done, are not visits a player plans around.
      if (entry.stepId === DONE) continue;
      if (cycles === 0 && (entry.stepId === HUB || entry.stepId === SUPPLIES)) continue;
      list.push(entry.stepId);
      visits.push({
        plotId: runner.plotId,
        farm: entry.stepId,
        startCycle: entry.startCycle,
        cycles,
        startSeconds: at(entry.startCycle),
        seconds: at(end) - at(entry.startCycle),
      });
    }
    farms[runner.plotId] = list;
  }
  const supplyNeed: Record<string, number> = {};
  // Needed from the start = what the player owned minus the lowest the stock would have fallen.
  for (const item of BOUGHT_SUPPLIES) supplyNeed[item] = Math.max(0, Math.ceil((input.inventory[item] ?? 0) - (lowest[item] ?? 0)));
  return {
    seed,
    visits,
    farms,
    cycles: state.cycle,
    elapsedSeconds: state.elapsedSeconds,
    logins,
    done: state.flows.every((f) => f.finished),
    debtEvents: state.summary.debtEvents,
    supplyNeed,
  };
}

/** Run every seed in order (the worker pool runs them in parallel instead). */
export function runForecast(flow: FlowsFile, input: GuideInput, guideEnv: GuideEnv, seeds: number[], maxCycles = DEFAULT_MAX_CYCLES): RunTimeline[] {
  return seeds.map((seed) => runOne(flow, input, seed, guideEnv, maxCycles));
}
