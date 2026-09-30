import { kindDef } from "../data/load";
import type { GameData } from "../data/types";
import { RARE_DROP_ITEMS } from "../economy/bounty";
import { RARE_CROP_ITEMS } from "../economy/rareCrops";
import { ALOE_FRAGMENT } from "../growth/aloe";
import type { Scenario } from "../sim/state";
import { resolveLayout } from "./layout";
import type { Condition, Trigger } from "./types";

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

/**
 * Reject scenarios that cannot run, and warn about flows that can never
 * leave a step - that class of mistake is otherwise invisible until a run
 * just sits there. Validation never changes the scenario.
 */
export function validateScenario(scenario: Scenario, data: GameData): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const err = (path: string, message: string) => issues.push({ level: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ level: "warning", path, message });

  if (scenario.plots.length === 0) err("plots", "at least one plot is required");
  if (scenario.plots.length > MAX_PLOTS) err("plots", `at most ${MAX_PLOTS} plots`);
  const ids = scenario.plots.map((p) => p.id);
  if (new Set(ids).size !== ids.length) err("plots", "plot ids must be unique");
  const order = scenario.settings.config.plotOrder;
  for (const id of ids) {
    if (!order.includes(id)) err("settings.config.plotOrder", `plot ${id} is missing from plotOrder`);
  }

  for (const [item, qty] of Object.entries(scenario.startingInventory)) {
    if (!isKnownItem(data, item)) err(`startingInventory.${item}`, "unknown item");
    if (!Number.isFinite(qty) || qty < 0) err(`startingInventory.${item}`, "quantity must be >= 0");
  }

  if (scenario.settings.activity.kind === "everyN" && !(scenario.settings.activity.n >= 1)) {
    err("settings.activity.n", "must be at least 1");
  }

  scenario.plots.forEach((plot, pi) => {
    const base = `plots[${pi}] (plot ${plot.id})`;
    const { steps } = plot.flow;
    if (steps.length === 0) {
      err(base, "a flow needs at least one step");
      return;
    }
    if (plot.flow.startIndex < 0 || plot.flow.startIndex >= steps.length) err(`${base}.flow.startIndex`, "out of range");
    const stepIds = steps.map((s) => s.id);
    if (new Set(stepIds).size !== stepIds.length) err(`${base}.flow`, "step ids must be unique");

    steps.forEach((step, si) => {
      const path = `${base}.steps[${si}] "${step.label || step.id}"`;
      const { resolved, issues: layoutIssues } = resolveLayout(step.layout, data);
      for (const m of layoutIssues) err(`${path}.layout`, m);
      const kinds = new Set(resolved.plants.map((p) => p.kindId));

      const isLast = si === steps.length - 1;
      const routes = step.routes ?? [];
      if (step.exit.length === 0 && routes.length === 0 && (!isLast || plot.flow.loop) && steps.length > 1) {
        warn(`${path}.exit`, "no exit triggers: the plot will stay on this step forever");
      }
      const known = (id: string) => stepIds.includes(id);
      if (step.next !== undefined && !known(step.next)) err(`${path}.next`, `goes to step "${step.next}", which does not exist`);
      const checkList = (list: Condition[], where: string) => {
        for (const c of list) checkCondition(c, where, kinds, resolved.slots.length, known);
      };
      checkList(step.exit, `${path}.exit`);
      routes.forEach((route, ri) => {
        const where = `${path}.routes[${ri}]`;
        if (!known(route.to)) err(where, `goes to step "${route.to}", which does not exist`);
        if (route.when.length === 0) warn(where, "has no conditions, so it never fires");
        checkList(route.when, where);
      });
      if (step.watch && layoutIssues.length === 0) {
        const slotKeys = new Set(resolved.slots.map((s) => `${s.row},${s.col}`));
        const stale = step.watch.filter((k) => !slotKeys.has(k));
        if (stale.length) warn(`${path}.watch`, `watched cell${stale.length === 1 ? "" : "s"} ${stale.join(" ")} ${stale.length === 1 ? "is" : "are"} not a target in this layout and will be ignored`);
      }
    });
  });

  function checkCondition(c: Condition, path: string, kinds: Set<string>, slotCount: number, known: (id: string) => boolean) {
    if (c.kind === "group") {
      if (c.of.length === 0) warn(path, "an empty AND/OR group never holds");
      for (const inner of c.of) checkCondition(inner, path, kinds, slotCount, known);
      return;
    }
    if (c.kind === "stepVisits") {
      if (!(c.count >= 1)) err(path, "step visits count must be >= 1");
      if (c.sinceStep !== undefined && !known(c.sinceStep)) err(path, `counts since step "${c.sinceStep}", which does not exist`);
      return;
    }
    checkTrigger(c, path, kinds, slotCount);
  }

  function checkTrigger(t: Exclude<Trigger, { kind: "stepVisits" }>, path: string, kinds: Set<string>, slotCount: number) {
    switch (t.kind) {
      case "cycles":
        if (!(t.n >= 1)) err(path, "cycles trigger needs n >= 1");
        break;
      case "inventoryAtLeast":
      case "inventoryBelow":
        if (!isKnownItem(data, t.item)) err(path, `unknown item "${t.item}"`);
        if (!(t.qty >= 0)) err(path, "quantity must be >= 0");
        break;
      case "decayImminent":
        if (!(t.withinCycles >= 0)) err(path, "withinCycles must be >= 0");
        break;
      case "plantDecayed":
        if (!kindDef(data, t.kindId)) err(path, `unknown plant "${t.kindId}"`);
        break;
      case "targetsFilled":
        if (!(t.count >= 0)) err(path, "count must be >= 0 (0 = every target)");
        else if (slotCount === 0) warn(path, "this step's layout has no targets, so this trigger can never fire");
        else if (t.count > slotCount) warn(path, `the layout has only ${slotCount} targets, so ${t.count} can never be filled`);
        break;
      case "fullyGrown":
      case "mutationSpawned":
      case "mutationHarvested": {
        const m = data.mutations[t.mutationId];
        if (!m) {
          err(path, `unknown mutation "${t.mutationId}"`);
          break;
        }
        if (t.kind !== "fullyGrown" && !(t.count >= 1)) err(path, "count must be >= 1");
        if (t.kind === "fullyGrown" && t.count !== undefined && !(t.count >= 1)) err(path, "count must be >= 1");
        if (m.spawnWeight <= 0 && m.id !== "shellfruit") {
          err(path, `${m.name} never spawns from the weighted roll, so this trigger can never fire`);
          break;
        }
        const missing = m.requirements.filter((r) => !kinds.has(r.crop)).map((r) => r.crop);
        if (missing.length && m.special !== "requires_zero_adjacent") {
          warn(path, `this step's layout has no ${missing.join(", ")}, so ${m.name} can only appear if they spawn first`);
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
