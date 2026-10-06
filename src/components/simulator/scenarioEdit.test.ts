import { describe, expect, it } from "vitest";
import { defaultSettings, migrateScenario, type Scenario } from "../../simulator";
import { REMOVED_CONFIG } from "../../simulator/migrate";
import { engine, LAYOUT_A_CODE, LAYOUT_B_CODE } from "../../simulator/testHelpers";
import { decodeDesign } from "../../utilities/designEncoding";
import { readIncomingLayout, solverResultCells, summarizeTargets } from "../../utilities/layoutHandoff";
import {
  addPlot,
  duplicatePlot,
  DEFAULT_FLOW_EXPORT_OPTIONS,
  exportFlows,
  importFlows,
  isBlankScenario,
  layoutCode,
  layoutDestinations,
  layoutToPlacements,
  placeLayout,
  placementsToCode,
  transformWatch,
  type FlowExportOptions,
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
    sc.plots[1].flow.steps.push({ id: "step-2", layout: { code: LAYOUT_A_CODE }, exits: [] });
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
    expect(steps[0].exits).toEqual([{ when: [{ kind: "cycles", n: 20 }] }]);
    expect(steps[1]).toMatchObject({ id: "step-2", label: "B", layout: { code: LAYOUT_B_CODE }, exits: [] });
    expect(sc.plots[0].flow.steps).toHaveLength(1); // input untouched
  });
});

describe("duplicating a plot", () => {
  it("copies the whole flow and policy overrides under the next free id", () => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE);
    sc.plots = sc.plots.filter((p) => p.id !== 1); // only Plot 2 left; the copy fills id 1
    const p2 = sc.plots[0];
    p2.policies = { baseCropUpkeep: "harvestWhenGrown" };
    p2.flow.steps[0].exits = [{ when: [{ kind: "cycles", n: 7 }] }];
    p2.flow.steps[0].watch = [];
    p2.flow.steps.push({ id: "step-2", label: "Two", layout: { code: LAYOUT_A_CODE }, exits: [{ to: "step-1", when: [{ kind: "cycles", n: 3 }] }] });
    p2.flow.loop = true;
    p2.flow.startIndex = 1;
    const next = duplicatePlot(sc, 2);
    expect(next.plots.map((p) => p.id)).toEqual([1, 2]);
    const copy = next.plots[0];
    expect({ ...copy, id: 2 }).toEqual(p2);
    copy.flow.steps[0].exits.push({ when: [{ kind: "cycles", n: 1 }] });
    expect(p2.flow.steps[0].exits).toHaveLength(1); // a deep copy, not shared
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
        { id: "step-1", label: "grow", layout: { code: LAYOUT_A_CODE }, exits: [{ when: [{ kind: "cycles", n: 7 }] }], watch: ["0,0"], fullClear: true, policies: { watering: "never" } },
        { id: "step-2", label: "harvest", layout: { code: LAYOUT_B_CODE }, exits: [{ when: [{ kind: "targetsFilled", count: 0 }] }] },
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
    // The route comes first, then the old normal exit; both become entries of `exits`.
    expect(flow.steps[0].exits).toEqual([{ to: "stage-2", when: [renamed] }, { when: [{ kind: "group", match: "any", of: [renamed] }] }]);
    expect(flow.steps[1].exits).toEqual([{ when: [{ kind: "cycles", n: 2 }] }]);
  });

  it("merges a step's old routes, normal exit, exitMatch and next into one ordered exits list", () => {
    const old = {
      plots: [
        {
          id: 1,
          flow: {
            loop: false,
            startIndex: 0,
            steps: [
              { id: "a", layout: { code: LAYOUT_A_CODE }, exit: [{ kind: "cycles", n: 1 }, { kind: "cycles", n: 2 }], exitMatch: "any", next: "a", routes: [{ to: "b", when: [{ kind: "cycles", n: 9 }] }] },
              { id: "b", layout: { code: LAYOUT_A_CODE }, exit: [{ kind: "cycles", n: 3 }], next: "gone" },
              { id: "c", layout: { code: LAYOUT_A_CODE }, exit: [] },
            ],
          },
        },
      ],
    };
    const [a, b, c] = (migrateScenario(old).plots[0].flow as unknown as Scenario["plots"][number]["flow"]).steps;
    expect(a).toEqual({
      id: "a",
      layout: { code: LAYOUT_A_CODE },
      exits: [
        { to: "b", when: [{ kind: "cycles", n: 9 }] },
        { to: "a", match: "any", when: [{ kind: "cycles", n: 1 }, { kind: "cycles", n: 2 }] },
      ],
    });
    // A `next` to a missing step used to fall back to the following step: dropped.
    expect(b.exits).toEqual([{ when: [{ kind: "cycles", n: 3 }] }]);
    expect(c).toEqual({ id: "c", layout: { code: LAYOUT_A_CODE }, exits: [] });
    expect(old.plots[0].flow.steps[0]).toHaveProperty("routes"); // input untouched
  });

  it("moves the per-step checkExitsOnEntry flag onto each of that step's exits", () => {
    const when = [{ kind: "cycles", n: 1 }];
    const old = {
      plots: [{ id: 1, flow: { loop: false, startIndex: 0, steps: [{ id: "a", layout: { code: LAYOUT_A_CODE }, checkExitsOnEntry: true, exits: [{ when }, { to: "a", when }] }, { id: "b", layout: { code: LAYOUT_A_CODE }, exits: [{ when }] }] } }],
    };
    const [a, b] = (migrateScenario(old).plots[0].flow as unknown as Scenario["plots"][number]["flow"]).steps;
    expect(a).toEqual({ id: "a", layout: { code: LAYOUT_A_CODE }, exits: [{ when, checkOnEntry: true }, { to: "a", when, checkOnEntry: true }] });
    expect(b.exits).toEqual([{ when }]);
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

  it("a save from before auto aloe harvest: the old default 14 becomes auto, another stage stays fixed", () => {
    const old = (stage: number) => {
      const saved = withPlots(LAYOUT_A_CODE);
      const config = { ...saved.settings.config, aloeHarvestStage: stage } as Record<string, unknown>;
      delete config.aloeAutoHarvest;
      (saved.settings.config as unknown as Record<string, unknown>) = config;
      return saved;
    };
    expect(migrateScenario(old(14)).settings.config).toMatchObject({ aloeAutoHarvest: true, aloeHarvestStage: 14 });
    expect(migrateScenario(old(11)).settings.config).toMatchObject({ aloeAutoHarvest: false, aloeHarvestStage: 11 });
    const chosen = withPlots(LAYOUT_A_CODE);
    chosen.settings.config = { ...chosen.settings.config, aloeAutoHarvest: false };
    expect(migrateScenario(chosen).settings.config.aloeAutoHarvest).toBe(false); // already set: kept
  });

  it("rejects files it cannot use, with a readable reason", () => {
    const sc = withPlots(LAYOUT_A_CODE);
    expect(() => importFlows(sc, "nope")).toThrow("not valid JSON");
    expect(() => importFlows(sc, "{}")).toThrow("No plots");
    expect(() => importFlows(sc, JSON.stringify({ plots: [{ id: 1, flow: { steps: [] } }] }))).toThrow("Plot 1: no steps");
    expect(() => importFlows(sc, JSON.stringify({ plots: [{ id: 1, flow: { steps: [{ id: "s", layout: { code: "x" }, exits: [] }] } }, { id: 1, flow: { steps: [{ id: "s", layout: { code: "x" }, exits: [] }] } }] }))).toThrow("unique");
  });
});

describe("selectable flow export / import", () => {
  const allOptions: FlowExportOptions = {
    startingInventory: true,
    playerSettings: true,
    onlineSchedule: true,
    actionDefaults: true,
    advancedSettings: true,
    seed: true,
  };
  const source = (): Scenario => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE);
    sc.startingInventory = { chloronite: 9, magic_jellybean: 0 };
    sc.settings.seed = 777;
    sc.settings.playerStats = { ...sc.settings.playerStats, farmingFortune: 123, floraShard: 2, startTimeOfDay: 7 };
    sc.settings.activity = { kind: "windows", windows: [{ from: 8, to: 11 }, { from: 17, to: 20 }] };
    sc.settings.playerActions = false;
    sc.settings.policies = {
      ...sc.settings.policies,
      watering: "never",
      baseCropUpkeep: "harvestWhenGrown",
      gateInteractions: { ...sc.settings.policies.gateInteractions, wakeSnoozling: false, dischargeThunderling: false },
    };
    sc.settings.config = { ...sc.settings.config, waterLossMin: 2, waterLossMax: 3, allowMutationDebt: true, plotOrder: [2, 1, 3] };
    sc.plots[0].policies = { watering: "never" };
    sc.plots[0].flow.steps[0].watch = ["0,0"];
    sc.plots[0].flow.steps[0].exits = [{ when: [{ kind: "cycles", n: 7 }] }];
    return sc;
  };
  const current = (): Scenario => {
    const sc = withPlots(LAYOUT_B_CODE);
    sc.startingInventory = { magic_jellybean: 4 };
    sc.settings.seed = 321;
    sc.settings.playerStats = { ...sc.settings.playerStats, farmingFortune: 900, floraShard: 8, startTimeOfDay: 18 };
    sc.settings.activity = { kind: "everyN", n: 5, offset: 2 };
    sc.settings.config = { ...sc.settings.config, waterLossMax: 30, negativeWaterSkipChance: 0, plotOrder: [3, 2, 1] };
    sc.settings.policies.gateInteractions.vacuumRat = false;
    return sc;
  };
  const v2 = (extras: Record<string, unknown> = {}) => ({ kind: "skyshards-greenhouse-flows", version: 2, plots: source().plots, ...extras });

  it("keeps defaults, omitted options and explicitly disabled options byte-for-byte compatible with v1", () => {
    const sc = source();
    expect(DEFAULT_FLOW_EXPORT_OPTIONS).toEqual({
      startingInventory: false,
      playerSettings: false,
      onlineSchedule: false,
      actionDefaults: false,
      advancedSettings: false,
      seed: false,
    });
    const expected = { kind: "skyshards-greenhouse-flows", version: 1, plots: sc.plots };
    for (const file of [exportFlows(sc), exportFlows(sc, {}), exportFlows(sc, DEFAULT_FLOW_EXPORT_OPTIONS), exportFlows(sc, { seed: false })]) {
      expect(file).toEqual(expected);
      expect(JSON.stringify(file)).toBe(JSON.stringify(expected));
    }
  });

  it("includes only starting inventory when selected, without an empty settings object", () => {
    const sc = source();
    expect(exportFlows(sc, { startingInventory: true })).toEqual(v2({ startingInventory: sc.startingInventory }));
  });

  it("includes only player stats, excluding the schedule-owned starting clock", () => {
    const sc = source();
    const stats = { ...sc.settings.playerStats };
    delete (stats as Partial<typeof stats>).startTimeOfDay;
    expect(exportFlows(sc, { playerSettings: true })).toEqual(v2({ settings: { playerStats: stats } }));
  });

  it("includes only the online schedule and its starting clock", () => {
    const sc = source();
    expect(exportFlows(sc, { onlineSchedule: true })).toEqual(v2({ settings: {
      activity: sc.settings.activity,
      playerStats: { startTimeOfDay: sc.settings.playerStats.startTimeOfDay },
    } }));
  });

  it("includes only action defaults, keeping an explicit false playerActions", () => {
    const sc = source();
    expect(exportFlows(sc, { actionDefaults: true })).toEqual(v2({ settings: { policies: sc.settings.policies, playerActions: false } }));
  });

  it("exports missing playerActions as true without filling it into the input", () => {
    const sc = source();
    delete sc.settings.playerActions;
    expect(exportFlows(sc, { actionDefaults: true })).toEqual(v2({ settings: { policies: sc.settings.policies, playerActions: true } }));
    expect(sc.settings).not.toHaveProperty("playerActions");
  });

  it("includes only advanced config when selected", () => {
    const sc = source();
    expect(exportFlows(sc, { advancedSettings: true })).toEqual(v2({ settings: { config: sc.settings.config } }));
  });

  it("includes only the seed when selected, preserving zero", () => {
    const sc = source();
    sc.settings.seed = 0;
    expect(exportFlows(sc, { seed: true })).toEqual(v2({ settings: { seed: 0 } }));
  });

  it("combines player and online choices into one complete playerStats object", () => {
    const sc = source();
    expect(exportFlows(sc, { playerSettings: true, onlineSchedule: true, seed: false })).toEqual(v2({ settings: {
      playerStats: sc.settings.playerStats,
      activity: sc.settings.activity,
    } }));
    expect(DEFAULT_FLOW_EXPORT_OPTIONS.seed).toBe(false);
  });

  it("round-trips all selected sections, replacing inventory and restoring the entire source scenario", () => {
    const sc = source();
    const mine = current();
    const file = exportFlows(sc, allOptions);
    expect(file).toEqual(v2({ startingInventory: sc.startingInventory, settings: sc.settings }));
    expect(importFlows(mine, JSON.stringify(file))).toEqual(sc);
  });

  it.each(["startingInventory", "playerSettings", "onlineSchedule", "actionDefaults", "advancedSettings", "seed"] as const)(
    "imports %s without changing omitted sections or their references",
    (option) => {
      const mine = current();
      const before = structuredClone(mine);
      const sc = source();
      const next = importFlows(mine, JSON.stringify(exportFlows(sc, { [option]: true })));
      expect(next.plots).toEqual(sc.plots);
      expect(next.startingInventory).toEqual(option === "startingInventory" ? sc.startingInventory : mine.startingInventory);
      if (option !== "startingInventory") expect(next.startingInventory).toBe(mine.startingInventory);
      if (option === "startingInventory") expect(next.settings).toBe(mine.settings);
      expect(next.settings.seed).toBe(option === "seed" ? sc.settings.seed : mine.settings.seed);
      expect(next.settings.playerActions).toBe(option === "actionDefaults" ? sc.settings.playerActions : mine.settings.playerActions);
      for (const [key, selected] of [["activity", "onlineSchedule"], ["policies", "actionDefaults"], ["config", "advancedSettings"]] as const) {
        expect(next.settings[key]).toEqual(option === selected ? sc.settings[key] : mine.settings[key]);
        if (option !== selected) expect(next.settings[key]).toBe(mine.settings[key]);
      }
      const expectedStats = option === "playerSettings"
        ? { ...sc.settings.playerStats, startTimeOfDay: mine.settings.playerStats.startTimeOfDay }
        : option === "onlineSchedule"
          ? { ...mine.settings.playerStats, startTimeOfDay: sc.settings.playerStats.startTimeOfDay }
          : mine.settings.playerStats;
      expect(next.settings.playerStats).toEqual(expectedStats);
      if (option !== "playerSettings" && option !== "onlineSchedule") expect(next.settings.playerStats).toBe(mine.settings.playerStats);
      expect(mine).toEqual(before);
    }
  );

  it("imports a mixed subset while preserving every omitted current setting", () => {
    const mine = current();
    const sc = source();
    const next = importFlows(mine, JSON.stringify(exportFlows(sc, { startingInventory: true, playerSettings: true, actionDefaults: true })));
    expect(next.startingInventory).toEqual(sc.startingInventory);
    expect(next.settings.playerStats).toEqual({ ...sc.settings.playerStats, startTimeOfDay: 18 });
    expect(next.settings.policies).toEqual(sc.settings.policies);
    expect(next.settings.playerActions).toBe(false);
    expect(next.settings.activity).toBe(mine.settings.activity);
    expect(next.settings.config).toBe(mine.settings.config);
    expect(next.settings.seed).toBe(mine.settings.seed);
  });

  it("merges partial stats, config and policy defaults over current values, including nested gates", () => {
    const mine = current();
    const before = structuredClone(mine);
    const next = importFlows(mine, JSON.stringify(v2({ settings: {
      playerStats: { farmingFortune: 42 },
      config: { waterLossMin: 1 },
      policies: { watering: "never", gateInteractions: { dischargeThunderling: false } },
    } })));
    expect(next.settings.playerStats).toEqual({ ...mine.settings.playerStats, farmingFortune: 42 });
    expect(next.settings.config).toEqual({ ...mine.settings.config, waterLossMin: 1 });
    expect(next.settings.policies).toEqual({
      ...mine.settings.policies,
      watering: "never",
      gateInteractions: { ...mine.settings.policies.gateInteractions, dischargeThunderling: false },
    });
    expect(next.settings.policies.gateInteractions.vacuumRat).toBe(false);
    expect(next.settings.policies.gateInteractions.wakeSnoozling).toBe(true);
    expect(next.settings.playerActions).toBe(mine.settings.playerActions);
    expect(next.settings.activity).toBe(mine.settings.activity);
    expect(next.startingInventory).toBe(mine.startingInventory);
    expect(mine).toEqual(before);
  });

  it("keeps unrelated defaults when importing a flat partial policy with no gates", () => {
    const mine = current();
    const next = importFlows(mine, JSON.stringify(v2({ settings: { policies: { baseCropUpkeep: "harvestWhenGrown" } } })));
    expect(next.settings.policies).toEqual({ ...mine.settings.policies, baseCropUpkeep: "harvestWhenGrown" });
    expect(next.settings.playerStats).toBe(mine.settings.playerStats);
    expect(next.settings.config).toBe(mine.settings.config);
    expect(next.settings.activity).toBe(mine.settings.activity);
  });

  it.each([14, 11])("migrates included old config before merging it, including aloe stage %s", (aloeHarvestStage) => {
    const mine = current();
    const oldConfig = {
      stageBaselineSeconds: 7200,
      keepIdenticalOnStageChange: false,
      deathWater: -80,
      rareDropValues: { chloronite: 1000 },
      waterLossMin: 2,
      waterLossMax: 3,
      aloeHarvestStage,
    };
    const next = importFlows(mine, JSON.stringify(v2({ settings: { config: oldConfig } })));
    expect(next.settings.config).toEqual({
      ...mine.settings.config,
      keepIdenticalOnStepChange: false,
      waterLossMin: 2,
      waterLossMax: 3,
      aloeHarvestStage,
      aloeAutoHarvest: aloeHarvestStage === 14,
    });
    for (const key of REMOVED_CONFIG) expect(next.settings.config).not.toHaveProperty(key);
    expect(next.settings.config).not.toHaveProperty("keepIdenticalOnStageChange");
    expect(next.settings.config).not.toHaveProperty("deathWater");
    expect(next.settings.playerStats).toBe(mine.settings.playerStats);
    expect(next.settings.policies).toBe(mine.settings.policies);
    expect(oldConfig.keepIdenticalOnStageChange).toBe(false);
  });

  it.each(["v1", "untagged scenario", "other kind"] as const)("keeps %s imports plots-only even with optional sections present", (format) => {
    const sc = source();
    const mine = current();
    const file = format === "untagged scenario" ? sc : {
      kind: format === "v1" ? "skyshards-greenhouse-flows" : "skyshards-greenhouse-rotations",
      version: format === "v1" ? 1 : 2,
      plots: sc.plots,
      startingInventory: sc.startingInventory,
      settings: sc.settings,
    };
    const next = importFlows(mine, JSON.stringify(file));
    expect(next.plots).toEqual(sc.plots);
    expect(next.settings).toBe(mine.settings);
    expect(next.startingInventory).toBe(mine.startingInventory);
  });

  it("does not validate extras in legacy plots-only files", () => {
    const mine = current();
    for (const file of [
      { ...v2({ startingInventory: { chloronite: -1 }, settings: null }), version: 1 },
      { plots: source().plots, startingInventory: [], settings: { seed: "invalid", playerActions: "invalid" } },
    ]) {
      const next = importFlows(mine, JSON.stringify(file));
      expect(next.settings).toBe(mine.settings);
      expect(next.startingInventory).toBe(mine.startingInventory);
    }
  });

  it("explicit empty inventory clears existing stock, and false actions and a zero seed are retained", () => {
    const sc = source();
    sc.startingInventory = {};
    sc.settings.seed = 0;
    const mine = current();
    const next = importFlows(mine, JSON.stringify(exportFlows(sc, { startingInventory: true, actionDefaults: true, seed: true })));
    expect(next.startingInventory).toEqual({});
    expect(next.startingInventory).not.toBe(mine.startingInventory);
    expect(next.settings.playerActions).toBe(false);
    expect(next.settings.seed).toBe(0);
    expect(mine.startingInventory).toEqual({ magic_jellybean: 4 });
  });

  it("keeps the whole current settings object when a v2 file has no settings section", () => {
    const mine = current();
    const next = importFlows(mine, JSON.stringify(v2()));
    expect(next.settings).toBe(mine.settings);
    expect(next.startingInventory).toBe(mine.startingInventory);
  });

  it("keeps default v1 exports deep-copied without changing the scenario", () => {
    const sc = source();
    const before = structuredClone(sc);
    const file = exportFlows(sc);
    expect(sc).toEqual(before);
    file.plots[0].flow.steps[0].watch!.push("1,1");
    file.plots[0].policies!.watering = "toMax";
    file.plots[0].flow.steps[0].exits[0].when.push({ kind: "cycles", n: 1 });
    expect(sc).toEqual(before);
  });

  it("deep-copies exports, including plots, schedule windows, nested gates and config arrays", () => {
    const sc = source();
    const before = structuredClone(sc);
    const file = exportFlows(sc, allOptions);
    expect(sc).toEqual(before);
    file.plots[0].flow.steps[0].watch!.push("1,1");
    file.plots[0].flow.steps[0].exits[0].when.push({ kind: "cycles", n: 1 });
    file.startingInventory!.chloronite = 0;
    file.settings!.playerStats!.farmingFortune = 0;
    file.settings!.policies!.gateInteractions!.wakeSnoozling = true;
    file.settings!.config!.plotOrder!.reverse();
    const activity = file.settings!.activity!;
    expect(activity.kind).toBe("windows");
    if (activity.kind === "windows") activity.windows[0].from = 0;
    expect(sc).toEqual(before);
  });

  it("does not mutate inputs on import and gives imported sections independent deep copies", () => {
    const mine = current();
    const sc = source();
    const mineBefore = structuredClone(mine);
    const sourceBefore = structuredClone(sc);
    const file = exportFlows(sc, allOptions);
    const fileBefore = structuredClone(file);
    const text = JSON.stringify(file);
    const next = importFlows(mine, text);
    const again = importFlows(mine, text);
    expect(mine).toEqual(mineBefore);
    expect(sc).toEqual(sourceBefore);
    expect(file).toEqual(fileBefore);
    next.plots[0].flow.steps[0].watch!.push("1,1");
    next.startingInventory.chloronite = 0;
    next.settings.playerStats.farmingFortune = 0;
    next.settings.policies.gateInteractions.wakeSnoozling = true;
    next.settings.config.plotOrder.reverse();
    if (next.settings.activity.kind === "windows") next.settings.activity.windows[0].from = 0;
    expect(again).toEqual(sourceBefore);
    expect(mine).toEqual(mineBefore);
    expect(sc).toEqual(sourceBefore);
    expect(file).toEqual(fileBefore);
  });

  it.each([0, 3, 999, "2", null, undefined])("rejects unsupported matching-kind version %s with a readable version error", (version) => {
    expect(() => importFlows(current(), JSON.stringify(v2({ version })))).toThrow(/version/i);
  });

  it.each([
    { label: "negative inventory", section: "startingInventory", extras: { startingInventory: { chloronite: -1 } } },
    { label: "string inventory quantity", section: "startingInventory", extras: { startingInventory: { chloronite: "9" } } },
    { label: "null inventory quantity", section: "startingInventory", extras: { startingInventory: { chloronite: null } } },
    { label: "boolean inventory quantity", section: "startingInventory", extras: { startingInventory: { chloronite: false } } },
    { label: "null inventory", section: "startingInventory", extras: { startingInventory: null } },
    { label: "array inventory", section: "startingInventory", extras: { startingInventory: [] } },
    { label: "null settings", section: "settings", extras: { settings: null } },
    { label: "array settings", section: "settings", extras: { settings: [] } },
    { label: "null stats", section: "playerStats", extras: { settings: { playerStats: null } } },
    { label: "array stats", section: "playerStats", extras: { settings: { playerStats: [] } } },
    { label: "null schedule", section: "activity", extras: { settings: { activity: null } } },
    { label: "array schedule", section: "activity", extras: { settings: { activity: [] } } },
    { label: "null policies", section: "policies", extras: { settings: { policies: null } } },
    { label: "array policies", section: "policies", extras: { settings: { policies: [] } } },
    { label: "null gates", section: "policies", extras: { settings: { policies: { gateInteractions: null } } } },
    { label: "array gates", section: "policies", extras: { settings: { policies: { gateInteractions: [] } } } },
    { label: "null config", section: "config", extras: { settings: { config: null } } },
    { label: "array config", section: "config", extras: { settings: { config: [] } } },
    { label: "string actions", section: "playerActions", extras: { settings: { playerActions: "false" } } },
    { label: "number actions", section: "playerActions", extras: { settings: { playerActions: 0 } } },
    { label: "null actions", section: "playerActions", extras: { settings: { playerActions: null } } },
    { label: "string seed", section: "seed", extras: { settings: { seed: "0" } } },
    { label: "null seed", section: "seed", extras: { settings: { seed: null } } },
    { label: "boolean seed", section: "seed", extras: { settings: { seed: false } } },
    { label: "string stats field", section: "playerStats", extras: { settings: { playerStats: { farmingFortune: "42" } } } },
    { label: "null config field", section: "config", extras: { settings: { config: { waterLossMin: null } } } },
    { label: "number gate toggle", section: "policies", extras: { settings: { policies: { gateInteractions: { wakeSnoozling: 0 } } } } },
    { label: "string policy toggle", section: "policies", extras: { settings: { policies: { replaceDecayed: "false" } } } },
    { label: "string interval count", section: "activity", extras: { settings: { activity: { kind: "everyN", n: "5", offset: 0 } } } },
    { label: "null online window", section: "activity", extras: { settings: { activity: { kind: "windows", windows: [null] } } } },
  ])("rejects $label while identifying $section", ({ extras, section }) => {
    const mine = current();
    const before = structuredClone(mine);
    const sectionNames: Record<string, RegExp> = {
      startingInventory: /starting\s*inventory/i,
      settings: /settings/i,
      playerStats: /player\s*(stats|settings)/i,
      activity: /activity|online\s*schedule/i,
      policies: /policies|action\s*defaults/i,
      config: /config|advanced\s*settings/i,
      playerActions: /player\s*actions|action\s*defaults/i,
      seed: /seed/i,
    };
    expect(() => importFlows(mine, JSON.stringify(v2(extras)))).toThrow(sectionNames[section]);
    expect(mine).toEqual(before);
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
    const step = { id: "s", layout: { code }, exits: [], watch: ["3,4"] };
    expect(transformWatch(step, { kind: "rotate", direction: "cw" }).watch).toEqual(["4,6"]);
    expect(transformWatch(step, { kind: "mirror", axis: "horizontal" }).watch).toEqual(["3,5"]);
    expect(transformWatch(step, { kind: "nudge", dRow: 1, dCol: 0 }).watch).toEqual(["4,4"]);
    const all = { id: "s", layout: { code }, exits: [] };
    expect(transformWatch(all, { kind: "rotate", direction: "cw" })).toBe(all);
  });
});
