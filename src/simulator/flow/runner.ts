import type { CycleCtx, TickScratch } from "../sim/context";
import { applyStepLayout } from "../sim/placement";
import type { FlowRunnerState, PlotState, ScenarioPlot, TickEvent } from "../sim/state";
import { bump } from "../sim/summary";
import { conditionsHold, stepExitHolds } from "./triggers";

// One runner per plot. Plots advance through their own step lists on their
// own schedule; the only coupling between them is the shared inventory.

export function newRunner(plot: ScenarioPlot, cycle: number): FlowRunnerState {
  const n = plot.flow.steps.length;
  const start = Math.min(Math.max(0, Math.floor(plot.flow.startIndex)), n - 1);
  return {
    plotId: plot.id,
    stepIndex: start,
    cyclesInStep: 0,
    spawnedInStep: {},
    decayedInStep: {},
    harvestedInStep: {},
    pendingTransition: false,
    finished: false,
    history: [{ stepId: plot.flow.steps[start].id, stepIndex: start, startCycle: cycle, endCycle: null }],
  };
}

/** Feed one event into its plot's in-step trigger counters. Called by ctx.emit as events happen. */
export function countStepEvent(runner: FlowRunnerState, e: TickEvent): void {
  if (e.kind === "spawned") bump(runner.spawnedInStep, e.mutationId);
  else if (e.kind === "decayed") bump(runner.decayedInStep, e.kindId);
  else if (e.kind === "harvested" && e.origin === "spawned") bump((runner.harvestedInStep ??= {}), e.kindId);
}

/**
 * Move a plot to a step (default: the following one, wrapping) and lay the
 * new layout out. A player action. Moving to the step it is already on
 * re-enters it: the layout is re-applied and the in-step counters restart.
 */
export function transition(
  plot: PlotState,
  def: ScenarioPlot,
  runner: FlowRunnerState,
  ctx: CycleCtx,
  scratch: TickScratch,
  toIndex: number = (runner.stepIndex + 1) % def.flow.steps.length
): void {
  const steps = def.flow.steps;
  const from = steps[runner.stepIndex];
  const last = runner.history[runner.history.length - 1];
  if (last && last.endCycle === null) last.endCycle = ctx.cycle;

  runner.stepIndex = toIndex >= 0 && toIndex < steps.length ? toIndex : (runner.stepIndex + 1) % steps.length;
  runner.pendingTransition = false;
  delete runner.pendingTarget;
  runner.finished = false;
  const to = steps[runner.stepIndex];
  runner.history.push({ stepId: to.id, stepIndex: runner.stepIndex, startCycle: ctx.cycle, endCycle: null });

  ctx.emit(plot.id, { kind: "stepChanged", fromStep: from.id, toStep: to.id, stepIndex: runner.stepIndex });
  applyStepLayout(plot, ctx.layoutFor(plot.id), ctx, scratch, !!to.fullClear);
  // Reset after laying out: what the player harvested or broke while
  // clearing the old step belongs to neither step's triggers.
  runner.cyclesInStep = 0;
  runner.spawnedInStep = {};
  runner.decayedInStep = {};
  runner.harvestedInStep = {};
}

/**
 * Where the current step wants to go now, or null to stay:
 * 1. its routes, in order: the first whose conditions hold wins;
 * 2. its normal exit: to `next` if set, otherwise the following step (the
 *    first step on a looping flow). A non-looping flow's last step without
 *    a `next` has nowhere to go: the plot is marked finished and holds it.
 * A route or `next` naming a step that does not exist is ignored
 * (validation reports it as an error).
 */
function dueTarget(plot: PlotState, def: ScenarioPlot, runner: FlowRunnerState, ctx: CycleCtx): number | null {
  const { steps } = def.flow;
  const step = steps[runner.stepIndex];
  const view = { plot, runner, inventory: ctx.state.inventory, cycleSeconds: ctx.cycleSeconds };
  const indexOf = (id: string) => steps.findIndex((s) => s.id === id);

  for (const route of step.routes ?? []) {
    const to = indexOf(route.to);
    if (to >= 0 && conditionsHold(route.when, route.match, view)) return to;
  }
  if (runner.finished) return null; // the normal exit already has nowhere to go
  if (!stepExitHolds(step.exit, view, step.exitMatch)) return null;
  if (step.next !== undefined) {
    const to = indexOf(step.next);
    if (to >= 0) return to;
  }
  const isLast = runner.stepIndex === steps.length - 1;
  if (isLast && !def.flow.loop) {
    runner.finished = true; // holds its final step (routes can still move it); the other plots keep running
    return null;
  }
  return (runner.stepIndex + 1) % steps.length;
}

/**
 * The flow step for one plot. A step change is due if one was already
 * pending (it became due while the player was away) or the current step's
 * routes or exit hold now (see `dueTarget`). If the player is online it
 * happens now and this returns true; otherwise it is left pending, with its
 * target, for the next session.
 */
export function endStepOrHold(
  plot: PlotState,
  def: ScenarioPlot,
  runner: FlowRunnerState,
  ctx: CycleCtx,
  scratch: TickScratch,
  playerOnline: boolean
): boolean {
  let to: number;
  if (runner.pendingTransition) {
    to = runner.pendingTarget ?? (runner.stepIndex + 1) % def.flow.steps.length;
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
