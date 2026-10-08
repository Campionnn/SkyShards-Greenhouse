import { mergePolicies } from "../flow/policies";
import { countStepEvent } from "../flow/runner";
import { npcPriceSource } from "../economy/prices";
import { cyclesUntilNextActive } from "../growth/activity";
import type { ScriptRuntime } from "../script/runtime";
import type { CycleCtx, Env } from "./context";
import type { PlotId, ScenarioPlot, SimulationState, TickEvent, TimedEvent } from "./state";

/** Build the context for one cycle over the run's working state. */
export function makeCycleCtx(
  env: Env,
  state: SimulationState,
  opts: { cycle: number; active: boolean; cycleSeconds: number; firesAt: number; uniqueCropCount: number },
  sink: TimedEvent[],
  scripts: ScriptRuntime | null = null
): CycleCtx {
  const { settings } = state.scenario;
  const defs = new Map<PlotId, ScenarioPlot>(state.scenario.plots.map((p) => [p.id, p]));
  const runnerOf = (id: PlotId) => state.flows.find((r) => r.plotId === id);
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
      sink.push({ ...event, cycle: opts.cycle, plotId });
      const runner = runnerOf(plotId);
      if (runner) countStepEvent(runner, event);
      scripts?.onEvent(plotId, event);
    },
    policiesFor(plotId) {
      const { def } = flowOf(plotId);
      return mergePolicies(settings.policies, def.policies, stepOf(plotId).policies, scriptPlot(plotId)?.policies);
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
