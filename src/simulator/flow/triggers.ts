import { cellIndex } from "../grid/cells";
import { buildOccupancy, isFullyGrown } from "../sim/plants";
import type { FlowRunnerState, PlotState } from "../sim/state";
import type { Condition, ConditionMatch, Trigger } from "./types";

export interface TriggerView {
  plot: PlotState;
  runner: FlowRunnerState;
  /** The SHARED inventory. No trigger may look at another plot. */
  inventory: Readonly<Record<string, number>>;
  stageSeconds: number;
}

/** Plants whose ripeness a trigger can talk about: base crops and natural spawns. */
const growable = (plot: PlotState) => plot.plants.filter((p) => !p.isDeadPlant && (p.origin === "planted" || p.origin === "spawned"));

/** Pure: does this trigger hold at the end of the current cycle? */
export function triggerHolds(t: Trigger, v: TriggerView): boolean {
  switch (t.kind) {
    case "cycles":
      return v.runner.cyclesInStage >= t.n;
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
      return (v.runner.harvestedInStage?.[t.mutationId] ?? 0) >= t.count;
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
        (p) => !p.isDeadPlant && p.decaySecondsRemaining !== null && p.decaySecondsRemaining <= t.withinCycles * v.stageSeconds + 1e-6
      );
    case "plantDecayed":
      return (v.runner.decayedInStage[t.kindId] ?? 0) >= 1;
    case "mutationSpawned":
      return (v.runner.spawnedInStage[t.mutationId] ?? 0) >= t.count;
    case "stageVisits":
      return stageVisits(v.runner, t.sinceStage) >= Math.max(1, t.count);
  }
}

/**
 * How many times the plot has entered its current stage (this visit
 * included), counting back to the last time it entered `sinceStage`, or to
 * the start of the run. Read from the runner's history, so it needs no
 * extra state.
 */
export function stageVisits(runner: FlowRunnerState, sinceStage?: string): number {
  const h = runner.history;
  const current = h[h.length - 1]?.stageId;
  let n = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].stageId === current) n++;
    if (sinceStage !== undefined && h[i].stageId === sinceStage) break;
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

/** A stage's normal exit. An empty exit list holds the stage forever. */
export function stageExitHolds(exit: readonly Condition[], v: TriggerView, match?: ConditionMatch): boolean {
  return conditionsHold(exit, match, v);
}

/** Resolves a stage id to a display name; defaults to the id itself. */
export type StageNamer = (stageId: string) => string;

export function describeConditions(list: readonly Condition[], match?: ConditionMatch, stageName?: StageNamer): string {
  const joiner = match === "any" ? " or " : " and ";
  return list.map((c) => describeCondition(c, stageName)).join(joiner);
}

export function describeCondition(c: Condition, stageName?: StageNamer): string {
  if (c.kind === "group") return c.of.length === 0 ? "(empty group)" : `(${describeConditions(c.of, c.match, stageName)})`;
  return describeTrigger(c, stageName);
}

export function describeTrigger(t: Trigger, stageName: StageNamer = (id) => id): string {
  switch (t.kind) {
    case "cycles":
      return `${t.n} cycles in stage`;
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
    case "stageVisits":
      return `entered this stage ${t.count}+ times${t.sinceStage !== undefined ? ` since ${stageName(t.sinceStage)}` : ""}`;
  }
}
