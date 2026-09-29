import { mergePolicies } from "../flow/policies";
import { transition } from "../flow/runner";
import { npcPriceSource } from "../economy/prices";
import { cyclesUntilNextActive } from "../stage/activity";
import type { CycleCtx, Env } from "./context";
import type { PlotId, ScenarioPlot, SimulationState, TickEvent, TimedEvent } from "./state";

/** Build the context for one cycle over the run's working state. */
export function makeCycleCtx(
  env: Env,
  state: SimulationState,
  opts: { cycle: number; active: boolean; stageSeconds: number; firesAt: number; uniqueCropCount: number },
  sink: TimedEvent[]
): CycleCtx {
  const { settings } = state.scenario;
  const defs = new Map<PlotId, ScenarioPlot>(state.scenario.plots.map((p) => [p.id, p]));
  const runnerOf = (id: PlotId) => state.flows.find((r) => r.plotId === id);
  const stageOf = (id: PlotId) => {
    const def = defs.get(id);
    const runner = runnerOf(id);
    if (!def || !runner) throw new Error(`No flow for plot ${id}`);
    return { def, runner, stage: def.flow.stages[runner.stageIndex] };
  };

  const ctx: CycleCtx = {
    env,
    state,
    config: settings.config,
    stats: settings.playerStats,
    prices: npcPriceSource(env.data, settings.config.rareDropValues),
    cycle: opts.cycle,
    active: opts.active,
    stageSeconds: opts.stageSeconds,
    firesAt: opts.firesAt,
    uniqueCropCount: opts.uniqueCropCount,
    emit(plotId: PlotId, event: TickEvent) {
      sink.push({ ...event, cycle: opts.cycle, plotId });
    },
    policiesFor(plotId) {
      const { def, stage } = stageOf(plotId);
      return mergePolicies(settings.policies, def.policies, stage.policies);
    },
    layoutFor(plotId) {
      return env.resolveLayout(stageOf(plotId).stage.layout);
    },
    onPlayerSession(plot, scratch) {
      const { def, runner } = stageOf(plot.id);
      if (runner.pendingTransition) transition(plot, def, runner, ctx, scratch);
    },
    cyclesUntilNextActive() {
      return cyclesUntilNextActive(settings.activity, opts.cycle, opts.firesAt, opts.stageSeconds, settings.playerStats.startTimeOfDay);
    },
  };
  return ctx;
}
