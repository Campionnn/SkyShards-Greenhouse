import { describe, expect, it } from "vitest";
import { defaultSettings, migrateScenario, type Scenario } from "../../simulator";
import { REMOVED_CONFIG } from "../../simulator/migrate";
import { engine, LAYOUT_A_CODE, LAYOUT_B_CODE } from "../../simulator/testHelpers";
import { decodeDesign } from "../../utilities/designEncoding";
import { readIncomingLayout, solverResultCells, summarizeTargets } from "../../utilities/layoutHandoff";
import {
  addPlot,
  duplicatePlot,
  exportFlows,
  importFlows,
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
    expect(r.scenario.plots[0].flow.steps[0]).toMatchObject({ label: "From the Calculator", layout: { code: LAYOUT_A_CODE } });
    expect(layoutDestinations(sc).map((d) => d.label)).toEqual(["Load as Plot 1"]);
    expect(layoutDestinations(withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE)).map((d) => d.label)).toEqual([
      "Add as Plot 3",
      "Replace Plot 1",
      "Replace Plot 2",
      "Next step of Plot 1",
      "Next step of Plot 2",
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

  it("replacing a plot drops its flow but keeps its policy overrides", () => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_A_CODE);
    sc.plots[1].policies = { baseCropUpkeep: "harvestWhenGrown" };
    sc.plots[1].flow.steps.push({ id: "step-2", layout: { code: LAYOUT_A_CODE }, exit: [] });
    const r = placeLayout(sc, { kind: "replacePlot", plotId: 2 }, { code: LAYOUT_B_CODE }, "B")!;
    const p2 = r.scenario.plots.find((p) => p.id === 2)!;
    expect(p2.flow.steps).toHaveLength(1);
    expect(p2.flow.steps[0].layout).toEqual({ code: LAYOUT_B_CODE });
    expect(p2.policies).toEqual({ baseCropUpkeep: "harvestWhenGrown" });
    expect(r.scenario.plots[0]).toBe(sc.plots[0]);
  });

  it("appending a step gives the old last step an exit so the plot reaches it", () => {
    const sc = withPlots(LAYOUT_A_CODE);
    const r = placeLayout(sc, { kind: "appendStep", plotId: 1 }, { code: LAYOUT_B_CODE }, "B")!;
    const steps = r.scenario.plots[0].flow.steps;
    expect(r.stepIndex).toBe(1);
    expect(steps).toHaveLength(2);
    expect(steps[0].exit).toEqual([{ kind: "cycles", n: 20 }]);
    expect(steps[1]).toMatchObject({ id: "step-2", label: "B", layout: { code: LAYOUT_B_CODE }, exit: [] });
    expect(sc.plots[0].flow.steps).toHaveLength(1); // input untouched
  });
});

describe("duplicating a plot", () => {
  it("copies the whole flow and policy overrides under the next free id", () => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE);
    sc.plots = sc.plots.filter((p) => p.id !== 1); // only Plot 2 left; the copy fills id 1
    const p2 = sc.plots[0];
    p2.policies = { baseCropUpkeep: "harvestWhenGrown" };
    p2.flow.steps[0].exit = [{ kind: "cycles", n: 7 }];
    p2.flow.steps[0].watch = [];
    p2.flow.steps.push({ id: "step-2", label: "Two", layout: { code: LAYOUT_A_CODE }, exit: [{ kind: "cycles", n: 3 }], next: "step-1" });
    p2.flow.loop = true;
    p2.flow.startIndex = 1;
    const next = duplicatePlot(sc, 2);
    expect(next.plots.map((p) => p.id)).toEqual([1, 2]);
    const copy = next.plots[0];
    expect({ ...copy, id: 2 }).toEqual(p2);
    copy.flow.steps[0].exit.push({ kind: "cycles", n: 1 });
    expect(p2.flow.steps[0].exit).toHaveLength(1); // a deep copy, not shared
  });

  it("does nothing when all plots are in use or the plot is unknown", () => {
    const full = withPlots(LAYOUT_A_CODE, LAYOUT_A_CODE, LAYOUT_A_CODE);
    expect(duplicatePlot(full, 1)).toBe(full);
    const one = withPlots(LAYOUT_A_CODE);
    expect(duplicatePlot(one, 3)).toBe(one);
  });
});

describe("flow export / import", () => {
  const rich = (): Scenario => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE);
    sc.plots[0].policies = { baseCropUpkeep: "harvestWhenGrown" };
    sc.plots[0].flow = {
      loop: true,
      startIndex: 1,
      steps: [
        { id: "step-1", label: "grow", layout: { code: LAYOUT_A_CODE }, exit: [{ kind: "cycles", n: 7 }], watch: ["0,0"], fullClear: true, policies: { watering: "never" } },
        { id: "step-2", label: "harvest", layout: { code: LAYOUT_B_CODE }, exit: [{ kind: "targetsFilled", count: 0 }] },
      ],
    };
    sc.startingInventory = { chloronite: 9 };
    sc.settings.seed = 777;
    sc.settings.playerStats.farmingFortune = 1;
    return sc;
  };

  it("exports every flow detail and nothing about the player", () => {
    const sc = rich();
    const file = exportFlows(sc);
    expect(Object.keys(file).sort()).toEqual(["kind", "plots", "version"]);
    expect(file.plots).toEqual(sc.plots);
    const text = JSON.stringify(file);
    for (const leaked of ["playerStats", "startingInventory", "seed", "activity", "config", "rareDropValues"]) expect(text).not.toContain(leaked);
  });

  it("imports flows into the current scenario, keeping its player settings", () => {
    const mine = withPlots(LAYOUT_B_CODE);
    mine.settings.seed = 1;
    mine.startingInventory = { magic_jellybean: 2 };
    const next = importFlows(mine, JSON.stringify(exportFlows(rich())));
    expect(next.plots).toEqual(rich().plots);
    expect(next.settings).toBe(mine.settings);
    expect(next.startingInventory).toBe(mine.startingInventory);
  });

  it("still reads an old full scenario export, taking only its plots", () => {
    const old = rich();
    const next = importFlows(withPlots(LAYOUT_B_CODE), JSON.stringify(old));
    expect(next.plots).toEqual(old.plots);
    expect(next.settings.seed).not.toBe(777);
    expect(next.startingInventory).toEqual({});
  });

  it("reads a file exported before the stage -> step rename", () => {
    const visits = { kind: "stageVisits", count: 3, sinceStage: "stage-1" };
    const old = {
      kind: "skyshards-greenhouse-rotations",
      version: 1,
      plots: [
        {
          id: 1,
          flow: {
            loop: true,
            startIndex: 0,
            stages: [
              { id: "stage-1", layout: { code: LAYOUT_A_CODE }, exit: [{ kind: "group", match: "any", of: [visits] }], routes: [{ to: "stage-2", when: [visits] }] },
              { id: "stage-2", layout: { code: LAYOUT_B_CODE }, exit: [{ kind: "cycles", n: 2 }] },
            ],
          },
        },
      ],
    };
    const flow = importFlows(withPlots(LAYOUT_B_CODE), JSON.stringify(old)).plots[0].flow;
    expect(flow.steps.map((s) => s.id)).toEqual(["stage-1", "stage-2"]); // step ids are not renamed
    expect(flow).not.toHaveProperty("stages");
    const renamed = { kind: "stepVisits", count: 3, sinceStep: "stage-1" };
    expect(flow.steps[0].exit).toEqual([{ kind: "group", match: "any", of: [renamed] }]);
    expect(flow.steps[0].routes).toEqual([{ to: "stage-2", when: [renamed] }]);
  });

  it("upgrades a scenario saved before the rename, config keys included", () => {
    const saved = { ...withPlots(LAYOUT_A_CODE), plots: [{ id: 1, flow: { stages: [{ id: "a", layout: { code: LAYOUT_A_CODE }, exit: [] }], loop: false, startIndex: 0 } }] };
    (saved.settings.config as unknown as Record<string, unknown>) = { stageBaselineSeconds: 7200, keepIdenticalOnStageChange: false };
    const up = migrateScenario(saved) as unknown as Scenario;
    expect(up.plots[0].flow.steps).toHaveLength(1);
    // stageBaselineSeconds is renamed to cycleBaselineSeconds, which is itself no longer a setting: dropped.
    expect(up.settings.config).toEqual({ keepIdenticalOnStepChange: false });
    expect(saved.plots[0].flow).toHaveProperty("stages"); // input untouched
    const current = rich();
    expect(migrateScenario(current)).toEqual(current); // already current: unchanged
  });

  it("drops deathWater (renamed to haltWater, which is no longer a setting)", () => {
    const saved = withPlots(LAYOUT_A_CODE);
    (saved.settings.config as unknown as Record<string, unknown>).deathWater = -80;
    const up = migrateScenario(saved);
    expect(up.settings.config).not.toHaveProperty("deathWater");
    expect(up.settings.config).not.toHaveProperty("haltWater");
    expect(saved.settings.config).toHaveProperty("deathWater", -80); // input untouched
    // A save that has both drops both.
    const both = withPlots(LAYOUT_A_CODE);
    Object.assign(both.settings.config, { deathWater: -50, haltWater: -100 });
    const kept = migrateScenario(both);
    expect(kept.settings.config).not.toHaveProperty("deathWater");
    expect(kept.settings.config).not.toHaveProperty("haltWater");
  });

  it("strips every removed config key, keeps the current ones, and leaves the input untouched", () => {
    const saved = withPlots(LAYOUT_A_CODE);
    const removed = {
      spawnCells: "slotsOnly",
      haltWater: -80,
      blankFillTo: 1,
      weightModel: "support",
      baseCropDecayHours: 36,
      nullStageKindsDecay: true,
      decayDaysOverrides: { wheat: 5 },
      minimumMutationsOverrides: { wheat: 2 },
      rareDropValues: { chloronite: 1000 },
      perfectPlay: false,
    };
    (saved.settings.config as unknown as Record<string, unknown>) = { ...saved.settings.config, ...removed, waterLossMin: 2, waterLossMax: 3 };
    const up = migrateScenario(saved);
    const config = up.settings.config as unknown as Record<string, unknown>;
    for (const key of REMOVED_CONFIG) expect(config).not.toHaveProperty(key);
    expect(Object.keys(removed).every((k) => REMOVED_CONFIG.includes(k))).toBe(true);
    expect(config).toMatchObject({ waterLossMin: 2, waterLossMax: 3 });
    expect(config).toEqual({ ...defaultSettings().config, waterLossMin: 2, waterLossMax: 3 }); // every kept key survives
    expect(saved.settings.config).toMatchObject(removed); // input untouched
  });

  it("a migrated old save still runs", () => {
    const saved = withPlots(LAYOUT_A_CODE);
    (saved.settings.config as unknown as Record<string, unknown>) = {
      ...saved.settings.config,
      spawnCells: "slotsOnly",
      haltWater: -80,
      blankFillTo: 1,
      decayDaysOverrides: { wheat: 1.5 },
      cycleBaselineSeconds: 7200,
    };
    const up = migrateScenario(saved);
    const s = engine.initState(up).state;
    const out = engine.run(s, 20);
    expect(out.state.cycle).toBe(20);
    expect(out.state.scenario.settings.config).not.toHaveProperty("spawnCells");
  });
  it("keeps a saved water loss as it is (no migration): a saved 2-3 stays even though the default is 18-22", () => {
    // Saves store the full config, so a saved value can't be told apart from a deliberate choice.
    const saved = withPlots(LAYOUT_A_CODE);
    saved.settings.config = { ...saved.settings.config, waterLossMin: 2, waterLossMax: 3 };
    const up = migrateScenario(saved);
    expect(up.settings.config).toMatchObject({ waterLossMin: 2, waterLossMax: 3 });
    expect(withPlots(LAYOUT_A_CODE).settings.config).toMatchObject({ waterLossMin: 18, waterLossMax: 22 });
  });

  it("rejects files it cannot use, with a readable reason", () => {
    const sc = withPlots(LAYOUT_A_CODE);
    expect(() => importFlows(sc, "nope")).toThrow("not valid JSON");
    expect(() => importFlows(sc, "{}")).toThrow("No plots");
    expect(() => importFlows(sc, JSON.stringify({ plots: [{ id: 1, flow: { steps: [] } }] }))).toThrow("Plot 1: no steps");
    expect(() => importFlows(sc, JSON.stringify({ plots: [{ id: 1, flow: { steps: [{ id: "s", layout: { code: "x" }, exit: [] }] } }, { id: 1, flow: { steps: [{ id: "s", layout: { code: "x" }, exit: [] }] } }] }))).toThrow("unique");
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

describe("simulator step layout editor ground roundtrip", () => {
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
    const step = { id: "s", layout: { code }, exit: [], watch: ["3,4"] };
    expect(transformWatch(step, { kind: "rotate", direction: "cw" }).watch).toEqual(["4,6"]);
    expect(transformWatch(step, { kind: "mirror", axis: "horizontal" }).watch).toEqual(["3,5"]);
    expect(transformWatch(step, { kind: "nudge", dRow: 1, dCol: 0 }).watch).toEqual(["4,4"]);
    const all = { id: "s", layout: { code }, exit: [] };
    expect(transformWatch(all, { kind: "rotate", direction: "cw" })).toBe(all);
  });
});
