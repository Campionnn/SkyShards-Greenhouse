import type { CycleCtx, TickScratch } from "../sim/context";
import { applyStepLayout } from "../sim/placement";
import type { FlowRunnerState, PlotState, ScenarioPlot, TickEvent } from "../sim/state";
import { bump } from "../sim/summary";
import { collectedOf, conditionsHold } from "./triggers";

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

  runner.pendingTransition = false;
  delete runner.pendingTarget;
  runner.finished = false;
  const target = toIndex >= 0 && toIndex < steps.length ? toIndex : (runner.stepIndex + 1) % steps.length;
  const skipped = skipThrough(plot, def, runner, ctx, target);
  const to = steps[runner.stepIndex];
  runner.history.push({ stepId: to.id, stepIndex: runner.stepIndex, startCycle: ctx.cycle, endCycle: null });

  ctx.emit(plot.id, {
    kind: "stepChanged",
    fromStep: from.id,
    toStep: to.id,
    stepIndex: runner.stepIndex,
    ...(skipped.length ? { skipped } : {}),
  });
  applyStepLayout(plot, ctx.layoutFor(plot.id), ctx, scratch, !!to.fullClear);
  resetStepCounters(runner);
}

/** Reset after layout: harvests/breaks during clearing count for neither step. */
function resetStepCounters(runner: FlowRunnerState): void {
  runner.cyclesInStep = 0;
  runner.spawnedInStep = {};
  runner.decayedInStep = {};
  runner.harvestedInStep = {};
}

/**
 * Exits with `checkOnEntry`: before building the step at `index`, check its
 * flagged exits (in order, the others are ignored here) as if just entered
 * (fresh counters, this visit counted, its own targets) against the plot as it
 * stands now. If one holds, pass through without building the step and repeat
 * for the step that exit names. Each pass-through is recorded in history as
 * `skipped` (zero length). Stops on a step with no flagged exit that holds, or
 * a step already passed through this change (no endless loops). Leaves
 * `runner.stepIndex` on the step to build; returns the ids passed through.
 * Reads only; places and removes nothing.
 */
function skipThrough(plot: PlotState, def: ScenarioPlot, runner: FlowRunnerState, ctx: CycleCtx, index: number): string[] {
  const steps = def.flow.steps;
  const skipped: string[] = [];
  const seen = new Set<number>();
  let idx = index;
  for (;;) {
    runner.stepIndex = idx;
    const step = steps[idx];
    if (!step.exits.some((e) => e.checkOnEntry) || seen.has(idx)) return skipped;
    seen.add(idx);
    const entry = { stepId: step.id, stepIndex: idx, startCycle: ctx.cycle, endCycle: ctx.cycle, skipped: true };
    runner.history.push(entry);
    resetStepCounters(runner);
    runner.finished = false;
    const lookahead = { ...plot, slots: ctx.layoutFor(plot.id).slots };
    const next = dueTarget(lookahead, def, runner, ctx, true);
    if (next === null) {
      // Stays here (or holds it as the finished last step): build it after all.
      runner.history.pop();
      return skipped;
    }
    skipped.push(step.id);
    idx = next;
  }
}

/**
 * Target step index, or null to stay. Exits are checked in order; the first
 * that holds and has somewhere to go wins. An exit to "the following step" on
 * the last step of a non-looping flow has nowhere to go: it marks the runner
 * finished and the later exits are still checked. Unknown step ids are skipped
 * (validation reports them). `onEntry`: only the exits flagged `checkOnEntry`.
 */
function dueTarget(plot: PlotState, def: ScenarioPlot, runner: FlowRunnerState, ctx: CycleCtx, onEntry = false): number | null {
  const { steps } = def.flow;
  const step = steps[runner.stepIndex];
  const view = {
    plot,
    runner,
    inventory: ctx.state.inventory,
    cycleSeconds: ctx.cycleSeconds,
    collected: (item: string) => collectedOf(ctx.state, item),
    layout: ctx.layoutFor(plot.id), // the step at runner.stepIndex (also during an on-arrival check)
  };
  const isLast = runner.stepIndex === steps.length - 1;

  for (const exit of step.exits) {
    if (onEntry && !exit.checkOnEntry) continue;
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
