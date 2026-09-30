import type { CycleCtx, TickScratch } from "../sim/context";
import { applyStageLayout } from "../sim/placement";
import type { FlowRunnerState, PlotState, ScenarioPlot, TickEvent } from "../sim/state";
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
    harvestedInStage: {},
    pendingTransition: false,
    finished: false,
    history: [{ stageId: plot.flow.stages[start].id, stageIndex: start, startCycle: cycle, endCycle: null }],
  };
}

/** Feed one event into its plot's in-stage trigger counters. Called by ctx.emit as events happen. */
export function countStageEvent(runner: FlowRunnerState, e: TickEvent): void {
  if (e.kind === "spawned") bump(runner.spawnedInStage, e.mutationId);
  else if (e.kind === "decayed") bump(runner.decayedInStage, e.kindId);
  else if (e.kind === "harvested" && e.origin === "spawned") bump((runner.harvestedInStage ??= {}), e.kindId);
}

/** Move a plot to its next stage and lay the new layout out. A player action. */
export function transition(plot: PlotState, def: ScenarioPlot, runner: FlowRunnerState, ctx: CycleCtx, scratch: TickScratch): void {
  const stages = def.flow.stages;
  const from = stages[runner.stageIndex];
  const last = runner.history[runner.history.length - 1];
  if (last && last.endCycle === null) last.endCycle = ctx.cycle;

  runner.stageIndex = (runner.stageIndex + 1) % stages.length;
  runner.pendingTransition = false;
  const to = stages[runner.stageIndex];
  runner.history.push({ stageId: to.id, stageIndex: runner.stageIndex, startCycle: ctx.cycle, endCycle: null });

  ctx.emit(plot.id, { kind: "stageChanged", fromStage: from.id, toStage: to.id, stageIndex: runner.stageIndex });
  applyStageLayout(plot, ctx.layoutFor(plot.id), ctx, scratch, !!to.fullClear);
  // Reset after laying out: what the player harvested or broke while
  // clearing the old stage belongs to neither stage's triggers.
  runner.cyclesInStage = 0;
  runner.spawnedInStage = {};
  runner.decayedInStage = {};
  runner.harvestedInStage = {};
}

/**
 * The rotation step for one plot. A stage change is due if one was already
 * pending (it became due while the player was away) or the current stage's
 * exit triggers all hold now. If the player is online it happens now and
 * this returns true; otherwise it is left pending for the next session.
 * A non-looping flow that meets its last stage's exit is marked finished
 * and holds that stage.
 */
export function endStageOrHold(
  plot: PlotState,
  def: ScenarioPlot,
  runner: FlowRunnerState,
  ctx: CycleCtx,
  scratch: TickScratch,
  playerOnline: boolean
): boolean {
  if (runner.finished) return false;
  if (!runner.pendingTransition) {
    const stage = def.flow.stages[runner.stageIndex];
    const view = { plot, runner, inventory: ctx.state.inventory, stageSeconds: ctx.stageSeconds };
    if (!stageExitHolds(stage.exit, view)) return false;
    const isLast = runner.stageIndex === def.flow.stages.length - 1;
    if (isLast && !def.flow.loop) {
      runner.finished = true; // holds its final stage; the other plots keep running
      return false;
    }
  }
  if (!playerOnline) {
    runner.pendingTransition = true;
    return false;
  }
  transition(plot, def, runner, ctx, scratch);
  return true;
}
