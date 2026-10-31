import type { Condition, ConditionMatch, FlowStep, Scenario, ScenarioPlot, StepExit } from "../../../simulator";
import { cycleSeconds, describeCondition, effectiveUniqueCrops } from "../../../simulator";
import { layoutToPlacements } from "../scenarioEdit";
import { formatDuration, nameOf } from "../format";
import { exitTarget, type ExitTarget } from "./model";

// Shared, React-free helpers for every flow editor part (canvas, inspector, list view).

/** Exit kinds, each with its own colour everywhere (wire, socket, card, legend). */
export type ExitKind = "normal" | "arrive" | "restart" | "finish" | "missing";

export function exitKind(plot: ScenarioPlot, stepIndex: number, exit: StepExit): ExitKind {
  const t = exitTarget(plot, stepIndex, exit);
  if (t.kind === "finish") return "finish";
  if (t.kind === "missing") return "missing";
  if (t.index === stepIndex) return "restart";
  if (exit.checkOnEntry) return "arrive";
  return "normal";
}

/**
 * The colour language of exits. `stroke` / `hot` are CSS colours for SVG (design tokens, so they follow
 * the palette); `text` is a Tailwind class. Normal = grey at rest, go when highlighted.
 */
export const EXIT_STYLE: Record<ExitKind, { stroke: string; hot: string; text: string; label: string; help: string }> = {
  normal: { stroke: "var(--color-line-control)", hot: "var(--color-go)", text: "text-go-fg", label: "Exit", help: "Checked while the player is online; the first exit that holds is taken." },
  arrive: { stroke: "var(--fg-wire-arrive)", hot: "var(--color-warn)", text: "text-warn", label: "Skips this step if already true", help: "Also checked when the plot arrives: if it's already true, this step is skipped." },
  restart: { stroke: "var(--fg-wire-restart)", hot: "var(--color-restart)", text: "text-restart", label: "Restart", help: "Goes back into this same step: the layout is re-applied and its counters restart." },
  finish: { stroke: "var(--color-fg-meta)", hot: "var(--color-fg-body)", text: "text-fg-body", label: "Finish", help: "Holds this final step: the flow is finished and the plot stays here." },
  missing: { stroke: "var(--fg-wire-missing)", hot: "var(--color-problem)", text: "text-problem", label: "Missing step", help: "Goes to a step that no longer exists. Pick another step." },
};

/**
 * Seconds per growth cycle for the scenario's player stats (Crop Growth, Speed, growth upgrade, Flora
 * shard), counting no standing unique crops: the editor plans, it doesn't run. The same estimate the
 * simulator page's command bar shows.
 */
export function plannedCycleSeconds(scenario: Scenario): number {
  const s = scenario.settings.playerStats;
  return cycleSeconds(s, effectiveUniqueCrops(0, s.floraShard ?? 0));
}

/** A cycle count as time, for hints: "≈ 35 min", "≈ 2h 20m", "≈ 1d 4h". Empty when it can't be told. */
export function cycleTime(n: number, secondsPerCycle: number): string {
  if (!(n > 0) || !(secondsPerCycle > 0)) return "";
  const s = n * secondsPerCycle;
  if (s < 3600) return `≈ ${Math.max(1, Math.round(s / 60))} min`;
  return `≈ ${formatDuration(s)}`;
}

/** "20 cycles ≈ 35 min" (or just "20 cycles" when the time can't be told). */
export function cyclesWithTime(n: number, secondsPerCycle: number): string {
  const t = cycleTime(n, secondsPerCycle);
  return `${n.toLocaleString("en-US")} cycle${n === 1 ? "" : "s"}${t ? ` ${t}` : ""}`;
}

/** "3. Chorus Fruit" style name of a step. */
export const stepTitle = (s: FlowStep, i: number) => `${i + 1}. ${s.label?.trim() || s.id}`;
export const stepLabel = (s: FlowStep) => s.label?.trim() || s.id;

export function stepNamer(steps: FlowStep[]): (id: string) => string {
  return (id) => {
    const i = steps.findIndex((s) => s.id === id);
    return i < 0 ? `"${id}"` : stepTitle(steps[i], i);
  };
}

/** Target name for an exit, e.g. "4. Chorus", "This step again", "Finish (hold)". */
export function targetName(plot: ScenarioPlot, stepIndex: number, t: ExitTarget): string {
  if (t.kind === "finish") return "Finish (hold this step)";
  if (t.kind === "missing") return `Missing step "${t.id}"`;
  if (t.index === stepIndex) return "This step again (restart)";
  return stepTitle(plot.flow.steps[t.index], t.index);
}

/** One short line for an exit's conditions, for node rows and collapsed cards. */
export function conditionSummary(list: readonly Condition[], match: ConditionMatch | undefined, steps: FlowStep[], secondsPerCycle = 0): string {
  if (list.length === 0) return "never (no conditions)";
  // Long uniform lists (the Rose Dragon "every stock target met") read better as a count.
  if (list.length > 3 && list.every((c) => c.kind === list[0].kind) && list[0].kind !== "group") {
    const n = list.length;
    const all = match !== "any";
    const phrase: Partial<Record<string, string>> = {
      inventoryAtLeast: all ? `all ${n} stock amounts reached` : `any of ${n} stock amounts reached`,
      inventoryBelow: all ? `all ${n} items below their amounts` : `any of ${n} items running low`,
      collectedAtLeast: all ? `all ${n} collection totals reached` : `any of ${n} collection totals reached`,
      plantDecayed: all ? `all of ${n} plants decayed` : `any of ${n} plants decayed`,
      mutationHarvested: all ? `all ${n} harvest counts reached` : `any of ${n} harvest counts reached`,
    };
    return phrase[list[0].kind] ?? `${all ? "all" : "any"} of ${n} conditions`;
  }
  const name = stepNamer(steps);
  return list.map((c) => shortCondition(c, name, secondsPerCycle)).join(match === "any" ? " or " : " and ");
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** A compact, human phrase for one condition (node rows, collapsed cards, the phone list). */
export function shortCondition(c: Condition, stepName: (id: string) => string = (id) => id, secondsPerCycle = 0): string {
  const time = (n: number) => (cycleTime(n, secondsPerCycle) ? ` ${cycleTime(n, secondsPerCycle)}` : "");
  switch (c.kind) {
    case "group":
      return c.of.length === 0 ? "(empty group)" : `(${c.of.map((x) => shortCondition(x, stepName, secondsPerCycle)).join(c.match === "any" ? " or " : " and ")})`;
    case "cycles":
      return `${fmt(c.n)} cycle${c.n === 1 ? "" : "s"} here${time(c.n)}`;
    case "inventoryAtLeast":
      return `${fmt(c.qty)}+ ${nameOf(c.item)} in stock`;
    case "inventoryBelow":
      return `under ${fmt(c.qty)} ${nameOf(c.item)} in stock`;
    case "collectedAtLeast":
      return `${fmt(c.qty)}+ ${nameOf(c.item)} collected`;
    case "layoutShort":
      return "can't afford the layout";
    case "mutationSpawned":
      return `${fmt(c.count)} ${nameOf(c.mutationId)} spawned`;
    case "mutationHarvested":
      return `${fmt(c.count)} ${nameOf(c.mutationId)} harvested`;
    case "fullyGrown":
      return (c.count ?? 1) > 1 ? `${c.count} ${nameOf(c.mutationId)} fully grown` : `${nameOf(c.mutationId)} fully grown`;
    case "targetsFilled":
      return c.count <= 0 ? "every target filled" : `${c.count} targets filled`;
    case "plantDecayed":
      return `a ${nameOf(c.kindId)} decayed`;
    case "decayImminent":
      return `decay within ${c.withinCycles} cycle${c.withinCycles === 1 ? "" : "s"}${time(c.withinCycles)}`;
    case "highestStageBelow":
      return c.stage <= 0 ? `no ${nameOf(c.mutationId)} growing` : `every ${nameOf(c.mutationId)} below stage ${c.stage}`;
    case "lowestStageBelow":
      return `some ${nameOf(c.mutationId)} below stage ${c.stage}`;
    case "highestStageAtLeast":
      return `a ${nameOf(c.mutationId)} at stage ${c.stage}+`;
    case "lowestStageAtLeast":
      return `every ${nameOf(c.mutationId)} at stage ${c.stage}+`;
    case "stepVisits":
      return `entered ${c.count}+ times${c.sinceStep !== undefined ? ` since ${stepName(c.sinceStep)}` : ""}`;
    default:
      return describeCondition(c, stepName, nameOf);
  }
}

export interface LayoutFacts {
  /** Target mutations with counts, most first. */
  targets: [string, number][];
  plants: number;
  kinds: number;
  /** Most telling icon for the step (main target, else first plant). */
  icon: string;
  ok: boolean;
}

const factsCache = new WeakMap<object, LayoutFacts>();

/** Layout facts for nodes and lists (cached per layout object). */
export function layoutFacts(step: FlowStep): LayoutFacts {
  const hit = factsCache.get(step.layout);
  if (hit) return hit;
  let facts: LayoutFacts;
  try {
    const { inputs, targets } = layoutToPlacements(step.layout);
    const m = new Map<string, number>();
    for (const t of targets) m.set(t.cropId, (m.get(t.cropId) ?? 0) + 1);
    const sorted = [...m].sort((a, b) => b[1] - a[1]);
    facts = { targets: sorted, plants: inputs.length, kinds: new Set(inputs.map((p) => p.cropId)).size, icon: sorted[0]?.[0] ?? inputs[0]?.cropId ?? "seeds", ok: true };
  } catch {
    facts = { targets: [], plants: 0, kinds: 0, icon: "seeds", ok: false };
  }
  factsCache.set(step.layout, facts);
  return facts;
}

/** Steps that no exit leads to (other than the start step): entered only by a script. */
export function unreachedSteps(plot: ScenarioPlot): Set<number> {
  const reached = new Set<number>([plot.flow.startIndex]);
  plot.flow.steps.forEach((s, i) =>
    s.exits.forEach((e) => {
      const t = exitTarget(plot, i, e);
      if (t.kind === "step" && t.index !== i) reached.add(t.index);
    })
  );
  return new Set(plot.flow.steps.map((_, i) => i).filter((i) => !reached.has(i)));
}

/** How many steps lead into each step (incoming exits, self loops excluded). */
export function incomingCounts(plot: ScenarioPlot): number[] {
  const n = plot.flow.steps.map(() => 0);
  plot.flow.steps.forEach((s, i) =>
    s.exits.forEach((e) => {
      const t = exitTarget(plot, i, e);
      if (t.kind === "step" && t.index !== i) n[t.index]++;
    })
  );
  return n;
}
