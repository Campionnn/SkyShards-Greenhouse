import type { CycleCtx, TickScratch } from "../sim/context";
import { applyStepLayout } from "../sim/placement";
import type { FlowRunnerState, PlotState, ScenarioPlot, TickEvent } from "../sim/state";
import { bump } from "../sim/summary";
import { conditionsHold } from "./triggers";

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
 * Target step index, or null to stay. Exits are checked in order; the first
 * that holds and has somewhere to go wins. An exit to "the following step" on
 * the last step of a non-looping flow has nowhere to go: it marks the runner
 * finished and the later exits are still checked. Unknown step ids are skipped
 * (validation reports them).
 */
function dueTarget(plot: PlotState, def: ScenarioPlot, runner: FlowRunnerState, ctx: CycleCtx): number | null {
  const { steps } = def.flow;
  const step = steps[runner.stepIndex];
  const view = { plot, runner, inventory: ctx.state.inventory, cycleSeconds: ctx.cycleSeconds };
  const isLast = runner.stepIndex === steps.length - 1;

  for (const exit of step.exits) {
    let to: number;
    if (exit.to !== undefined) {
      to = steps.findIndex((s) => s.id === exit.to);
      if (to < 0) continue;
    } else if (isLast && !def.flow.loop) {
      if (!runner.finished && conditionsHold(exit.when, exit.match, view)) runner.finished = true;
      continue;
    } else {
      to = (runner.stepIndex + 1) % steps.length;
    }
    if (conditionsHold(exit.when, exit.match, view)) return to;
  }
  return null;
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
