import { describe, expect, it } from "vitest";
import { defaultSettings, type Scenario } from "../../simulator";
import { LAYOUT_A_CODE, LAYOUT_B_CODE } from "../../simulator/testHelpers";
import { decodeDesign } from "../../utilities/designEncoding";
import { readIncomingLayout, solverResultCells, summarizeTargets } from "../../utilities/layoutHandoff";
import {
  addPlot,
  exportRotations,
  importRotations,
  isBlankScenario,
  layoutCode,
  layoutDestinations,
  layoutToPlacements,
  placeLayout,
  placementsToCode,
  transformWatch,
} from "./scenarioEdit";

const blank = (): Scenario => addPlot({ plots: [], startingInventory: {}, settings: defaultSettings() });
const withPlots = (...codes: string[]): Scenario => codes.reduce((sc, code) => addPlot(sc, { code }), { plots: [], startingInventory: {}, settings: defaultSettings() } as Scenario);

describe("placing a layout from the Calculator / Designer / saved layouts", () => {
  it("replaces the blank starter scenario whatever the destination", () => {
    const sc = blank();
    expect(isBlankScenario(sc)).toBe(true);
    const r = placeLayout(sc, { kind: "newPlot" }, { code: LAYOUT_A_CODE }, "From the Calculator")!;
    expect(r.scenario.plots).toHaveLength(1);
    expect(r.plotId).toBe(1);
    expect(r.scenario.plots[0].flow.stages[0]).toMatchObject({ label: "From the Calculator", layout: { code: LAYOUT_A_CODE } });
    expect(layoutDestinations(sc).map((d) => d.label)).toEqual(["Load as Plot 1"]);
    expect(layoutDestinations(withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE)).map((d) => d.label)).toEqual([
      "Add as Plot 3",
      "Replace Plot 1",
      "Replace Plot 2",
      "Next stage of Plot 1",
      "Next stage of Plot 2",
    ]);
  });

  it("adds a new plot with the next free id, and refuses a fourth", () => {
    const sc = withPlots(LAYOUT_A_CODE);
    expect(isBlankScenario(sc)).toBe(false);
    const r = placeLayout(sc, { kind: "newPlot" }, { code: LAYOUT_B_CODE }, "B")!;
    expect(r.plotId).toBe(2);
    expect(r.scenario.plots.map((p) => p.id)).toEqual([1, 2]);
    const full = withPlots(LAYOUT_A_CODE, LAYOUT_A_CODE, LAYOUT_A_CODE);
    expect(placeLayout(full, { kind: "newPlot" }, { code: LAYOUT_B_CODE }, "B")).toBeNull();
    expect(layoutDestinations(full).some((d) => d.dest.kind === "newPlot")).toBe(false);
  });

  it("replacing a plot drops its rotation but keeps its policy overrides", () => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_A_CODE);
    sc.plots[1].policies = { baseCropUpkeep: "harvestWhenGrown" };
    sc.plots[1].flow.stages.push({ id: "stage-2", layout: { code: LAYOUT_A_CODE }, exit: [] });
    const r = placeLayout(sc, { kind: "replacePlot", plotId: 2 }, { code: LAYOUT_B_CODE }, "B")!;
    const p2 = r.scenario.plots.find((p) => p.id === 2)!;
    expect(p2.flow.stages).toHaveLength(1);
    expect(p2.flow.stages[0].layout).toEqual({ code: LAYOUT_B_CODE });
    expect(p2.policies).toEqual({ baseCropUpkeep: "harvestWhenGrown" });
    expect(r.scenario.plots[0]).toBe(sc.plots[0]);
  });

  it("appending a stage gives the old last stage an exit so the plot reaches it", () => {
    const sc = withPlots(LAYOUT_A_CODE);
    const r = placeLayout(sc, { kind: "appendStage", plotId: 1 }, { code: LAYOUT_B_CODE }, "B")!;
    const stages = r.scenario.plots[0].flow.stages;
    expect(r.stageIndex).toBe(1);
    expect(stages).toHaveLength(2);
    expect(stages[0].exit).toEqual([{ kind: "cycles", n: 20 }]);
    expect(stages[1]).toMatchObject({ id: "stage-2", label: "B", layout: { code: LAYOUT_B_CODE }, exit: [] });
    expect(sc.plots[0].flow.stages).toHaveLength(1); // input untouched
  });
});

describe("rotation export / import", () => {
  const rich = (): Scenario => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE);
    sc.plots[0].policies = { baseCropUpkeep: "harvestWhenGrown" };
    sc.plots[0].flow = {
      loop: true,
      startIndex: 1,
      stages: [
        { id: "stage-1", label: "grow", layout: { code: LAYOUT_A_CODE }, exit: [{ kind: "cycles", n: 7 }], watch: ["0,0"], fullClear: true, policies: { watering: "never" } },
        { id: "stage-2", label: "harvest", layout: { code: LAYOUT_B_CODE }, exit: [{ kind: "targetsFilled", count: 0 }] },
      ],
    };
    sc.startingInventory = { chloronite: 9 };
    sc.settings.seed = 777;
    sc.settings.playerStats.farmingFortune = 1;
    return sc;
  };

  it("exports every rotation detail and nothing about the player", () => {
    const sc = rich();
    const file = exportRotations(sc);
    expect(Object.keys(file).sort()).toEqual(["kind", "plots", "version"]);
    expect(file.plots).toEqual(sc.plots);
    const text = JSON.stringify(file);
    for (const leaked of ["playerStats", "startingInventory", "seed", "activity", "config", "rareDropValues"]) expect(text).not.toContain(leaked);
  });

  it("imports rotations into the current scenario, keeping its player settings", () => {
    const mine = withPlots(LAYOUT_B_CODE);
    mine.settings.seed = 1;
    mine.startingInventory = { magic_jellybean: 2 };
    const next = importRotations(mine, JSON.stringify(exportRotations(rich())));
    expect(next.plots).toEqual(rich().plots);
    expect(next.settings).toBe(mine.settings);
    expect(next.startingInventory).toBe(mine.startingInventory);
  });

  it("still reads an old full scenario export, taking only its plots", () => {
    const old = rich();
    const next = importRotations(withPlots(LAYOUT_B_CODE), JSON.stringify(old));
    expect(next.plots).toEqual(old.plots);
    expect(next.settings.seed).not.toBe(777);
    expect(next.startingInventory).toEqual({});
  });

  it("rejects files it cannot use, with a readable reason", () => {
    const sc = withPlots(LAYOUT_A_CODE);
    expect(() => importRotations(sc, "nope")).toThrow("not valid JSON");
    expect(() => importRotations(sc, "{}")).toThrow("No plots");
    expect(() => importRotations(sc, JSON.stringify({ plots: [{ id: 1, flow: { stages: [] } }] }))).toThrow("Plot 1: no stages");
    expect(() => importRotations(sc, JSON.stringify({ plots: [{ id: 1, flow: { stages: [{ id: "s", layout: { code: "x" }, exit: [] }] } }, { id: 1, flow: { stages: [{ id: "s", layout: { code: "x" }, exit: [] }] } }] }))).toThrow("unique");
  });
});

describe("layout handoff helpers", () => {
  it("reads only well-formed router state", () => {
    expect(readIncomingLayout(null)).toBeNull();
    expect(readIncomingLayout({ incomingLayout: { code: "" } })).toBeNull();
    expect(readIncomingLayout({ incomingLayout: { code: "abc", from: "designer" } })).toEqual({ code: "abc", name: "Layout", from: "designer" });
    expect(readIncomingLayout({ incomingLayout: { code: "abc", name: "X", from: "elsewhere" } })).toEqual({ code: "abc", name: "X", from: "link" });
  });

  it("merges locks with the solver result, skipping crops under a lock", () => {
    const { inputs, targets } = solverResultCells(
      {
        placements: [
          { crop: "wheat", position: [0, 0], size: 1 },
          { crop: "carrot", position: [5, 5], size: 1 },
        ],
        mutations: [{ mutation: "chloronite", position: [1, 1], size: 1 }],
      },
      [{ crop: "pumpkin", position: [0, 0], size: 1 }]
    );
    expect(inputs.map((i) => i.cropId)).toEqual(["pumpkin", "carrot"]);
    expect(targets).toEqual([{ cropId: "chloronite", position: [1, 1], size: 1 }]);
  });

  it("names a layout by its most common targets", () => {
    const t = (cropId: string) => ({ cropId });
    expect(summarizeTargets([], (id) => id)).toBeNull();
    expect(summarizeTargets([t("a"), t("b"), t("b"), t("c")], (id) => id.toUpperCase())).toBe("B x2, A x1 +1 more");
  });
});

const tiles = [
  { ground: "soul_sand" as const, position: [2, 3] as [number, number] },
  { ground: "end_stone" as const, position: [7, 8] as [number, number] },
];

describe("simulator stage layout editor ground roundtrip", () => {
  it("keeps bare ground through an embedded editor edit", () => {
    const code = placementsToCode([], [], tiles);
    const initial = layoutToPlacements({ code });
    expect(initial.groundTiles).toEqual(tiles);
    const edited = placementsToCode(initial.inputs, initial.targets, initial.groundTiles);
    expect(decodeDesign(edited).groundTiles).toEqual(tiles);
  });

  it("keeps structured layout ground when converted to an editor code", () => {
    const spec = {
      plants: [], slots: [],
      groundTiles: [{ ground: "sand", row: 4, col: 5 }],
    };
    expect(layoutToPlacements(spec).groundTiles).toEqual([{ ground: "sand", position: [4, 5] }]);
    expect(decodeDesign(layoutCode(spec)).groundTiles).toEqual([{ ground: "sand", position: [4, 5] }]);
  });
});

describe("watched targets follow a layout transform", () => {
  it("moves watch keys with the rotated / mirrored targets", () => {
    const code = placementsToCode([], [
      { id: "a", cropId: "chloronite", cropName: "", size: 1, position: [0, 0], isMutation: true },
      { id: "b", cropId: "chloronite", cropName: "", size: 1, position: [3, 4], isMutation: true },
    ]);
    const stage = { id: "s", layout: { code }, exit: [], watch: ["3,4"] };
    expect(transformWatch(stage, { kind: "rotate", direction: "cw" }).watch).toEqual(["4,6"]);
    expect(transformWatch(stage, { kind: "mirror", axis: "horizontal" }).watch).toEqual(["3,5"]);
    expect(transformWatch(stage, { kind: "nudge", dRow: 1, dCol: 0 }).watch).toEqual(["4,4"]);
    const all = { id: "s", layout: { code }, exit: [] };
    expect(transformWatch(all, { kind: "rotate", direction: "cw" })).toBe(all);
  });
});
