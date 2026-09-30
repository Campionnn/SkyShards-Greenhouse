import type { DesignerPlacement } from "../../context";
import {
  defaultGameData,
  kindDef,
  MAX_PLOTS,
  type FlowStage,
  type LayoutSpec,
  type Scenario,
  type ScenarioPlot,
  type StageLayout,
  type Trigger,
  type TriggerKind,
} from "../../simulator";
import { decodeDesign, encodeDesign, generatePlacementId, transformAnchor, type LayoutTransform } from "../../utilities";
import { GROUND_TYPES, type GroundTile, type GroundType } from "../../utilities/designEncoding";

// Immutable edits to a scenario. The simulator never changes a scenario on
// its own - every change here comes from the user.

const data = defaultGameData();

export const EMPTY_LAYOUT_CODE = encodeDesign([], []);

export function newStageId(stages: FlowStage[]): string {
  let n = stages.length + 1;
  while (stages.some((s) => s.id === `stage-${n}`)) n++;
  return `stage-${n}`;
}

export function blankStage(stages: FlowStage[]): FlowStage {
  const id = newStageId(stages);
  return { id, label: `Stage ${stages.length + 1}`, layout: { code: EMPTY_LAYOUT_CODE }, exit: [{ kind: "cycles", n: 20 }] };
}

export function updatePlot(sc: Scenario, plotId: number, fn: (p: ScenarioPlot) => ScenarioPlot): Scenario {
  return { ...sc, plots: sc.plots.map((p) => (p.id === plotId ? fn(structuredClone(p)) : p)) };
}

export function updateStage(sc: Scenario, plotId: number, index: number, fn: (s: FlowStage) => FlowStage): Scenario {
  return updatePlot(sc, plotId, (p) => {
    p.flow.stages[index] = fn(p.flow.stages[index]);
    return p;
  });
}

export function addPlot(sc: Scenario, layout: StageLayout = { code: EMPTY_LAYOUT_CODE }, label?: string): Scenario {
  if (sc.plots.length >= MAX_PLOTS) return sc;
  const id = nextPlotId(sc)!;
  const plot: ScenarioPlot = {
    id,
    flow: { stages: [{ id: "stage-1", label: label || `Plot ${id} layout`, layout, exit: [] }], loop: false, startIndex: 0 },
  };
  return { ...sc, plots: [...sc.plots, plot].sort((a, b) => a.id - b.id) };
}

/** The id the next added plot gets, or null when every plot is in use. */
export function nextPlotId(sc: Scenario): number | null {
  if (sc.plots.length >= MAX_PLOTS) return null;
  return [1, 2, 3].find((n) => !sc.plots.some((p) => p.id === n)) ?? null;
}

// ---- Placing a layout that came from elsewhere -------------------------------

/** Where a layout from the Calculator, the Designer or a saved layout goes. */
export type LayoutDestination =
  | { kind: "newPlot" }
  | { kind: "replacePlot"; plotId: number }
  | { kind: "appendStage"; plotId: number };

/** True for a layout with no plants, no targets and no painted ground. */
export function isEmptyLayout(layout: StageLayout): boolean {
  try {
    const { inputs, targets, groundTiles } = layoutToPlacements(layout);
    return inputs.length === 0 && targets.length === 0 && groundTiles.length === 0;
  } catch {
    return false;
  }
}

/** Nothing worth keeping: every stage of every plot is an empty layout (e.g. the starter plot). */
export function isBlankScenario(sc: Scenario): boolean {
  return sc.plots.every((p) => p.flow.stages.every((s) => isEmptyLayout(s.layout)));
}

/**
 * Put a layout into the scenario. A blank scenario is replaced outright, so
 * the layout always lands on Plot 1 there. Returns where it went, so the
 * caller can say so (and open the rotation editor on a new stage).
 */
export function placeLayout(
  sc: Scenario,
  dest: LayoutDestination,
  layout: StageLayout,
  label: string
): { scenario: Scenario; plotId: number; stageIndex: number } | null {
  if (isBlankScenario(sc)) {
    const next = addPlot({ ...sc, plots: [] }, layout, label);
    return { scenario: next, plotId: next.plots[0].id, stageIndex: 0 };
  }
  if (dest.kind === "newPlot") {
    const id = nextPlotId(sc);
    if (id === null) return null;
    return { scenario: addPlot(sc, layout, label), plotId: id, stageIndex: 0 };
  }
  if (!sc.plots.some((p) => p.id === dest.plotId)) return null;
  if (dest.kind === "replacePlot") {
    // The whole rotation goes; the plot's own policy overrides stay.
    const next = updatePlot(sc, dest.plotId, (p) => ({
      ...p,
      flow: { stages: [{ id: "stage-1", label, layout, exit: [] }], loop: false, startIndex: 0 },
    }));
    return { scenario: next, plotId: dest.plotId, stageIndex: 0 };
  }
  let stageIndex = 0;
  const next = updatePlot(sc, dest.plotId, (p) => {
    const stages = p.flow.stages;
    // The old last stage never had to end; give it a default exit so the plot
    // actually reaches the new stage (the rotation editor opens on it).
    const last = stages[stages.length - 1];
    if (last && last.exit.length === 0 && !p.flow.loop) stages[stages.length - 1] = { ...last, exit: [defaultTrigger("cycles")] };
    const stage: FlowStage = { id: newStageId(stages), label, layout, exit: [] };
    p.flow.stages = [...stages, stage];
    stageIndex = p.flow.stages.length - 1;
    return p;
  });
  return { scenario: next, plotId: dest.plotId, stageIndex };
}

export interface DestinationOption {
  label: string;
  hint: string;
  dest: LayoutDestination;
}

/** The choices offered for an incoming or picked layout, most likely first. */
export function layoutDestinations(sc: Scenario): DestinationOption[] {
  if (isBlankScenario(sc)) return [{ label: "Load as Plot 1", hint: "The scenario is empty", dest: { kind: "newPlot" } }];
  const out: DestinationOption[] = [];
  const id = nextPlotId(sc);
  if (id !== null) out.push({ label: `Add as Plot ${id}`, hint: "A new plot next to the ones you have", dest: { kind: "newPlot" } });
  for (const p of sc.plots)
    out.push({
      label: `Replace Plot ${p.id}`,
      hint: p.flow.stages.length > 1 ? `Drops its ${p.flow.stages.length}-stage rotation` : layoutSummary(p.flow.stages[0].layout),
      dest: { kind: "replacePlot", plotId: p.id },
    });
  for (const p of sc.plots)
    out.push({ label: `Next stage of Plot ${p.id}`, hint: `Becomes stage ${p.flow.stages.length + 1} of its rotation`, dest: { kind: "appendStage", plotId: p.id } });
  return out;
}

// ---- Rotation files (export / import) -------------------------------------------

export const ROTATIONS_FILE_KIND = "skyshards-greenhouse-rotations";

/**
 * The shareable part of a scenario: each plot's rotation (stages, layouts,
 * exit triggers, loop, start stage, full clear, checked targets) and its plot
 * and stage policy overrides. Nothing about the player: stats, online
 * schedule, seed, Actions defaults, advanced config and starting inventory
 * stay out.
 */
export interface RotationsFile {
  kind: typeof ROTATIONS_FILE_KIND;
  version: 1;
  plots: ScenarioPlot[];
}

export function exportRotations(sc: Scenario): RotationsFile {
  return { kind: ROTATIONS_FILE_KIND, version: 1, plots: structuredClone(sc.plots) };
}

/**
 * Read a rotations file (or an older full scenario export, of which only the
 * plots are used) into `sc`, replacing its plots and keeping everything else.
 * Throws with a readable message when the file is not usable.
 */
export function importRotations(sc: Scenario, text: string): Scenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  const plots = (parsed as { plots?: unknown } | null)?.plots;
  if (!Array.isArray(plots) || plots.length === 0) throw new Error("No plots found. Expected an exported rotations file.");
  if (plots.length > MAX_PLOTS) throw new Error(`At most ${MAX_PLOTS} plots; the file has ${plots.length}.`);
  const seen = new Set<number>();
  plots.forEach((p: Partial<ScenarioPlot>, i) => {
    const where = `Plot ${i + 1}`;
    if (!p || typeof p !== "object") throw new Error(`${where} is not an object.`);
    if (![1, 2, 3].includes(p.id as number) || seen.has(p.id as number)) throw new Error(`${where}: id must be a unique 1, 2 or 3.`);
    seen.add(p.id as number);
    const stages = p.flow?.stages;
    if (!Array.isArray(stages) || stages.length === 0) throw new Error(`${where}: no stages.`);
    stages.forEach((s, j) => {
      if (!s || typeof s.id !== "string" || !s.layout || !Array.isArray(s.exit)) throw new Error(`${where}, stage ${j + 1}: needs an id, a layout and an exit list.`);
    });
  });
  const clean = (plots as ScenarioPlot[]).map((p) => ({
    ...p,
    flow: { stages: p.flow.stages, loop: !!p.flow.loop, startIndex: Math.min(Math.max(0, Math.floor(Number(p.flow.startIndex) || 0)), p.flow.stages.length - 1) },
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
    case "targetsFilled":
      return { kind, count: 0 };
  }
}

export const TRIGGER_KINDS: { value: TriggerKind; label: string }[] = [
  { value: "cycles", label: "cycles in stage >=" },
  { value: "mutationSpawned", label: "mutation spawned x" },
  { value: "targetsFilled", label: "targets filled (0 = all)" },
  { value: "mutationHarvested", label: "mutation harvested x" },
  { value: "inventoryAtLeast", label: "inventory at least" },
  { value: "inventoryBelow", label: "inventory below" },
  { value: "plantDecayed", label: "a plant decayed" },
  { value: "decayImminent", label: "something decays within" },
  { value: "fullyGrown", label: "mutation fully grown" },
  { value: "allFullyGrown", label: "everything fully grown" },
  { value: "noneFullyGrown", label: "nothing fully grown" },
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

export function layoutToPlacements(layout: StageLayout): { inputs: DesignerPlacement[]; targets: DesignerPlacement[]; groundTiles: GroundTile[] } {
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

export function layoutCode(layout: StageLayout): string {
  if ("code" in layout) return layout.code;
  const spec = layout as LayoutSpec;
  return encodeDesign(
    spec.plants.map((p) => ({ cropId: p.kindId, position: [p.row, p.col] as [number, number] })),
    spec.slots.map((s) => ({ cropId: s.mutationId, position: [s.row, s.col] as [number, number] })),
    specGroundTiles(spec)
  );
}

/** Set a stage's watched targets; undefined (every target) drops the field. */
export function withWatch(stage: FlowStage, watch: string[] | undefined): FlowStage {
  const next = { ...stage };
  if (watch === undefined) delete next.watch;
  else next.watch = watch;
  return next;
}

/**
 * Move a stage's watched target keys through a whole-layout transform, so a
 * nudged / rotated / mirrored layout keeps checking the same targets. Uses the
 * stage's layout from BEFORE the transform to know each target's size.
 */
export function transformWatch(stage: FlowStage, t: LayoutTransform): FlowStage {
  if (!stage.watch) return stage;
  try {
    const sizes = new Map(layoutToPlacements(stage.layout).targets.map((p) => [`${p.position[0]},${p.position[1]}`, p.size]));
    const watch = stage.watch.flatMap((key) => {
      const size = sizes.get(key);
      if (size === undefined) return [];
      const [r, c] = key.split(",").map(Number);
      const [nr, nc] = transformAnchor([r, c], size, t);
      return [`${nr},${nc}`];
    });
    return { ...stage, watch };
  } catch {
    return stage;
  }
}

/** Drop watched keys that are no longer targets after a layout edit. */
export function pruneWatch(stage: FlowStage): FlowStage {
  if (!stage.watch) return stage;
  try {
    const keys = new Set(layoutToPlacements(stage.layout).targets.map((t) => `${t.position[0]},${t.position[1]}`));
    const kept = stage.watch.filter((k) => keys.has(k));
    return kept.length === stage.watch.length ? stage : { ...stage, watch: kept };
  } catch {
    return stage;
  }
}

/** "12 plants, 4 targets" */
export function layoutSummary(layout: StageLayout): string {
  try {
    const { inputs, targets } = layoutToPlacements(layout);
    return `${inputs.length} plants, ${targets.length} targets`;
  } catch {
    return "invalid layout";
  }
}
