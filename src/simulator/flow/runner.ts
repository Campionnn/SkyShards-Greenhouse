import type { CycleCtx } from "../sim/context";
import type { TickScratch } from "../sim/harvest";
import { applyStageLayout } from "../sim/placement";
import type { FlowRunnerState, PlotId, PlotState, ScenarioPlot, TimedEvent } from "../sim/state";
import { bump } from "../sim/summary";
import { stageExitHolds } from "./triggers";

// One runner per plot. Plots advance through their own stage lists on their
// own schedule; the only coupling between them is the shared inventory.

export function newRunner(plot: ScenarioPlot, cycle: number): FlowRunnerState {
  const n = plot.flow.stages.length;
  const start = Math.min(Math.max(0, Math.floor(plot.flow.startIndex)), n - 1);
  return {
    plotId: plot.id,
    stageIndex: start,
    cyclesInStage: 0,
    spawnedInStage: {},
    decayedInStage: {},
    pendingTransition: false,
    finished: false,
    history: [{ stageId: plot.flow.stages[start].id, stageIndex: start, startCycle: cycle, endCycle: null }],
  };
}

/** Feed this cycle's events for one plot into its runner's in-stage counters. */
export function countStageEvents(runner: FlowRunnerState, events: readonly TimedEvent[]): void {
  for (const e of events) {
    if (e.plotId !== runner.plotId) continue;
    if (e.kind === "spawned") bump(runner.spawnedInStage, e.mutationId);
    else if (e.kind === "decayed") bump(runner.decayedInStage, e.kindId);
  }
}

/** Move a plot to its next stage and lay the new layout out. A player action. */
export function transition(plot: PlotState, def: ScenarioPlot, runner: FlowRunnerState, ctx: CycleCtx, scratch: TickScratch): void {
  const stages = def.flow.stages;
  const from = stages[runner.stageIndex];
  const last = runner.history[runner.history.length - 1];
  if (last && last.endCycle === null) last.endCycle = ctx.cycle;

  runner.stageIndex = (runner.stageIndex + 1) % stages.length;
  runner.cyclesInStage = 0;
  runner.spawnedInStage = {};
  runner.decayedInStage = {};
  runner.pendingTransition = false;
  const to = stages[runner.stageIndex];
  runner.history.push({ stageId: to.id, stageIndex: runner.stageIndex, startCycle: ctx.cycle, endCycle: null });

  ctx.emit(plot.id, { kind: "stageChanged", fromStage: from.id, toStage: to.id, stageIndex: runner.stageIndex });
  applyStageLayout(plot, ctx.layoutFor(plot.id), ctx, scratch, !!to.fullClear);
}

/**
 * End of cycle, after every plot's physics: evaluate each plot's exit
 * triggers in plotOrder. On an active cycle the stage changes now; otherwise
 * it waits for the player's next session.
 */
export function evaluateFlows(ctx: CycleCtx, plotOrder: PlotId[], defs: Map<PlotId, ScenarioPlot>): void {
  const { state } = ctx;
  for (const id of plotOrder) {
    const runner = state.flows.find((r) => r.plotId === id);
    const plot = state.plots.find((p) => p.id === id);
    const def = defs.get(id);
    if (!runner || !plot || !def) continue;
    runner.cyclesInStage += 1;
    if (runner.finished || runner.pendingTransition) continue;

    const stage = def.flow.stages[runner.stageIndex];
    const view = { plot, runner, inventory: state.inventory, stageSeconds: ctx.stageSeconds };
    if (!stageExitHolds(stage.exit, view)) continue;

    const isLast = runner.stageIndex === def.flow.stages.length - 1;
    if (isLast && !def.flow.loop) {
      runner.finished = true; // holds its final stage; the other plots keep running
      continue;
    }
    if (ctx.active) transition(plot, def, runner, ctx, { advanced: new Set() });
    else runner.pendingTransition = true;
  }
}
