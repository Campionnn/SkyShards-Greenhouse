import { countStageEvents, evaluateFlows } from "../flow/runner";
import { isActive } from "../stage/activity";
import { stageSeconds } from "../stage/clock";
import type { Env } from "./context";
import { makeCycleCtx } from "./cycle";
import { uniqueCropsAcross } from "./init";
import { finalizeSummary } from "./summary";
import { tickPlot } from "./tick";
import type { BatchResult, PlotId, RunOptions, ScenarioPlot, SimulationState, TickEventKind, TimedEvent } from "./state";

const now = () => globalThis.performance?.now() ?? 0;

/**
 * THE entry point: advance the scenario by `ticks` cycles. `run(state, 1)`
 * is a step - there is deliberately no separate step function.
 *
 * Pure: the input state is never mutated. Everything that must survive a call
 * boundary (RNG, cycle, clock, plots, inventory, flow runners, the cumulative
 * summary) lives in the returned state, so
 *   run(s, 100) === run(run(s, 50).state, 50) === 100 x run(_, 1)
 *
 * Per cycle, in order: shared aggregates (unique crops -> stage length, the
 * activity schedule) -> every plot's physics in plotOrder -> every plot's
 * flow transition in plotOrder -> advance the clock.
 */
export function run(env: Env, input: SimulationState, ticks: number, opts: RunOptions = {}): BatchResult {
  const state: SimulationState = structuredClone(input);
  const retain = opts.retainEvents ?? "all";
  const { settings } = state.scenario;
  const order: PlotId[] = settings.config.plotOrder.filter((id) => state.plots.some((p) => p.id === id));
  const defs = new Map<PlotId, ScenarioPlot>(state.scenario.plots.map((p) => [p.id, p]));

  let events: TimedEvent[] = [];
  const eventCounts: Partial<Record<TickEventKind, number>> = {};
  let cyclesRun = 0;
  let truncated = false;
  const interval = opts.progressIntervalMs ?? 250;
  let lastProgress = now();
  const total = Math.max(0, Math.floor(ticks));

  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) {
      truncated = true;
      break;
    }
    const cycle = state.cycle;

    // 1. Shared aggregates for THIS cycle, across all plots.
    const uniqueCropCount = uniqueCropsAcross(state, env);
    const seconds = stageSeconds(settings.playerStats, uniqueCropCount, settings.config.stageBaselineSeconds);
    const firesAt = state.elapsedSeconds + seconds;
    const active = isActive(settings.activity, cycle, firesAt, settings.playerStats.startTimeOfDay);

    const cycleEvents: TimedEvent[] = [];
    const ctx = makeCycleCtx(env, state, { cycle, active, stageSeconds: seconds, firesAt, uniqueCropCount }, cycleEvents);

    // 2. Physics: every plot, in the pinned step order.
    for (const id of order) {
      const plot = state.plots.find((p) => p.id === id);
      if (plot) tickPlot(plot, ctx);
    }

    // 3. Flow transitions, per plot, after ALL physics.
    for (const runner of state.flows) countStageEvents(runner, cycleEvents);
    evaluateFlows(ctx, order, defs);

    // 4. Advance the shared clock.
    state.cycle += 1;
    state.elapsedSeconds = firesAt;
    state.uniqueCropCount = uniqueCropCount;
    state.lastStageSeconds = seconds;
    state.lastCycleActive = active;
    finalizeSummary(state.summary, state.cycle, state.elapsedSeconds);
    cyclesRun += 1;

    for (const e of cycleEvents) eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;
    if (retain === "all") events.push(...cycleEvents);
    else if (retain === "summary") events = cycleEvents;

    if (opts.onProgress) {
      const t = now();
      if (t - lastProgress >= interval || i === total - 1) {
        lastProgress = t;
        opts.onProgress({ cycle: state.cycle, done: i + 1, total, summary: state.summary });
      }
    }
  }

  return { state, events, eventCounts, cyclesRun, truncated, summary: state.summary };
}
