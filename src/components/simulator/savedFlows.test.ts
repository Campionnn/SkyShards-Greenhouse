import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type Scenario } from "../../simulator";
import { LAYOUT_A_CODE, LAYOUT_B_CODE } from "../../simulator/testHelpers";
import { addPlot } from "./scenarioEdit";
import { loadSavedFlows, SAVED_FLOWS_KEY, saveFlow, savedFlowSummary, scenarioFromSaved, suggestFlowName } from "./savedFlows";

const withPlots = (...codes: string[]): Scenario => codes.reduce((sc, code) => addPlot(sc, { code }), { plots: [], startingInventory: {}, settings: defaultSettings() } as Scenario);

describe("saved flows (localStorage)", () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves the whole scenario and loads it back exactly", () => {
    const sc = withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE);
    sc.startingInventory = { chloronite: 4 };
    sc.settings = { ...sc.settings, seed: 1234, activity: { kind: "everyN", n: 4, offset: 0 }, playerStats: { ...sc.settings.playerStats, farmingFortune: 999 } };
    const list = saveFlow([], sc, "Mine", 100)!;
    expect(list).toHaveLength(1);
    expect(loadSavedFlows()).toEqual(list);
    const back = scenarioFromSaved(withPlots(LAYOUT_B_CODE), loadSavedFlows()[0]);
    expect(back.plots).toEqual(sc.plots);
    expect(back.startingInventory).toEqual({ chloronite: 4 });
    expect(back.settings.seed).toBe(1234);
    expect(back.settings.activity).toEqual({ kind: "everyN", n: 4, offset: 0 });
    expect(back.settings.playerStats.farmingFortune).toBe(999);
    expect(savedFlowSummary(list[0])).toBe("2 plots · 2 steps");
  });

  it("overwrites a save with the same name, keeping its id and savedAt", () => {
    const a = saveFlow([], withPlots(LAYOUT_A_CODE), "X", 1)!;
    const b = saveFlow(a, withPlots(LAYOUT_A_CODE, LAYOUT_B_CODE), "X", 2)!;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ id: a[0].id, savedAt: 1, modifiedAt: 2 });
    expect(b[0].file.plots).toHaveLength(2);
  });

  it("ignores a broken store and malformed entries, and reports a refused write", () => {
    map.set(SAVED_FLOWS_KEY, "not json");
    expect(loadSavedFlows()).toEqual([]);
    map.set(SAVED_FLOWS_KEY, JSON.stringify([{ id: 1 }, null]));
    expect(loadSavedFlows()).toEqual([]);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("full"); } });
    expect(saveFlow([], withPlots(LAYOUT_A_CODE), "X")).toBeNull();
  });

  it("suggests the first free name", () => {
    const list = saveFlow([], withPlots(LAYOUT_A_CODE), "Flows 2")!;
    expect(suggestFlowName(list)).toBe("Flows 3");
    expect(suggestFlowName([])).toBe("Flows 1");
  });
});
