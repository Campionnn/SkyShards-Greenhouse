import { mergePolicies } from "../flow/policies";
import { countStepEvent } from "../flow/runner";
import { npcPriceSource } from "../economy/prices";
import { cyclesUntilNextActive } from "../growth/activity";
import type { ScriptRuntime } from "../script/runtime";
import type { Policies } from "../flow/types";
import type { CycleCtx, Env } from "./context";
import type { PlotId, ScenarioPlot, SimulationState, TickEvent, TickEventKind, TimedEvent } from "./state";

/**
 * Build the context for one cycle over the run's working state. Events go to `sink`; with
 * `sink: null` they are only counted by kind into `counts` (run() with `retainEvents: "none"`),
 * which skips building an event object per emit.
 */
export function makeCycleCtx(
  env: Env,
  state: SimulationState,
  opts: { cycle: number; active: boolean; cycleSeconds: number; firesAt: number; uniqueCropCount: number },
  sink: TimedEvent[] | null,
  scripts: ScriptRuntime | null = null,
  counts?: Partial<Record<TickEventKind, number>>
): CycleCtx {
  const { settings } = state.scenario;
  const defs = new Map<PlotId, ScenarioPlot>(state.scenario.plots.map((p) => [p.id, p]));
  // state.flows is fixed for a cycle (runners are mutated in place, never replaced).
  const runners = new Map(state.flows.map((r) => [r.plotId, r]));
  const runnerOf = (id: PlotId) => runners.get(id);
  const flowOf = (id: PlotId) => {
    const def = defs.get(id);
    const runner = runnerOf(id);
    if (!def || !runner) throw new Error(`No flow for plot ${id}`);
    return { def, runner };
  };
  const stepOf = (id: PlotId) => {
    const { def, runner } = flowOf(id);
    return def.flow.steps[runner.stepIndex];
  };
  // Script overrides (state.scripts.plots): absent without scripts.
  const scriptPlot = (id: PlotId) => state.scripts?.plots[String(id)];
  // Merged policies, memoised per plot on the identity of the four layers: a step change, a script
  // setPolicy (which replaces its overrides object) or anything else that swaps a layer recomputes.
  // Callers only read the result (phases, and fromData copies it for scripts).
  const policyCache = new Map<PlotId, { layers: readonly unknown[]; merged: Policies }>();

  const ctx: CycleCtx = {
    env,
    state,
    config: settings.config,
    stats: settings.playerStats,
    prices: npcPriceSource(env.data),
    cycle: opts.cycle,
    active: opts.active,
    cycleSeconds: opts.cycleSeconds,
    firesAt: opts.firesAt,
    uniqueCropCount: opts.uniqueCropCount,
    scripts,
    emit(plotId: PlotId, event: TickEvent) {
      if (sink) sink.push({ ...event, cycle: opts.cycle, plotId });
      else if (counts) counts[event.kind] = (counts[event.kind] ?? 0) + 1;
      const runner = runnerOf(plotId);
      if (runner) countStepEvent(runner, event);
      scripts?.onEvent(plotId, event);
    },
    policiesFor(plotId) {
      const { def } = flowOf(plotId);
      const layers = [settings.policies, def.policies, stepOf(plotId).policies, scriptPlot(plotId)?.policies] as const;
      const hit = policyCache.get(plotId);
      if (hit && hit.layers.every((l, i) => l === layers[i])) return hit.merged;
      const merged = mergePolicies(...layers);
      policyCache.set(plotId, { layers, merged });
      return merged;
    },
    layoutFor(plotId) {
      return env.resolveLayout(scriptPlot(plotId)?.layout ?? stepOf(plotId).layout);
    },
    stepFor(plotId) {
      return stepOf(plotId);
    },
    flowFor(plotId) {
      return flowOf(plotId);
    },
    cyclesUntilNextActive() {
      if (settings.playerActions === false) return Infinity;
      return cyclesUntilNextActive(settings.activity, opts.cycle, opts.firesAt, opts.cycleSeconds, settings.playerStats.startTimeOfDay);
    },
  };
  return ctx;
}
