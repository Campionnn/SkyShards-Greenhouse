import { endStepOrHold } from "../flow/runner";
import { isActive } from "../growth/activity";
import { cycleSeconds, effectiveUniqueCrops } from "../growth/clock";
import { newScratch, type Env, type TickScratch } from "./context";
import { makeCycleCtx } from "./cycle";
import { uniqueCropsAcross } from "./init";
import { runPlayerSession } from "./player";
import { finalizeSummary } from "./summary";
import { tickPlot } from "./tick";
import type { BatchResult, PlotId, PlotState, RunOptions, SimulationState, TickEventKind, TimedEvent } from "./state";

const now = () => globalThis.performance?.now() ?? 0;

/**
 * The only stepping path: advance `ticks` cycles. A single step is `run(state, 1)`.
 * Pure (input is cloned). All persistent data lives in the returned state, so
 * run(s, 100) === run(run(s, 50).state, 50) === 100 x run(_, 1).
 *
 * Per cycle:
 *   1. shared aggregates (unique crops -> cycle length, activity)
 *   2. game tick: every plot's TICK_PHASES, in plotOrder
 *   3. every flow's cyclesInStep += 1
 *   4. active: every plot's PLAYER_PHASES, in plotOrder; inactive: exit
 *      triggers checked only, a due step change waits for the next session
 *   5. advance the clock
 */
export function run(env: Env, input: SimulationState, ticks: number, opts: RunOptions = {}): BatchResult {
  const state: SimulationState = structuredClone(input);
  const retain = opts.retainEvents ?? "all";
  const { settings } = state.scenario;
  const order: PlotId[] = settings.config.plotOrder.filter((id) => state.plots.some((p) => p.id === id));

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

    // 1. Shared aggregates.
    const uniqueCropsStanding = uniqueCropsAcross(state, env);
    const uniqueCropCount = effectiveUniqueCrops(uniqueCropsStanding, settings.playerStats.floraShard);
    const seconds = cycleSeconds(settings.playerStats, uniqueCropCount);
    const firesAt = state.elapsedSeconds + seconds;
    // playerActions === false: never online.
    const active = settings.playerActions !== false && isActive(settings.activity, cycle, firesAt, settings.playerStats.startTimeOfDay);

    const cycleEvents: TimedEvent[] = [];
    const ctx = makeCycleCtx(env, state, { cycle, active, cycleSeconds: seconds, firesAt, uniqueCropCount }, cycleEvents);

    const plots: { plot: PlotState; scratch: TickScratch }[] = [];
    for (const id of order) {
      const plot = state.plots.find((p) => p.id === id);
      if (plot) plots.push({ plot, scratch: newScratch() });
    }

    // 2. Game tick.
    for (const { plot, scratch } of plots) tickPlot(plot, ctx, scratch);

    // 3. Step cycle count.
    for (const runner of state.flows) runner.cyclesInStep += 1;

    // 4. Player session.
    for (const { plot, scratch } of plots) {
      if (active) runPlayerSession(plot, ctx, scratch);
      else {
        const { def, runner } = ctx.flowFor(plot.id);
        endStepOrHold(plot, def, runner, ctx, scratch, false);
      }
    }

    // 5. Clock.
    state.cycle += 1;
    state.elapsedSeconds = firesAt;
    state.uniqueCropCount = uniqueCropCount;
    state.uniqueCropsStanding = uniqueCropsStanding;
    state.lastCycleSeconds = seconds;
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
