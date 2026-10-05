import type { DesignerPlacement } from "../../context";
import {
  defaultGameData,
  kindDef,
  MAX_PLOTS,
  migrateScenario,
  type FlowStep,
  type LayoutSpec,
  type Scenario,
  type ScenarioPlot,
  type Condition,
  type ConditionGroup,
  type ConditionMatch,
  type StepExit,
  type StepLayout,
  type Trigger,
  type TriggerKind,
} from "../../simulator";
import { decodeDesign, encodeDesign, generatePlacementId, transformAnchor, type LayoutTransform } from "../../utilities";
import { GROUND_TYPES, type GroundTile, type GroundType } from "../../utilities/designEncoding";

// Immutable scenario edits, all user-initiated; the simulator never changes a scenario itself.

const data = defaultGameData();

export const EMPTY_LAYOUT_CODE = encodeDesign([], []);

export function newStepId(steps: FlowStep[]): string {
  let n = steps.length + 1;
  while (steps.some((s) => s.id === `step-${n}`)) n++;
  return `step-${n}`;
}

export function blankStep(steps: FlowStep[]): FlowStep {
  const id = newStepId(steps);
  return { id, label: `Step ${steps.length + 1}`, layout: { code: EMPTY_LAYOUT_CODE }, exits: [{ when: [{ kind: "cycles", n: 20 }] }] };
}

export function updatePlot(sc: Scenario, plotId: number, fn: (p: ScenarioPlot) => ScenarioPlot): Scenario {
  return { ...sc, plots: sc.plots.map((p) => (p.id === plotId ? fn(structuredClone(p)) : p)) };
}

export function updateStep(sc: Scenario, plotId: number, index: number, fn: (s: FlowStep) => FlowStep): Scenario {
  return updatePlot(sc, plotId, (p) => {
    p.flow.steps[index] = fn(p.flow.steps[index]);
    return p;
  });
}

export function addPlot(sc: Scenario, layout: StepLayout = { code: EMPTY_LAYOUT_CODE }, label?: string): Scenario {
  if (sc.plots.length >= MAX_PLOTS) return sc;
  const id = nextPlotId(sc)!;
  const plot: ScenarioPlot = {
    id,
    flow: { steps: [{ id: "step-1", label: label || `Plot ${id} layout`, layout, exits: [] }], loop: false, startIndex: 0 },
  };
  return { ...sc, plots: [...sc.plots, plot].sort((a, b) => a.id - b.id) };
}

/**
 * Copies a plot (whole flow and policy overrides) under the next free plot id. Step ids and
 * exits are per plot, so they carry over unchanged. No-op when every plot is in use.
 */
export function duplicatePlot(sc: Scenario, plotId: number): Scenario {
  const source = sc.plots.find((p) => p.id === plotId);
  const id = nextPlotId(sc);
  if (!source || id === null) return sc;
  const copy: ScenarioPlot = { ...structuredClone(source), id: id as ScenarioPlot["id"] };
  return { ...sc, plots: [...sc.plots, copy].sort((a, b) => a.id - b.id) };
}

/** Id for the next added plot, or null when every plot is in use. */
export function nextPlotId(sc: Scenario): number | null {
  if (sc.plots.length >= MAX_PLOTS) return null;
  return [1, 2, 3].find((n) => !sc.plots.some((p) => p.id === n)) ?? null;
}

// ---- Placing a layout that came from elsewhere -------------------------------

/** Where a layout from the Calculator, the Designer or a saved layout goes. */
export type LayoutDestination =
  | { kind: "newPlot" }
  | { kind: "replacePlot"; plotId: number }
  | { kind: "appendStep"; plotId: number };

/** True for a layout with no plants, no targets and no painted ground. */
export function isEmptyLayout(layout: StepLayout): boolean {
  try {
    const { inputs, targets, groundTiles } = layoutToPlacements(layout);
    return inputs.length === 0 && targets.length === 0 && groundTiles.length === 0;
  } catch {
    return false;
  }
}

/** True when every step of every plot is an empty layout (e.g. the starter plot). */
export function isBlankScenario(sc: Scenario): boolean {
  return sc.plots.every((p) => p.flow.steps.every((s) => isEmptyLayout(s.layout)));
}

/** Puts a layout into the scenario; a blank scenario is replaced, landing it on Plot 1. Returns where it went. */
export function placeLayout(
  sc: Scenario,
  dest: LayoutDestination,
  layout: StepLayout,
  label: string
): { scenario: Scenario; plotId: number; stepIndex: number } | null {
  if (isBlankScenario(sc)) {
    const next = addPlot({ ...sc, plots: [] }, layout, label);
    return { scenario: next, plotId: next.plots[0].id, stepIndex: 0 };
  }
  if (dest.kind === "newPlot") {
    const id = nextPlotId(sc);
    if (id === null) return null;
    return { scenario: addPlot(sc, layout, label), plotId: id, stepIndex: 0 };
  }
  if (!sc.plots.some((p) => p.id === dest.plotId)) return null;
  if (dest.kind === "replacePlot") {
    // Replaces the flow; the plot's policy overrides stay.
    const next = updatePlot(sc, dest.plotId, (p) => ({
      ...p,
      flow: { steps: [{ id: "step-1", label, layout, exits: [] }], loop: false, startIndex: 0 },
    }));
    return { scenario: next, plotId: dest.plotId, stepIndex: 0 };
  }
  let stepIndex = 0;
  const next = updatePlot(sc, dest.plotId, (p) => {
    const steps = p.flow.steps;
    // A final step without an exit would never reach the new step, so give it a default exit.
    const last = steps[steps.length - 1];
    if (last && !last.exits.some((e) => e.to === undefined) && !p.flow.loop) {
      steps[steps.length - 1] = { ...last, exits: [...last.exits, { when: [defaultTrigger("cycles")] }] };
    }
    const step: FlowStep = { id: newStepId(steps), label, layout, exits: [] };
    p.flow.steps = [...steps, step];
    stepIndex = p.flow.steps.length - 1;
    return p;
  });
  return { scenario: next, plotId: dest.plotId, stepIndex };
}

export interface DestinationOption {
  label: string;
  hint: string;
  dest: LayoutDestination;
}

/** Destinations for an incoming or picked layout, most likely first. */
export function layoutDestinations(sc: Scenario): DestinationOption[] {
  if (isBlankScenario(sc)) return [{ label: "Load as Plot 1", hint: "The scenario is empty", dest: { kind: "newPlot" } }];
  const out: DestinationOption[] = [];
  const id = nextPlotId(sc);
  if (id !== null) out.push({ label: `Add as Plot ${id}`, hint: "A new plot next to the ones you have", dest: { kind: "newPlot" } });
  for (const p of sc.plots)
    out.push({
      label: `Replace Plot ${p.id}`,
      hint: p.flow.steps.length > 1 ? `Drops its ${p.flow.steps.length}-step flow` : layoutSummary(p.flow.steps[0].layout),
      dest: { kind: "replacePlot", plotId: p.id },
    });
  for (const p of sc.plots)
    out.push({ label: `Next step of Plot ${p.id}`, hint: `Becomes step ${p.flow.steps.length + 1} of its flow`, dest: { kind: "appendStep", plotId: p.id } });
  return out;
}

// ---- Flow files (export / import) -------------------------------------------

export const FLOWS_FILE_KIND = "skyshards-greenhouse-flows";

/**
 * The shareable part of a scenario: each plot's flow and its plot/step policy overrides.
 * Player stats, schedule, seed, Actions defaults, advanced config and starting inventory are excluded.
 */
export interface FlowsFile {
  kind: typeof FLOWS_FILE_KIND;
  version: 1;
  plots: ScenarioPlot[];
}

export function exportFlows(sc: Scenario): FlowsFile {
  return { kind: FLOWS_FILE_KIND, version: 1, plots: structuredClone(sc.plots) };
}

/**
 * Reads a flows file (or a full scenario export, using only its plots) into `sc`, replacing
 * its plots. Throws a readable message when the file is unusable.
 */
export function importFlows(sc: Scenario, text: string): Scenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  const plots = (migrateScenario(parsed) as { plots?: unknown } | null)?.plots;
  if (!Array.isArray(plots) || plots.length === 0) throw new Error("No plots found. Expected an exported flows file.");
  if (plots.length > MAX_PLOTS) throw new Error(`At most ${MAX_PLOTS} plots; the file has ${plots.length}.`);
  const seen = new Set<number>();
  plots.forEach((p: Partial<ScenarioPlot>, i) => {
    const where = `Plot ${i + 1}`;
    if (!p || typeof p !== "object") throw new Error(`${where} is not an object.`);
    if (![1, 2, 3].includes(p.id as number) || seen.has(p.id as number)) throw new Error(`${where}: id must be a unique 1, 2 or 3.`);
    seen.add(p.id as number);
    const steps = p.flow?.steps;
    if (!Array.isArray(steps) || steps.length === 0) throw new Error(`${where}: no steps.`);
    steps.forEach((s, j) => {
      if (!s || typeof s.id !== "string" || !s.layout || !Array.isArray(s.exits)) throw new Error(`${where}, step ${j + 1}: needs an id, a layout and an exits list.`);
    });
  });
  const clean = (plots as ScenarioPlot[]).map((p) => ({
    ...p,
    flow: { steps: p.flow.steps, loop: !!p.flow.loop, startIndex: Math.min(Math.max(0, Math.floor(Number(p.flow.startIndex) || 0)), p.flow.steps.length - 1) },
  }));
  return { ...sc, plots: structuredClone(clean).sort((a, b) => a.id - b.id) };
}

export function removePlot(sc: Scenario, plotId: number): Scenario {
  return { ...sc, plots: sc.plots.filter((p) => p.id !== plotId) };
}

export function defaultTrigger(kind: TriggerKind): Trigger {
  switch (kind) {
    case "cycles":
      return { kind, n: 20 };
    case "inventoryAtLeast":
    case "inventoryBelow":
      return { kind, item: "chloronite", qty: 5 };
    case "allFullyGrown":
    case "noneFullyGrown":
      return { kind };
    case "fullyGrown":
      return { kind, mutationId: "chorus_fruit" };
    case "decayImminent":
      return { kind, withinCycles: 2 };
    case "plantDecayed":
      return { kind, kindId: "wheat" };
    case "mutationSpawned":
      return { kind, mutationId: "chloronite", count: 5 };
    case "mutationHarvested":
      return { kind, mutationId: "chorus_fruit", count: 9 };
    case "lowestStageAtLeast":
    case "lowestStageBelow":
    case "highestStageAtLeast":
    case "highestStageBelow":
      return { kind, mutationId: "magic_jellybean", stage: 3 };
    case "targetsFilled":
      return { kind, count: 0 };
    case "stepVisits":
      return { kind, count: 3 };
  }
}

/** A new AND / OR group holding one default condition. */
export function defaultGroup(match: ConditionMatch = "any"): ConditionGroup {
  return { kind: "group", match, of: [defaultTrigger("cycles")] };
}

/** Drop conditions that name `stepId` (step visits since it), inside groups too. */
function dropStepConditions(list: Condition[], stepId: string): Condition[] {
  return list.flatMap((c): Condition[] => {
    if (c.kind === "group") return [{ ...c, of: dropStepConditions(c.of, stepId) }];
    if (c.kind === "stepVisits" && c.sinceStep === stepId) {
      const rest = { ...c };
      delete rest.sinceStep;
      return [rest];
    }
    return [c];
  });
}

/**
 * Deletes a step and its references: exits to it are removed (if that would leave a step with
 * no way out, its exits go to the following step instead), and "step visits since it" counts
 * from the start of the run.
 */
export function deleteStep(p: ScenarioPlot, index: number): ScenarioPlot {
  const gone = p.flow.steps[index];
  if (!gone || p.flow.steps.length <= 1) return p;
  const steps = p.flow.steps
    .filter((_, i) => i !== index)
    .map((s): FlowStep => {
      const exits = s.exits.map((e): StepExit => ({ ...e, when: dropStepConditions(e.when, gone.id) }));
      const kept = exits.filter((e) => e.to !== gone.id);
      if (kept.length || !exits.length) return { ...s, exits: kept };
      for (const e of exits) delete e.to;
      return { ...s, exits };
    });
  return { ...p, flow: { ...p.flow, steps, startIndex: Math.min(p.flow.startIndex, steps.length - 1) } };
}

export const TRIGGER_KINDS: { value: TriggerKind; label: string }[] = [
  { value: "cycles", label: "cycles in step >=" },
  { value: "mutationSpawned", label: "mutation spawned x" },
  { value: "targetsFilled", label: "targets filled (0 = all)" },
  { value: "mutationHarvested", label: "mutation harvested x" },
  { value: "inventoryAtLeast", label: "inventory at least" },
  { value: "inventoryBelow", label: "inventory below" },
  { value: "plantDecayed", label: "a plant decayed" },
  { value: "decayImminent", label: "something decays within" },
  { value: "fullyGrown", label: "mutation fully grown" },
  { value: "lowestStageAtLeast", label: "lowest stage of mutation >=" },
  { value: "lowestStageBelow", label: "lowest stage of mutation <" },
  { value: "highestStageAtLeast", label: "highest stage of mutation >=" },
  { value: "highestStageBelow", label: "highest stage of mutation <" },
  { value: "allFullyGrown", label: "everything fully grown" },
  { value: "noneFullyGrown", label: "nothing fully grown" },
  { value: "stepVisits", label: "times this step entered >=" },
];

// ---- Layout <-> designer placements ----------------------------------------

function toPlacement(cropId: string, position: [number, number], isTarget: boolean): DesignerPlacement {
  const def = kindDef(data, cropId);
  return {
    id: generatePlacementId("sim"),
    cropId,
    cropName: def?.name ?? cropId,
    size: def?.size ?? 1,
    position,
    isMutation: isTarget || !!data.mutations[cropId],
  };
}

function specGroundTiles(spec: LayoutSpec): GroundTile[] {
  return (spec.groundTiles ?? []).filter((tile): tile is typeof tile & { ground: GroundType } =>
    GROUND_TYPES.includes(tile.ground as GroundType)
  ).map(({ ground, row, col }) => ({ ground, position: [row, col] }));
}

export function layoutToPlacements(layout: StepLayout): { inputs: DesignerPlacement[]; targets: DesignerPlacement[]; groundTiles: GroundTile[] } {
  if ("code" in layout) {
    const { inputs, targets, groundTiles } = decodeDesign(layout.code);
    return {
      inputs: inputs.map((p) => toPlacement(p.cropId, p.position, false)),
      targets: targets.map((p) => toPlacement(p.cropId, p.position, true)),
      groundTiles,
    };
  }
  return {
    inputs: layout.plants.map((p) => toPlacement(p.kindId, [p.row, p.col], false)),
    targets: layout.slots.map((s) => toPlacement(s.mutationId, [s.row, s.col], true)),
    groundTiles: specGroundTiles(layout),
  };
}

export function placementsToCode(inputs: DesignerPlacement[], targets: DesignerPlacement[], groundTiles: GroundTile[] = []): string {
  return encodeDesign(
    inputs.map((p) => ({ cropId: p.cropId, position: p.position })),
    targets.map((p) => ({ cropId: p.cropId, position: p.position })),
    groundTiles
  );
}

export function layoutCode(layout: StepLayout): string {
  if ("code" in layout) return layout.code;
  const spec = layout as LayoutSpec;
  return encodeDesign(
    spec.plants.map((p) => ({ cropId: p.kindId, position: [p.row, p.col] as [number, number] })),
    spec.slots.map((s) => ({ cropId: s.mutationId, position: [s.row, s.col] as [number, number] })),
    specGroundTiles(spec)
  );
}

/** Set a step's watched targets; undefined (every target) drops the field. */
export function withWatch(step: FlowStep, watch: string[] | undefined): FlowStep {
  const next = { ...step };
  if (watch === undefined) delete next.watch;
  else next.watch = watch;
  return next;
}

/**
 * Maps watched target keys through a layout transform so a moved/rotated/mirrored layout keeps
 * checking the same targets. Reads target sizes from the step's pre-transform layout.
 */
export function transformWatch(step: FlowStep, t: LayoutTransform): FlowStep {
  if (!step.watch) return step;
  try {
    const sizes = new Map(layoutToPlacements(step.layout).targets.map((p) => [`${p.position[0]},${p.position[1]}`, p.size]));
    const watch = step.watch.flatMap((key) => {
      const size = sizes.get(key);
      if (size === undefined) return [];
      const [r, c] = key.split(",").map(Number);
      const [nr, nc] = transformAnchor([r, c], size, t);
      return [`${nr},${nc}`];
    });
    return { ...step, watch };
  } catch {
    return step;
  }
}

/** Drops watched keys that aren't targets in the step's layout. */
export function pruneWatch(step: FlowStep): FlowStep {
  if (!step.watch) return step;
  try {
    const keys = new Set(layoutToPlacements(step.layout).targets.map((t) => `${t.position[0]},${t.position[1]}`));
    const kept = step.watch.filter((k) => keys.has(k));
    return kept.length === step.watch.length ? step : { ...step, watch: kept };
  } catch {
    return step;
  }
}

/** "12 plants, 4 targets" */
export function layoutSummary(layout: StepLayout): string {
  try {
    const { inputs, targets } = layoutToPlacements(layout);
    return `${inputs.length} plants, ${targets.length} targets`;
  } catch {
    return "invalid layout";
  }
}
