import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../simulator";
import { buildPlan, createGuideEnv, goalItems, initialState, medoid, parseFlows, runForecast, runOne, sequenceDistance, spread, summarise, toInput, type FlowsFile, type RunTimeline } from "./index";

const guideEnv = createGuideEnv();
const flow: FlowsFile = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
const SUPPLIED = toInput(initialState(flow, defaultSettings()));
const runs = runForecast(flow, SUPPLIED, guideEnv, [1, 2]);

describe("runOne", () => {
  it("plays the flow to Done from the starter supplies, without debt", () => {
    for (const run of runs) {
      expect(run.done).toBe(true);
      expect(run.debtEvents).toBe(0);
      expect(run.logins).toBeGreaterThan(10);
      for (const plotId of [1, 2, 3]) expect(run.farms[plotId].length).toBeGreaterThan(2);
      // Visits are real time spans inside the run.
      for (const v of run.visits) expect(v.startSeconds + v.seconds).toBeLessThanOrEqual(run.elapsedSeconds + 1);
      expect(run.supplyNeed.dead_plant).toBeGreaterThan(0);
    }
  }, 120_000);

  it("is deterministic per seed", () => {
    const again = runOne(flow, SUPPLIED, 1, createGuideEnv());
    expect(again).toEqual(runs[0]);
  }, 60_000);

  it("tops supplies up when the flow runs out and records how much was needed", () => {
    const broke = toInput(initialState(flow, defaultSettings(), {}));
    const run = runOne(flow, broke, 1, guideEnv, 600);
    expect(run.debtEvents).toBe(0);
    expect(run.supplyNeed.dead_plant).toBeGreaterThan(0);
  }, 60_000);

  it("finishes at once when the goal is owned", () => {
    // The goal is read from the flow: 2 of each legendary and 1 of every other mutation.
    const goal = Object.fromEntries(goalItems(flow).map((g) => [g.item, g.count]));
    const done = toInput(initialState(flow, defaultSettings(), goal));
    const run = runOne(flow, done, 1, guideEnv);
    expect(run.done).toBe(true);
    expect(run.cycles).toBe(0);
  });

  it("forecasts differently for a different schedule", () => {
    const daily = { ...SUPPLIED, settings: { ...SUPPLIED.settings, activity: { kind: "everyN" as const, n: 6, offset: 0 } } };
    const run = runOne(flow, daily, 1, guideEnv);
    // A sparser schedule logs in less often per cycle. (Not necessarily fewer logins in total: the
    // run can take more cycles to finish.)
    expect(run.logins / run.cycles).toBeLessThan(runs[0].logins / runs[0].cycles);
    expect(run.cycles).not.toBe(runs[0].cycles);
  }, 60_000);
});

describe("summarise and buildPlan", () => {
  it("reconciles the supplies list against what is owned", () => {
    const forecast = summarise(runs, { dead_plant: 10, fermento: 50 });
    const deadPlant = forecast.supplies.find((r) => r.item === "dead_plant")!;
    expect(deadPlant.owned).toBe(10);
    expect(deadPlant.more).toBe(Math.max(0, deadPlant.needed - 10));
    expect(forecast.completed).toBe(2);
    expect(forecast.seconds!.p10).toBeLessThanOrEqual(forecast.seconds!.median);
  });

  it("gives no completion time when no run finished", () => {
    const stalled: RunTimeline[] = runs.map((r) => ({ ...r, done: false }));
    const forecast = summarise(stalled, {});
    expect(forecast.seconds).toBeNull();
    expect(forecast.logins).toBeNull();
  });

  it("builds one lane per plot from the medoid run", () => {
    const plan = buildPlan(runs);
    expect(plan.medoidSeed).toBe(medoid(runs).seed);
    expect(Object.keys(plan.lanes)).toEqual(["1", "2", "3"]);
    for (const lane of Object.values(plan.lanes)) {
      for (let i = 1; i < lane.length; i++) expect(lane[i].startSeconds).toBeGreaterThanOrEqual(lane[i - 1].startSeconds);
      for (const seg of lane) expect(seg.share).toBeGreaterThan(0);
    }
  });

  it("measures sequence distance", () => {
    expect(sequenceDistance(["a", "b"], ["a", "b"])).toBe(0);
    expect(sequenceDistance(["a", "b"], ["a", "c"])).toBe(2);
    expect(sequenceDistance(["a"], [])).toBe(2);
    expect(spread([5, 1, 3])).toEqual({ median: 3, p10: 1, p90: 5 });
  });
});
