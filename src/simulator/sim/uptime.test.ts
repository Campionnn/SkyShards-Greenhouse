import { describe, expect, it } from "vitest";
import type { FlowStep, LayoutSpec } from "../flow/types";
import { engine, flow, inject, layout, NEVER_ACTIVE, scenario, step, start } from "../testHelpers";

// Sustainability = uptime of watched target cells: a watched cell counts as
// up while its target stands there or could spawn there now. Sitting empty
// without the requirements is the failure; being blocked only lowers uptime.

/** Ashwreath needs two nether wart + two fire in its ring (soul sand is painted by the target). */
const ASHWREATH_RING: [string, number, number][] = [
  ["nether_wart", 3, 4],
  ["nether_wart", 3, 5],
  ["fire", 4, 3],
  ["fire", 4, 5],
];

const one = (spec: LayoutSpec, extra: Partial<FlowStep> = {}, config = {}) =>
  start(scenario([flow([step("only", spec, [], extra)])], { config, activity: NEVER_ACTIVE }));

describe("target uptime", () => {
  it("a target whose requirements hold is up, and the run is sustainable", () => {
    // Water loss pinned to 0: with the player away, the nether wart would dry out on cycle 4 and stop counting.
    const s = one(layout(ASHWREATH_RING, [["ashwreath", 4, 4]]), {}, { waterLossMin: 0, waterLossMax: 0 });
    const r = engine.run(s, 5);
    const report = engine.analyse(r.state);
    expect(report.totals.watched).toBe(5);
    expect(report.totals.requirements).toBe(0);
    expect(report.uptime).toBe(1);
    expect(report.sustainable).toBe(true);
    expect(report.spots).toHaveLength(1);
    expect(report.spots[0]).toMatchObject({ plotId: 1, stepId: "only", mutationId: "ashwreath", row: 4, col: 4 });
  });

  it("an empty target without its requirements loses uptime and fails the check", () => {
    const r = engine.run(one(layout([], [["ashwreath", 4, 4]])), 4);
    const report = engine.analyse(r.state);
    expect(report.totals).toMatchObject({ watched: 4, requirements: 4, ready: 0, growing: 0 });
    expect(report.uptime).toBe(0);
    expect(report.sustainable).toBe(false);
    expect(report.firstFailure).toMatchObject({ row: 4, col: 4, firstRequirementsCycle: 0, longestRequirementsStreak: 4 });
    expect(r.state.plots[0].watchStatus["4,4"]).toBe("requirements");
  });

  it("the target standing in its cell counts as up", () => {
    const s = one(layout([], [["ashwreath", 4, 4]]));
    inject(s, 1, "ashwreath", 4, 4, "spawned");
    const r = engine.run(s, 1);
    expect(r.state.summary.uptime).toMatchObject({ watched: 1, growing: 1 });
    expect(r.state.plots[0].watchStatus["4,4"]).toBe("growing");
  });

  it("a cell blocked by something else lowers uptime but is not a requirements failure", () => {
    const s = one(layout([], [["ashwreath", 4, 4]]));
    inject(s, 1, "fire", 4, 4, "placed");
    const report = engine.analyse(engine.run(s, 3).state);
    expect(report.totals).toMatchObject({ watched: 3, blocked: 3, requirements: 0 });
    expect(report.uptime).toBe(0);
    expect(report.sustainable).toBe(true);
  });

  it("watch: [] turns the check off for a step; a subset watches only those targets", () => {
    const spec = layout([], [
      ["ashwreath", 4, 4],
      ["ashwreath", 7, 7],
    ]);
    const none = engine.run(one(spec, { watch: [] }), 3).state;
    expect(none.summary.uptime.watched).toBe(0);
    expect(engine.analyse(none).sustainable).toBe(true);

    const subset = engine.run(one(spec, { watch: ["7,7"] }), 3).state;
    const report = engine.analyse(subset);
    expect(report.spots.map((s) => `${s.row},${s.col}`)).toEqual(["7,7"]);
    expect(report.totals.watched).toBe(3);

    const all = engine.run(one(spec), 3).state;
    expect(engine.analyse(all).totals.watched).toBe(6);
  });

  it("records each step of a flow separately", () => {
    const a = layout([], [["ashwreath", 4, 4]]);
    const b = layout(ASHWREATH_RING, [["ashwreath", 4, 4]]);
    const sc = (inventory: Record<string, number>) =>
      scenario([flow([step("bare", a, [{ kind: "cycles", n: 2 }]), step("ringed", b)], false)], { inventory });
    const r = engine.run(start(sc({ fire: 2 })), 5);
    const report = engine.analyse(r.state);
    const byStep = Object.fromEntries(report.spots.map((s) => [s.stepId, s]));
    expect(byStep.bare.requirements).toBe(2);
    expect(byStep.ringed.requirements).toBe(0);
    expect(byStep.ringed.watched).toBe(3);

    // Without the fire to lay the second step out, it goes into debt and its target loses uptime too.
    const broke = engine.analyse(engine.run(start(sc({})), 5).state);
    expect(broke.debtCount).toBeGreaterThan(0);
    expect(broke.spots.find((s) => s.stepId === "ringed")!.requirements).toBe(3);
  });

  it("warns about watched cells that are not targets in the layout", () => {
    const sc = scenario([flow([step("only", layout([], [["ashwreath", 4, 4]]), [], { watch: ["4,4", "1,1"] })])]);
    expect(engine.validate(sc).some((i) => i.level === "warning" && i.message.includes("1,1"))).toBe(true);
  });

  it("recording is splittable like the rest of the run", () => {
    const s = one(layout([], [["ashwreath", 4, 4]]));
    const whole = engine.run(s, 6).state;
    const halves = engine.run(engine.run(s, 3).state, 3).state;
    expect(JSON.stringify(halves)).toBe(JSON.stringify(whole));
  });
});
