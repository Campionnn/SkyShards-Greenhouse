import type { CycleCtx, TickScratch } from "../sim/context";
import { applyStepLayout } from "../sim/placement";
import type { FlowRunnerState, PlotState, ScenarioPlot, TickEvent } from "../sim/state";
import { bump } from "../sim/summary";
import { conditionsHold, stepExitHolds } from "./triggers";

// One runner per plot; plots are coupled only through the shared inventory.

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

/** Updates the in-step trigger counters; called by ctx.emit. */
export function countStepEvent(runner: FlowRunnerState, e: TickEvent): void {
  if (e.kind === "spawned") bump(runner.spawnedInStep, e.mutationId);
  else if (e.kind === "decayed") bump(runner.decayedInStep, e.kindId);
  else if (e.kind === "harvested" && e.origin === "spawned") bump((runner.harvestedInStep ??= {}), e.kindId);
}

/**
 * Player action: move to a step (default next, wrapping) and apply its layout.
 * Moving to the current step re-enters it and restarts the in-step counters.
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
  // Reset after layout: harvests/breaks during clearing count for neither step.
  runner.cyclesInStep = 0;
  runner.spawnedInStep = {};
  runner.decayedInStep = {};
  runner.harvestedInStep = {};
}

/**
 * Target step index, or null to stay. Routes in order first, then the normal
 * exit (`next`, else the following step). The last step of a non-looping flow
 * without `next` marks the runner finished. Unknown step ids are ignored
 * (validation reports them).
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
    runner.finished = true; // routes can still move it
    return null;
  }
  return (runner.stepIndex + 1) % steps.length;
}

/**
 * Performs a due step change (pending or `dueTarget`) if the player is online
 * and returns true; otherwise records it as pending for the next session.
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
