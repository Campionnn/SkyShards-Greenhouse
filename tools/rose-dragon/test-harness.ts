/** Importable real-engine Rose Dragon runner. The CLI lives separately in test.ts. */
import type { ScenarioPlot, SimulationState } from "../../src/simulator/sim/state";
import { engine, FREE_STOCK, makeScenario, LEGENDARY_GOAL } from "./sim";
import { INVENTORIES, randomInventory } from "./inventories";

export function inventoryOf(name: string): Record<string, number> {
  const m = /^random(\d+)$/.exec(name);
  if (m) return randomInventory(Number(m[1]));
  if (!INVENTORIES[name]) throw new Error(`unknown inventory ${name}`);
  return INVENTORIES[name];
}

export interface Result {
  inv: string;
  seed: number;
  cycles: number;
  days: number;
  ok: boolean;
  finished: boolean;
  missing: Record<string, number>;
  /** Time in a farm, NOT physical grid occupancy. */
  busy: Record<number, number>;
  steps: Record<number, string>;
  stuckOn?: Record<number, string>;
  debt: number;
  state: SimulationState;
}

export function runOne(plots: ScenarioPlot[], invName: string, seed: number, max: number): Result {
  const sc = makeScenario(plots, { ...FREE_STOCK, ...inventoryOf(invName) }, seed);
  let state = engine.initState(sc).state;
  const done = (s: SimulationState) => s.flows.every((f) => f.finished || plots.find((p) => p.id === f.plotId)!.flow.steps[f.stepIndex].id === "done");
  while (state.cycle < max && !done(state)) state = engine.run(state, 3, { retainEvents: "none" }).state;
  const missing: Record<string, number> = {};
  for (const [k, n] of Object.entries(LEGENDARY_GOAL)) if ((state.inventory[k] ?? 0) < n) missing[k] = n - (state.inventory[k] ?? 0);
  const busy: Record<number, number> = {};
  const steps: Record<number, string> = {};
  for (const f of state.flows) {
    let b = 0;
    for (const h of f.history) {
      if (h.stepId !== "hub" && h.stepId !== "done") b += (h.endCycle ?? state.cycle) - h.startCycle;
    }
    busy[f.plotId] = state.cycle ? +(b / state.cycle).toFixed(2) : 0;
    steps[f.plotId] = f.history.filter((h) => !h.skipped).map((h) => `${h.stepId}:${(h.endCycle ?? state.cycle) - h.startCycle}`).join(" > ");
  }
  const res: Result = {
    inv: invName, seed, cycles: state.cycle, days: +(state.elapsedSeconds / 86400).toFixed(1),
    ok: Object.keys(missing).length === 0, finished: done(state), missing, busy, steps,
    debt: state.summary.debtEvents, state,
  };
  if (!res.finished) res.stuckOn = Object.fromEntries(state.flows.map((f) => [f.plotId, plots.find((p) => p.id === f.plotId)!.flow.steps[f.stepIndex].id]));
  return res;
}
