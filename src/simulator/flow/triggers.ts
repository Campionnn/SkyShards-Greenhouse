import { cellIndex } from "../grid/cells";
import { wouldDecayWithin } from "../sim/decay";
import { buildOccupancy, DEAD_PLANT, isFullyGrown } from "../sim/plants";
import type { FlowRunnerState, PlotState } from "../sim/state";
import type { Condition, ConditionMatch, Trigger } from "./types";

export interface TriggerView {
  plot: PlotState;
  runner: FlowRunnerState;
  /** Shared inventory. Triggers never read another plot. */
  inventory: Readonly<Record<string, number>>;
  cycleSeconds: number;
}

/** Base crops and natural spawns (the plants growth triggers consider). */
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
    case "lowestStageAtLeast":
      return lowestStageAtLeast(v.plot, t.mutationId, t.stage);
    case "lowestStageBelow":
      return !lowestStageAtLeast(v.plot, t.mutationId, t.stage);
    case "highestStageAtLeast":
      return highestStageAtLeast(v.plot, t.mutationId, t.stage);
    case "highestStageBelow":
      return !highestStageAtLeast(v.plot, t.mutationId, t.stage);
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
      // Actually decays (timer out and minimum mutations met), not just extended. Dead plants excluded.
      return v.plot.plants.some((p) => p.kindId !== DEAD_PLANT && !p.isDeadPlant && wouldDecayWithin(v.plot, p, t.withinCycles * v.cycleSeconds));
    case "plantDecayed":
      return (v.runner.decayedInStep[t.kindId] ?? 0) >= 1;
    case "mutationSpawned":
      return (v.runner.spawnedInStep[t.mutationId] ?? 0) >= t.count;
    case "stepVisits":
      return stepVisits(v.runner, t.sinceStep) >= Math.max(1, t.count);
  }
}

/** At least one plant of `mutationId` stands on the plot (Dead Plants excluded) and none is below `stage`. */
function lowestStageAtLeast(plot: PlotState, mutationId: string, stage: number): boolean {
  const plants = plot.plants.filter((p) => p.kindId === mutationId && !p.isDeadPlant);
  return plants.length > 0 && plants.every((p) => p.stage >= stage);
}

/** Some plant of `mutationId` on the plot (Dead Plants excluded) is at `stage` or higher. */
function highestStageAtLeast(plot: PlotState, mutationId: string, stage: number): boolean {
  return plot.plants.some((p) => p.kindId === mutationId && !p.isDeadPlant && p.stage >= stage);
}

/** Entries into the current step (this one included) since `sinceStep` was last entered or run start; from history. */
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

/** Leaf trigger or AND/OR group. An empty group never holds. */
export function conditionHolds(c: Condition, v: TriggerView): boolean {
  if (c.kind === "group") return conditionsHold(c.of, c.match, v);
  return triggerHolds(c, v);
}

/** A condition list combined by `match` (default "all"). An empty list never holds. */
export function conditionsHold(list: readonly Condition[], match: ConditionMatch | undefined, v: TriggerView): boolean {
  if (list.length === 0) return false;
  return match === "any" ? list.some((c) => conditionHolds(c, v)) : list.every((c) => conditionHolds(c, v));
}

/** Resolves a step id to a display name; defaults to the id itself. */
export type StepNamer = (stepId: string) => string;

/** Resolves an item, plant or mutation id to a display name; defaults to the id itself. */
export type ItemNamer = (id: string) => string;

export function describeConditions(list: readonly Condition[], match?: ConditionMatch, stepName?: StepNamer, itemName?: ItemNamer): string {
  const joiner = match === "any" ? " or " : " and ";
  return list.map((c) => describeCondition(c, stepName, itemName)).join(joiner);
}

export function describeCondition(c: Condition, stepName?: StepNamer, itemName?: ItemNamer): string {
  if (c.kind === "group") return c.of.length === 0 ? "(empty group)" : `(${describeConditions(c.of, c.match, stepName, itemName)})`;
  return describeTrigger(c, stepName, itemName);
}

export function describeTrigger(t: Trigger, stepName: StepNamer = (id) => id, itemName: ItemNamer = (id) => id): string {
  switch (t.kind) {
    case "cycles":
      return `${t.n} cycles in step`;
    case "inventoryAtLeast":
      return `inventory ${itemName(t.item)} >= ${t.qty}`;
    case "inventoryBelow":
      return `inventory ${itemName(t.item)} < ${t.qty}`;
    case "allFullyGrown":
      return "everything fully grown";
    case "noneFullyGrown":
      return "nothing fully grown";
    case "fullyGrown":
      return (t.count ?? 1) > 1 ? `${t.count} x ${itemName(t.mutationId)} fully grown` : `${itemName(t.mutationId)} fully grown`;
    case "mutationHarvested":
      return `${t.count} x ${itemName(t.mutationId)} harvested`;
    case "lowestStageAtLeast":
      return `every ${itemName(t.mutationId)} at stage ${t.stage}+`;
    case "lowestStageBelow":
      return `some ${itemName(t.mutationId)} below stage ${t.stage} (or none)`;
    case "highestStageAtLeast":
      return `some ${itemName(t.mutationId)} at stage ${t.stage}+`;
    case "highestStageBelow":
      return `every ${itemName(t.mutationId)} below stage ${t.stage} (or none)`;
    case "targetsFilled":
      return t.count <= 0 ? "every target filled" : `${t.count} targets filled`;
    case "decayImminent":
      return `something decays within ${t.withinCycles} cycles`;
    case "plantDecayed":
      return `a ${itemName(t.kindId)} decayed`;
    case "mutationSpawned":
      return `${t.count} x ${itemName(t.mutationId)} spawned`;
    case "stepVisits":
      return `entered this step ${t.count}+ times${t.sinceStep !== undefined ? ` since ${stepName(t.sinceStep)}` : ""}`;
  }
}
