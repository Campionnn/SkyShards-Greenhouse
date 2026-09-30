import { cellIndex } from "../grid/cells";
import { buildOccupancy, isFullyGrown } from "../sim/plants";
import type { FlowRunnerState, PlotState } from "../sim/state";
import type { Condition, ConditionMatch, Trigger } from "./types";

export interface TriggerView {
  plot: PlotState;
  runner: FlowRunnerState;
  /** The SHARED inventory. No trigger may look at another plot. */
  inventory: Readonly<Record<string, number>>;
  cycleSeconds: number;
}

/** Plants whose ripeness a trigger can talk about: base crops and natural spawns. */
const growable = (plot: PlotState) => plot.plants.filter((p) => !p.isDeadPlant && (p.origin === "planted" || p.origin === "spawned"));

/** Pure: does this trigger hold at the end of the current cycle? */
export function triggerHolds(t: Trigger, v: TriggerView): boolean {
  switch (t.kind) {
    case "cycles":
      return v.runner.cyclesInStep >= t.n;
    case "inventoryAtLeast":
      return (v.inventory[t.item] ?? 0) >= t.qty;
    case "inventoryBelow":
      return (v.inventory[t.item] ?? 0) < t.qty;
    case "allFullyGrown": {
      const plants = growable(v.plot);
      return plants.length > 0 && plants.every(isFullyGrown);
    }
    case "noneFullyGrown":
      return !growable(v.plot).some(isFullyGrown);
    case "fullyGrown": {
      const n = v.plot.plants.filter((p) => p.kindId === t.mutationId && p.origin === "spawned" && isFullyGrown(p)).length;
      return n >= Math.max(1, t.count ?? 1);
    }
    case "mutationHarvested":
      return (v.runner.harvestedInStep?.[t.mutationId] ?? 0) >= t.count;
    case "targetsFilled": {
      const slots = v.plot.slots;
      if (slots.length === 0) return false;
      const occ = buildOccupancy(v.plot);
      const filled = slots.filter((s) => {
        const q = occ[cellIndex(s.row, s.col)];
        return !!q && !q.isDeadPlant && q.kindId === s.mutationId && q.row === s.row && q.col === s.col;
      }).length;
      return t.count <= 0 ? filled === slots.length : filled >= t.count;
    }
    case "decayImminent":
      return v.plot.plants.some(
        (p) => !p.isDeadPlant && p.decaySecondsRemaining !== null && p.decaySecondsRemaining <= t.withinCycles * v.cycleSeconds + 1e-6
      );
    case "plantDecayed":
      return (v.runner.decayedInStep[t.kindId] ?? 0) >= 1;
    case "mutationSpawned":
      return (v.runner.spawnedInStep[t.mutationId] ?? 0) >= t.count;
    case "stepVisits":
      return stepVisits(v.runner, t.sinceStep) >= Math.max(1, t.count);
  }
}

/**
 * How many times the plot has entered its current step (this visit
 * included), counting back to the last time it entered `sinceStep`, or to
 * the start of the run. Read from the runner's history, so it needs no
 * extra state.
 */
export function stepVisits(runner: FlowRunnerState, sinceStep?: string): number {
  const h = runner.history;
  const current = h[h.length - 1]?.stepId;
  let n = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].stepId === current) n++;
    if (sinceStep !== undefined && h[i].stepId === sinceStep) break;
  }
  return n;
}

/** Pure: does this condition (a leaf trigger or an AND / OR group) hold? An empty group never holds. */
export function conditionHolds(c: Condition, v: TriggerView): boolean {
  if (c.kind === "group") return conditionsHold(c.of, c.match, v);
  return triggerHolds(c, v);
}

/** A condition list combined by `match` (default "all"). An empty list never holds. */
export function conditionsHold(list: readonly Condition[], match: ConditionMatch | undefined, v: TriggerView): boolean {
  if (list.length === 0) return false;
  return match === "any" ? list.some((c) => conditionHolds(c, v)) : list.every((c) => conditionHolds(c, v));
}

/** A step's normal exit. An empty exit list holds the step forever. */
export function stepExitHolds(exit: readonly Condition[], v: TriggerView, match?: ConditionMatch): boolean {
  return conditionsHold(exit, match, v);
}

/** Resolves a step id to a display name; defaults to the id itself. */
export type StepNamer = (stepId: string) => string;

export function describeConditions(list: readonly Condition[], match?: ConditionMatch, stepName?: StepNamer): string {
  const joiner = match === "any" ? " or " : " and ";
  return list.map((c) => describeCondition(c, stepName)).join(joiner);
}

export function describeCondition(c: Condition, stepName?: StepNamer): string {
  if (c.kind === "group") return c.of.length === 0 ? "(empty group)" : `(${describeConditions(c.of, c.match, stepName)})`;
  return describeTrigger(c, stepName);
}

export function describeTrigger(t: Trigger, stepName: StepNamer = (id) => id): string {
  switch (t.kind) {
    case "cycles":
      return `${t.n} cycles in step`;
    case "inventoryAtLeast":
      return `inventory ${t.item} >= ${t.qty}`;
    case "inventoryBelow":
      return `inventory ${t.item} < ${t.qty}`;
    case "allFullyGrown":
      return "everything fully grown";
    case "noneFullyGrown":
      return "nothing fully grown";
    case "fullyGrown":
      return (t.count ?? 1) > 1 ? `${t.count} x ${t.mutationId} fully grown` : `${t.mutationId} fully grown`;
    case "mutationHarvested":
      return `${t.count} x ${t.mutationId} harvested`;
    case "targetsFilled":
      return t.count <= 0 ? "every target filled" : `${t.count} targets filled`;
    case "decayImminent":
      return `something decays within ${t.withinCycles} cycles`;
    case "plantDecayed":
      return `a ${t.kindId} decayed`;
    case "mutationSpawned":
      return `${t.count} x ${t.mutationId} spawned`;
    case "stepVisits":
      return `entered this step ${t.count}+ times${t.sinceStep !== undefined ? ` since ${stepName(t.sinceStep)}` : ""}`;
  }
}
