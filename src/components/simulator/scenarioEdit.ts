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
import { decodeDesign, encodeDesign, generatePlacementId } from "../../utilities";
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

export function addPlot(sc: Scenario, layout: StageLayout = { code: EMPTY_LAYOUT_CODE }): Scenario {
  if (sc.plots.length >= MAX_PLOTS) return sc;
  const id = [1, 2, 3].find((n) => !sc.plots.some((p) => p.id === n))!;
  const plot: ScenarioPlot = {
    id,
    flow: { stages: [{ id: "stage-1", label: `Plot ${id} layout`, layout, exit: [] }], loop: false, startIndex: 0 },
  };
  return { ...sc, plots: [...sc.plots, plot].sort((a, b) => a.id - b.id) };
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
  }
}

export const TRIGGER_KINDS: { value: TriggerKind; label: string }[] = [
  { value: "cycles", label: "cycles in stage >=" },
  { value: "mutationSpawned", label: "mutation spawned x" },
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

/** "12 plants, 4 targets" */
export function layoutSummary(layout: StageLayout): string {
  try {
    const { inputs, targets } = layoutToPlacements(layout);
    return `${inputs.length} plants, ${targets.length} targets`;
  } catch {
    return "invalid layout";
  }
}
