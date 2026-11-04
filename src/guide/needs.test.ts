import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  baselineTotals,
  buildCatalog,
  createGuideEnv,
  flowFingerprint,
  flowNeeds,
  guideDefaultSettings,
  initialState,
  needsTotals,
  parseFlows,
  runForecast,
  scriptMarks,
  toInput,
  type FlowsFile,
  type RunTimeline,
} from "./index";

const guideEnv = createGuideEnv();
const flow: FlowsFile = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
const catalog = buildCatalog(flow, guideEnv.env.resolveLayout);
const settings = guideDefaultSettings();
const empty = toInput(initialState(flow, settings));
const runs = runForecast(flow, empty, guideEnv, [1, 2, 3]);
const totals = baselineTotals(runs, catalog);
const marks = scriptMarks(flow);

/** A fake run that placed these items. */
const run = (placed: Record<string, number>, done = true): RunTimeline => ({
  seed: 1,
  visits: [],
  farms: {},
  cycles: 1,
  elapsedSeconds: 1,
  logins: 1,
  done,
  debtEvents: 0,
  supplyNeed: {},
  supplyShortAt: {},
  placed,
});

describe("whole-flow totals (simulated runs)", () => {
  it("records what every run placed", () => {
    for (const r of runs) {
      expect(r.done).toBe(true);
      expect(r.placed?.choconut).toBeGreaterThan(0);
    }
  }, 120_000);

  it("totals what the runs place plus what the goal keeps, for every mutation the flow uses", () => {
    for (const g of catalog.goal) expect(totals[g.item]).toBeGreaterThanOrEqual(g.count);
    // Realistic low tiers: the old build-plan walk said ~340 Choconut.
    expect(totals.choconut).toBeGreaterThan(60);
    expect(totals.choconut).toBeLessThan(300);
    expect(totals.gloomgourd).toBeGreaterThan(5);
    // Dead Plants, Fermento and Aloe fragments are not mutations the totals count.
    expect(totals.dead_plant).toBeUndefined();
    expect(totals.fermento).toBeUndefined();
    expect(totals.all_in_aloe_fragment).toBeUndefined();
  });

  it("uses the median run, so one wasteful run doesn't move the total", () => {
    const t = baselineTotals([run({ choconut: 130 }), run({ choconut: 140 }), run({ choconut: 303 })], catalog);
    expect(t.choconut).toBe(140 + (catalog.goal.find((g) => g.item === "choconut")?.count ?? 0));
    // Unfinished runs are ignored when some finished.
    expect(baselineTotals([run({ choconut: 100 }), run({ choconut: 900 }, false)], catalog).choconut).toBe(100 + 1);
  });

  it("is not ready until both the totals and a forecast are in", () => {
    expect(flowNeeds(null, runs, catalog, {}, marks).ready).toBe(false);
    expect(flowNeeds(totals, null, catalog, {}, marks).ready).toBe(false);
    expect(flowNeeds(totals, runs, catalog, {}, marks, 3)).toMatchObject({ ready: true, runs: 3 });
  });

  it("starts at nothing covered from an empty start", () => {
    const needs = flowNeeds(totals, runs, catalog, {}, marks);
    expect(needs.items.choconut.covered).toBe(0);
    expect(needs.items.choconut.remaining).toBe(needs.items.choconut.total);
  });

  it("counts stock, and owning what an item is made into, as covered", () => {
    const total = { gloomgourd: 60 };
    // The player owns 20; the runs from there still place 30 (plus the goal's 1).
    expect(flowNeeds(total, [run({ gloomgourd: 30 })], catalog, { gloomgourd: 20 }, marks).items.gloomgourd).toMatchObject({ total: 60, remaining: 11, covered: 49, have: 20 });
    // Everything made from Gloomgourd is owned: the runs never place any. The goal's one is still needed.
    expect(flowNeeds(total, [run({})], catalog, {}, marks).items.gloomgourd.remaining).toBe(1);
    expect(flowNeeds(total, [run({})], catalog, { gloomgourd: 1 }, marks).items.gloomgourd.remaining).toBe(0);
  });

  it("is done everywhere once the goal is owned", () => {
    const goal = Object.fromEntries(catalog.goal.map((g) => [g.item, g.count]));
    const needs = flowNeeds(totals, [run({})], catalog, goal, marks);
    const t = needsTotals(needs);
    expect(t.done).toBe(t.items);
    expect(t.covered).toBe(t.total);
  });

  it("counts every 9 Aloe fragments as one All-in Aloe", () => {
    expect(flowNeeds({ all_in_aloe: 2 }, [run({})], catalog, { all_in_aloe: 1, all_in_aloe_fragment: 9 }, marks).items.all_in_aloe.remaining).toBe(0);
  });

  it("reads the script's stock marks and fingerprints the flow", () => {
    expect(marks.choconut).toBeGreaterThan(0);
    expect(scriptMarks({ plots: [] })).toEqual({});
    expect(flowFingerprint(flow)).toBe(flowFingerprint(parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"))));
    expect(flowFingerprint(flow)).not.toBe(flowFingerprint(parseFlows(readFileSync("public/greenhouse/flows/rose-dragon-2plots.flows.json", "utf8"))));
  });
});
