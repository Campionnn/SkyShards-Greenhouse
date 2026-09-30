import type { CycleCtx, TickScratch } from "../sim/context";
import { applyStageLayout } from "../sim/placement";
import type { FlowRunnerState, PlotState, ScenarioPlot, TickEvent } from "../sim/state";
import { bump } from "../sim/summary";
import { conditionsHold, stageExitHolds } from "./triggers";

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

/**
 * Move a plot to a stage (default: the following one, wrapping) and lay the
 * new layout out. A player action. Moving to the stage it is already on
 * re-enters it: the layout is re-applied and the in-stage counters restart.
 */
export function transition(
  plot: PlotState,
  def: ScenarioPlot,
  runner: FlowRunnerState,
  ctx: CycleCtx,
  scratch: TickScratch,
  toIndex: number = (runner.stageIndex + 1) % def.flow.stages.length
): void {
  const stages = def.flow.stages;
  const from = stages[runner.stageIndex];
  const last = runner.history[runner.history.length - 1];
  if (last && last.endCycle === null) last.endCycle = ctx.cycle;

  runner.stageIndex = toIndex >= 0 && toIndex < stages.length ? toIndex : (runner.stageIndex + 1) % stages.length;
  runner.pendingTransition = false;
  delete runner.pendingTarget;
  runner.finished = false;
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
 * Where the current stage wants to go now, or null to stay:
 * 1. its routes, in order: the first whose conditions hold wins;
 * 2. its normal exit: to `next` if set, otherwise the following stage (the
 *    first stage on a looping flow). A non-looping flow's last stage without
 *    a `next` has nowhere to go: the plot is marked finished and holds it.
 * A route or `next` naming a stage that does not exist is ignored
 * (validation reports it as an error).
 */
function dueTarget(plot: PlotState, def: ScenarioPlot, runner: FlowRunnerState, ctx: CycleCtx): number | null {
  const { stages } = def.flow;
  const stage = stages[runner.stageIndex];
  const view = { plot, runner, inventory: ctx.state.inventory, stageSeconds: ctx.stageSeconds };
  const indexOf = (id: string) => stages.findIndex((s) => s.id === id);

  for (const route of stage.routes ?? []) {
    const to = indexOf(route.to);
    if (to >= 0 && conditionsHold(route.when, route.match, view)) return to;
  }
  if (runner.finished) return null; // the normal exit already has nowhere to go
  if (!stageExitHolds(stage.exit, view, stage.exitMatch)) return null;
  if (stage.next !== undefined) {
    const to = indexOf(stage.next);
    if (to >= 0) return to;
  }
  const isLast = runner.stageIndex === stages.length - 1;
  if (isLast && !def.flow.loop) {
    runner.finished = true; // holds its final stage (routes can still move it); the other plots keep running
    return null;
  }
  return (runner.stageIndex + 1) % stages.length;
}

/**
 * The rotation step for one plot. A stage change is due if one was already
 * pending (it became due while the player was away) or the current stage's
 * routes or exit hold now (see `dueTarget`). If the player is online it
 * happens now and this returns true; otherwise it is left pending, with its
 * target, for the next session.
 */
export function endStageOrHold(
  plot: PlotState,
  def: ScenarioPlot,
  runner: FlowRunnerState,
  ctx: CycleCtx,
  scratch: TickScratch,
  playerOnline: boolean
): boolean {
  let to: number;
  if (runner.pendingTransition) {
    to = runner.pendingTarget ?? (runner.stageIndex + 1) % def.flow.stages.length;
  } else {
    const due = dueTarget(plot, def, runner, ctx);
    if (due === null) return false;
    to = due;
  }
  if (!playerOnline) {
    runner.pendingTransition = true;
    runner.pendingTarget = to;
    return false;
  }
  transition(plot, def, runner, ctx, scratch, to);
  return true;
}
