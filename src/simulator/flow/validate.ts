import { kindDef } from "../data/load";
import type { GameData } from "../data/types";
import { RARE_DROP_ITEMS } from "../economy/bounty";
import { RARE_CROP_ITEMS } from "../economy/rareCrops";
import { ALOE_FRAGMENT } from "../growth/aloe";
import type { Scenario } from "../sim/state";
import { resolveLayout } from "./layout";
import { describeTrigger } from "./triggers";
import type { Condition, Trigger } from "./types";
import { checkScript, checkScriptExpression } from "../script/check";

export interface ScenarioIssue {
  level: "error" | "warning";
  path: string;
  message: string;
}

export class ScenarioError extends Error {
  readonly issues: ScenarioIssue[];
  constructor(issues: ScenarioIssue[]) {
    super(`Invalid scenario:\n- ${issues.map((i) => `${i.path}: ${i.message}`).join("\n- ")}`);
    this.name = "ScenarioError";
    this.issues = issues;
  }
}

export const MAX_PLOTS = 3;

function isKnownItem(data: GameData, item: string): boolean {
  return (
    !!kindDef(data, item) ||
    item === "seeds" ||
    item === ALOE_FRAGMENT ||
    RARE_DROP_ITEMS.includes(item) ||
    RARE_CROP_ITEMS.includes(item)
  );
}

/** "a", "a and b", "a, b and c". */
function listText(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Where an issue is, as the user sees it: "Plot 1 › Step 3 "Full Harvest" › Leave when". */
const SEP = " › ";

/**
 * Errors for scenarios that cannot run; warnings for steps that can never exit.
 * Paths and messages are written for players, not developers. Does not modify the scenario.
 */
export function validateScenario(scenario: Scenario, data: GameData): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const err = (path: string, message: string) => issues.push({ level: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ level: "warning", path, message });
  const nameOf = (id: string) => kindDef(data, id)?.name ?? id.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());

  if (scenario.plots.length === 0) err("Plots", "Add at least one plot.");
  if (scenario.plots.length > MAX_PLOTS) err("Plots", `You can use at most ${MAX_PLOTS} plots.`);
  const ids = scenario.plots.map((p) => p.id);
  if (new Set(ids).size !== ids.length) err("Plots", "Two plots have the same number. Each plot needs its own number.");
  const order = scenario.settings.config.plotOrder;
  for (const id of ids) {
    if (!order.includes(id)) err(`Advanced settings${SEP}Plot order`, `Plot ${id} is missing from the plot order.`);
  }

  for (const [item, qty] of Object.entries(scenario.startingInventory)) {
    const where = `Starting inventory${SEP}${nameOf(item)}`;
    if (!isKnownItem(data, item)) err(where, `"${item}" isn't an item the simulator knows about. Remove it from the inventory.`);
    if (!Number.isFinite(qty) || qty < 0) err(where, "The amount can't be negative.");
  }

  if (scenario.settings.activity.kind === "everyN" && !(scenario.settings.activity.n >= 1)) {
    err("Schedule", `"Every N cycles" must be at least 1.`);
  }

  if (scenario.script) checkScript(scenario.script.source, scenario.script.enabled, "Controller script", "controller", issues);

  scenario.plots.forEach((plot) => {
    const base = `Plot ${plot.id}`;
    if (plot.script) checkScript(plot.script.source, plot.script.enabled, `${base}${SEP}Script`, "plot", issues);
    const { steps } = plot.flow;
    if (steps.length === 0) {
      err(base, "This plot's flow has no steps. Add at least one step.");
      return;
    }
    if (plot.flow.startIndex < 0 || plot.flow.startIndex >= steps.length) {
      err(`${base}${SEP}Starting step`, "The starting step doesn't exist. Pick a starting step in the flow editor.");
    }
    const stepIds = steps.map((s) => s.id);
    if (new Set(stepIds).size !== stepIds.length) err(`${base}${SEP}Steps`, "Two steps have the same id. Each step needs its own id.");
    const known = (id: string) => stepIds.includes(id);
    const stepTitle = (si: number) => {
      const label = steps[si].label?.trim();
      return !label || label.toLowerCase() === `step ${si + 1}` ? `Step ${si + 1}` : `Step ${si + 1} "${label}"`;
    };
    const stepName = (id: string) => {
      const i = stepIds.indexOf(id);
      return i < 0 ? `"${id}"` : stepTitle(i);
    };

    steps.forEach((step, si) => {
      const path = `${base}${SEP}${stepTitle(si)}`;
      const { resolved, issues: layoutIssues } = resolveLayout(step.layout, data);
      for (const m of layoutIssues) err(`${path}${SEP}Layout`, m);
      const kinds = new Set(resolved.plants.map((p) => p.kindId));

      const isLast = si === steps.length - 1;
      if (step.exits.length === 0 && (!isLast || plot.flow.loop) && steps.length > 1) {
        warn(path, "This step has no way out, so the plot will stay on it forever. Add a \"Leave this step\" exit.");
      }
      const checkList = (list: Condition[], where: string) => {
        for (const c of list) checkCondition(c, where, kinds, resolved.slots.length, known, stepName);
      };
      step.exits.forEach((exit, ei) => {
        const one = step.exits.length === 1;
        const target = exit.to === undefined ? "" : known(exit.to) ? ` (to ${stepName(exit.to)})` : "";
        const where = `${path}${SEP}${one ? "Leave when" : `Exit ${ei + 1}${target}`}`;
        if (exit.to !== undefined && !known(exit.to)) err(where, `It goes to step "${exit.to}", which no longer exists. Pick another step or remove the exit.`);
        if (exit.when.length === 0) warn(where, "This exit has no conditions, so it will never be taken.");
        checkList(exit.when, where);
      });
      if (step.watch && layoutIssues.length === 0) {
        const slotKeys = new Set(resolved.slots.map((s) => `${s.row},${s.col}`));
        const stale = step.watch.filter((k) => !slotKeys.has(k));
        if (stale.length) {
          const one = stale.length === 1;
          warn(
            `${path}${SEP}Checked targets`,
            `${one ? "Cell" : "Cells"} ${stale.map((k) => `(${k})`).join(", ")} ${one ? "is" : "are"} checked but ${one ? "isn't a target" : "aren't targets"} in this step's layout any more, so ${one ? "it is" : "they are"} ignored.`
          );
        }
      }
    });
  });

  function checkCondition(
    c: Condition,
    where: string,
    kinds: Set<string>,
    slotCount: number,
    known: (id: string) => boolean,
    stepName: (id: string) => string
  ) {
    if (c.kind === "group") {
      if (c.of.length === 0) warn(where, "An empty AND/OR group is never true. Add a condition to it or remove it.");
      for (const inner of c.of) checkCondition(inner, where, kinds, slotCount, known, stepName);
      return;
    }
    const path = `${where} "${describeTrigger(c, stepName, nameOf)}"`;
    if (c.kind === "script") {
      const problem = checkScriptExpression(c.expr);
      if (problem) err(path, problem);
      return;
    }
    if (c.kind === "stepVisits") {
      if (!(c.count >= 1)) err(path, "The number of times must be at least 1.");
      if (c.sinceStep !== undefined && !known(c.sinceStep)) {
        err(path, `It counts visits since step "${c.sinceStep}", which no longer exists. Pick another step.`);
      }
      return;
    }
    checkTrigger(c, path, kinds, slotCount);
  }

  function checkTrigger(t: Exclude<Trigger, { kind: "stepVisits" | "script" }>, path: string, kinds: Set<string>, slotCount: number) {
    switch (t.kind) {
      case "cycles":
        if (!(t.n >= 1)) err(path, "The number of cycles must be at least 1.");
        break;
      case "inventoryAtLeast":
      case "inventoryBelow":
      case "collectedAtLeast":
        if (!isKnownItem(data, t.item)) err(path, `"${t.item}" isn't an item the simulator knows about. Pick another item.`);
        if (!(t.qty >= 0)) err(path, "The amount can't be negative.");
        break;
      case "decayImminent":
        if (!(t.withinCycles >= 0)) err(path, "The number of cycles can't be negative.");
        break;
      case "plantDecayed":
        if (!kindDef(data, t.kindId)) err(path, `"${t.kindId}" isn't a plant the simulator knows about. Pick another plant.`);
        break;
      case "targetsFilled":
        if (!(t.count >= 0)) err(path, "The count can't be negative (0 means every target).");
        else if (slotCount === 0) warn(path, "This step's layout has no target cells, so this condition can never be met.");
        else if (t.count > slotCount) {
          warn(path, `This step's layout only has ${slotCount} target${slotCount === 1 ? "" : "s"}, so ${t.count} can never be filled.`);
        }
        break;
      case "fullyGrown":
      case "mutationSpawned":
      case "mutationHarvested": {
        const m = data.mutations[t.mutationId];
        if (!m) {
          err(path, `"${t.mutationId}" isn't a mutation the simulator knows about. Pick another mutation.`);
          break;
        }
        if (t.kind !== "fullyGrown" && !(t.count >= 1)) err(path, "The count must be at least 1.");
        if (t.kind === "fullyGrown" && t.count !== undefined && !(t.count >= 1)) err(path, "The count must be at least 1.");
        if (m.spawnWeight <= 0 && m.id !== "shellfruit") {
          err(path, `${m.name} never spawns naturally, so this condition can never be met.`);
          break;
        }
        const missing = m.requirements.filter((r) => !kinds.has(r.crop)).map((r) => nameOf(r.crop));
        if (missing.length && m.special !== "requires_zero_adjacent") {
          const what = listText(missing);
          warn(
            path,
            `${m.name} needs ${what} next to it to spawn, but this step's layout doesn't have ${missing.length === 1 ? "any" : "them"}. ` +
              `Unless ${missing.length === 1 ? "it gets" : "they get"} onto the plot some other way (for example by spawning there first), this condition may never be met.`
          );
        }
        break;
      }
      case "lowestStageAtLeast":
      case "lowestStageBelow":
      case "highestStageAtLeast":
      case "highestStageBelow": {
        const m = data.mutations[t.mutationId];
        if (!m) {
          err(path, `"${t.mutationId}" isn't a mutation the simulator knows about. Pick another mutation.`);
          break;
        }
        if (!(t.stage >= 0)) {
          err(path, "The stage can't be negative.");
          break;
        }
        const max = m.growthStages ?? 0;
        if (t.stage > max) {
          warn(
            path,
            t.kind === "lowestStageAtLeast" || t.kind === "highestStageAtLeast"
              ? `${m.name} only grows to stage ${max}, so this condition can never be met.`
              : `${m.name} only grows to stage ${max}, so this condition always holds.`
          );
        }
        break;
      }
      case "allFullyGrown":
      case "noneFullyGrown":
        break;
    }
  }

  return issues;
}
