import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flowNeeds, needsTotals, parseFlows, scriptPlan, type FlowsFile } from "./index";

const flow: FlowsFile = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
const twoPlots: FlowsFile = parseFlows(readFileSync("public/greenhouse/flows/rose-dragon-2plots.flows.json", "utf8"));
const plan = scriptPlan(flow)!;

describe("whole-flow needs (the script's own build plan)", () => {
  it("reads the build plan out of the shipped script", () => {
    expect(plan).not.toBeNull();
    expect(plan.topo).toContain("commons");
    expect(plan.plan.cream.use.gloomgourd).toBeGreaterThan(0);
    expect(scriptPlan(twoPlots)).not.toBeNull();
    expect(scriptPlan({ plots: [] })).toBeNull();
  });

  it("estimates a total for every goal item and every input along the way", () => {
    const needs = flowNeeds(plan, {});
    for (const [item, count] of Object.entries(plan.goal)) expect(needs.items[item]?.total).toBeGreaterThanOrEqual(count);
    // Gloomgourd feeds Cream and Soggybud farms: far more than the one the goal asks for.
    expect(needs.items.gloomgourd.total).toBeGreaterThan(20);
    expect(needs.items.gloomgourd).toMatchObject({ covered: 0, remaining: needs.items.gloomgourd.total, have: 0 });
    // Dead Plants and Fermento are not modelled by the plan: no row.
    expect(needs.items.dead_plant).toBeUndefined();
  });

  it("counts stock as covered", () => {
    const needs = flowNeeds(plan, { gloomgourd: 20 });
    expect(needs.items.gloomgourd.covered).toBe(20);
    expect(needs.items.gloomgourd.remaining).toBe(needs.items.gloomgourd.total - 20);
  });

  it("counts owning what an item is made into as covered", () => {
    // Enough of everything made from Gloomgourd (and what those become), and nothing in stock.
    const downstream = { creambloom: 500, chocoberry: 500, soggybud: 500 };
    const needs = flowNeeds(plan, downstream);
    expect(needs.items.gloomgourd.have).toBe(0);
    expect(needs.items.gloomgourd.remaining).toBeLessThanOrEqual(1); // the goal's own one
    expect(needs.items.gloomgourd.remaining).toBe(Math.max(0, plan.goal.gloomgourd));
    const own = flowNeeds(plan, { ...downstream, gloomgourd: 1 });
    expect(own.items.gloomgourd.remaining).toBe(0);
  });

  it("is done everywhere once the goal is owned", () => {
    const needs = flowNeeds(plan, { ...plan.goal });
    expect(Object.values(needs.items).every((r) => r.remaining === 0)).toBe(true);
    const t = needsTotals(needs);
    expect(t.done).toBe(t.items);
    expect(t.covered).toBe(t.total);
  });

  it("credits a farm already standing as one paid build", () => {
    const idle = flowNeeds(plan, {}, ["hub", "hub", "hub"]);
    const cream = flowNeeds(plan, {}, ["cream", "hub", "hub"]);
    expect(cream.items.gloomgourd.remaining).toBeLessThan(idle.items.gloomgourd.remaining);
  });

  it("counts every 9 Aloe fragments as one All-in Aloe", () => {
    expect(flowNeeds(plan, { all_in_aloe: 1, all_in_aloe_fragment: 9 }).items.all_in_aloe.remaining).toBe(0);
  });
});
