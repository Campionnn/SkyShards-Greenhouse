import { kindDef } from "../data/load";
import type { GameData } from "../data/types";
import { RARE_DROP_ITEMS } from "../economy/bounty";
import { RARE_CROP_ITEMS } from "../economy/rareCrops";
import { ALOE_FRAGMENT } from "../stage/aloe";
import type { Scenario } from "../sim/state";
import { resolveLayout } from "./layout";
import type { Trigger } from "./types";

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
 * leave a stage - that class of mistake is otherwise invisible until a run
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
    const { stages } = plot.flow;
    if (stages.length === 0) {
      err(base, "a flow needs at least one stage");
      return;
    }
    if (plot.flow.startIndex < 0 || plot.flow.startIndex >= stages.length) err(`${base}.flow.startIndex`, "out of range");
    const stageIds = stages.map((s) => s.id);
    if (new Set(stageIds).size !== stageIds.length) err(`${base}.flow`, "stage ids must be unique");

    stages.forEach((stage, si) => {
      const path = `${base}.stages[${si}] "${stage.label || stage.id}"`;
      const { resolved, issues: layoutIssues } = resolveLayout(stage.layout, data);
      for (const m of layoutIssues) err(`${path}.layout`, m);
      const kinds = new Set(resolved.plants.map((p) => p.kindId));

      const isLast = si === stages.length - 1;
      if (stage.exit.length === 0 && (!isLast || plot.flow.loop) && stages.length > 1) {
        warn(`${path}.exit`, "no exit triggers: the plot will stay on this stage forever");
      }
      for (const t of stage.exit) checkTrigger(t, `${path}.exit`, kinds);
    });
  });

  function checkTrigger(t: Trigger, path: string, kinds: Set<string>) {
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
      case "fullyGrown":
      case "mutationSpawned": {
        const m = data.mutations[t.mutationId];
        if (!m) {
          err(path, `unknown mutation "${t.mutationId}"`);
          break;
        }
        if (t.kind === "mutationSpawned" && !(t.count >= 1)) err(path, "count must be >= 1");
        if (m.spawnWeight <= 0 && m.id !== "shellfruit") {
          err(path, `${m.name} never spawns from the weighted roll, so this trigger can never fire`);
          break;
        }
        const missing = m.requirements.filter((r) => !kinds.has(r.crop)).map((r) => r.crop);
        if (missing.length && m.special !== "requires_zero_adjacent") {
          warn(path, `this stage's layout has no ${missing.join(", ")}, so ${m.name} can only appear if they spawn first`);
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
