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
 * THE entry point: advance the scenario by `ticks` cycles. `run(state, 1)`
 * is a step - there is deliberately no separate step function.
 *
 * Pure: the input state is never mutated. Everything that must survive a call
 * boundary (RNG, cycle, clock, plots, inventory, flow runners, the cumulative
 * summary) lives in the returned state, so
 *   run(s, 100) === run(run(s, 50).state, 50) === 100 x run(_, 1)
 *
 * Per cycle, in order:
 *   1. shared aggregates (unique crops -> cycle length, the activity schedule)
 *   2. game tick: every plot's TICK_PHASES (sim/tick.ts), in plotOrder
 *   3. every flow counts one more cycle in its step
 *   4. player: on an active cycle every plot's PLAYER_PHASES (sim/player.ts),
 *      in plotOrder - the player acts during the cycle, after the game has
 *      ticked. On an inactive cycle, exit triggers are only checked and a
 *      due step change waits for the next session.
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

    // 1. Shared aggregates for THIS cycle, across all plots.
    const uniqueCropsStanding = uniqueCropsAcross(state, env);
    const uniqueCropCount = effectiveUniqueCrops(uniqueCropsStanding, settings.playerStats.floraShard, settings.config.uniqueCropCap);
    const seconds = cycleSeconds(settings.playerStats, uniqueCropCount, settings.config);
    const firesAt = state.elapsedSeconds + seconds;
    // playerActions is the master switch: off = the player is never online.
    const active = settings.playerActions !== false && isActive(settings.activity, cycle, firesAt, settings.playerStats.startTimeOfDay);

    const cycleEvents: TimedEvent[] = [];
    const ctx = makeCycleCtx(env, state, { cycle, active, cycleSeconds: seconds, firesAt, uniqueCropCount }, cycleEvents);

    const plots: { plot: PlotState; scratch: TickScratch }[] = [];
    for (const id of order) {
      const plot = state.plots.find((p) => p.id === id);
      if (plot) plots.push({ plot, scratch: newScratch() });
    }

    // 2. Game tick: every plot, instantly.
    for (const { plot, scratch } of plots) tickPlot(plot, ctx, scratch);

    // 3. The step has seen one more cycle.
    for (const runner of state.flows) runner.cyclesInStep += 1;

    // 4. The player, some time during the cycle.
    for (const { plot, scratch } of plots) {
      if (active) runPlayerSession(plot, ctx, scratch);
      else {
        const { def, runner } = ctx.flowFor(plot.id);
        endStepOrHold(plot, def, runner, ctx, scratch, false);
      }
    }

    // 5. Advance the shared clock.
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
