import { describe, expect, it } from "vitest";
import { defaultSettings, migrateScenario, type Scenario } from "../../simulator";
import { BASE_CROP_IDS } from "../../simulator/migrate";
import { engine, flow, layout, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, step, TIMER_ONLY } from "../../simulator/testHelpers";
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
    expect(flow.steps.map((s) => s.id)).toEqual(["stage-1", "stage-2"]); // ids are user data and stay as they are
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
    expect(up.settings.config).toEqual({ cycleBaselineSeconds: 7200, keepIdenticalOnStepChange: false });
    expect(saved.plots[0].flow).toHaveProperty("stages"); // input untouched
    const current = rich();
    expect(migrateScenario(current)).toEqual(current); // already current: unchanged
  });

  it("renames the old deathWater config to haltWater (0.27.2: plants halt instead of dying)", () => {
    const saved = withPlots(LAYOUT_A_CODE);
    const old: Record<string, unknown> = { ...saved.settings.config };
    delete old.haltWater;
    old.deathWater = -80;
    (saved.settings.config as unknown as Record<string, unknown>) = old;
    const up = migrateScenario(saved);
    expect(up.settings.config.haltWater).toBe(-80);
    expect(up.settings.config).not.toHaveProperty("deathWater");
    expect(saved.settings.config).toHaveProperty("deathWater", -80); // input untouched
    // A save that somehow has both keeps the current one.
    const both = withPlots(LAYOUT_A_CODE);
    (both.settings.config as unknown as Record<string, unknown>).deathWater = -50;
    const kept = migrateScenario(both);
    expect(kept.settings.config.haltWater).toBe(-100);
    expect(kept.settings.config).not.toHaveProperty("deathWater");
  });

  describe("0.27.2 decay rework: baseCropDecayHours and nullStageKindsDecay", () => {
    const savedWith = (extra: Record<string, unknown>) => {
      const saved = withPlots(LAYOUT_A_CODE);
      (saved.settings.config as unknown as Record<string, unknown>) = { ...saved.settings.config, ...extra };
      return saved;
    };
    const harvestable = engine.data.cropIds.filter((id) => engine.data.crops[id].growthStages !== null);

    it("the hard-coded base crop list is exactly data.json's 14 harvestable crops", () => {
      expect([...BASE_CROP_IDS].sort()).toEqual([...harvestable].sort());
      expect(BASE_CROP_IDS).toHaveLength(14);
    });

    it("a non-default baseCropDecayHours becomes per-crop decayDaysOverrides (hours / 24) for the 14 base crops", () => {
      const saved = savedWith({ baseCropDecayHours: 36, nullStageKindsDecay: true });
      const up = migrateScenario(saved);
      const config = up.settings.config as unknown as Record<string, unknown>;
      expect(config).not.toHaveProperty("baseCropDecayHours");
      expect(config).not.toHaveProperty("nullStageKindsDecay");
      expect(up.settings.config.decayDaysOverrides).toEqual(Object.fromEntries(BASE_CROP_IDS.map((id) => [id, 1.5])));
      // dead_plant, fire and fermento are not base crops: no override.
      expect(up.settings.config.decayDaysOverrides).not.toHaveProperty("dead_plant");
      expect(saved.settings.config).toHaveProperty("baseCropDecayHours", 36); // input untouched
    });

    it("0 (never) stays 0; existing overrides are kept", () => {
      const up = migrateScenario(savedWith({ baseCropDecayHours: 0, decayDaysOverrides: { wheat: 5, chloronite: 2 } }));
      const o = up.settings.config.decayDaysOverrides;
      expect(o.wheat).toBe(5); // already overridden: kept
      expect(o.chloronite).toBe(2);
      expect(o.potato).toBe(0);
      expect(o.wild_rose).toBe(0);
      expect(Object.keys(o)).toHaveLength(15);
    });

    it("the old 72 h default just drops the key; nothing is overridden", () => {
      const up = migrateScenario(savedWith({ baseCropDecayHours: 72, nullStageKindsDecay: false }));
      const config = up.settings.config as unknown as Record<string, unknown>;
      expect(config).not.toHaveProperty("baseCropDecayHours");
      expect(config).not.toHaveProperty("nullStageKindsDecay");
      expect(up.settings.config.decayDaysOverrides).toEqual({});
    });

    it("a migrated save runs: base crops on a 36 h override decay in 1.5 days (timer only)", () => {
      const up = migrateScenario(savedWith({ baseCropDecayHours: 36 }));
      const sc = scenario([flow([step("a", layout([["wheat", 5, 5]]))])], {
        config: { ...up.settings.config, spawnCells: "slotsOnly", ...TIMER_ONLY },
        activity: { kind: "windows", windows: [] },
      });
      const s = engine.initState(sc).state;
      expect(s.plots[0].plants[0].decaySecondsRemaining).toBe(36 * 3600);
    });
  });

  it("keeps a saved water loss as it is (no migration): the old 2-3 defaults stay until the user restores defaults", () => {
    // Saves store the full config, so a scenario saved before 0.27.2's 18-22 has 2/3 frozen in. We can't tell
    // that from a deliberate choice, so it is left alone; the Advanced panel shows it as changed from the default.
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
