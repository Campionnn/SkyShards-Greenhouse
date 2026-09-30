import { describe, expect, it } from "vitest";
import { engine, flow, layout, scenario, stage, start } from "../testHelpers";
import type { Condition, FlowStage, StageRoute } from "./types";
import { describeConditions } from "./triggers";
import { deleteStage } from "../../components/simulator/scenarioEdit";

// Choosing which stage to go to: routes (conditional jumps), `next`, AND / OR
// condition groups and the stageVisits condition.

const slotsOnly = { spawnCells: "slotsOnly" as const };
const ids = (s: ReturnType<typeof start>, plotId = 1) => s.flows.find((f) => f.plotId === plotId)!.history.map((h) => h.stageId);
const at = (id: string, crop: string, exit: Condition[] = [], extra: Partial<FlowStage> = {}) => stage(id, layout([[crop, 0, 0]]), exit, extra);
const cycles = (n: number): Condition => ({ kind: "cycles", n });

describe("choosing the next stage", () => {
  it("next sends the normal exit to a chosen stage instead of the following one", () => {
    // 1 -> 2 -> 1 -> 2 ... ; stage 3 is never reached.
    const f = flow([at("s1", "wheat", [cycles(1)]), at("s2", "potato", [cycles(1)], { next: "s1" }), at("s3", "carrot")], false);
    const r = engine.run(start(scenario([f], { config: slotsOnly })), 6);
    expect(ids(r.state)).toEqual(["s1", "s2", "s1", "s2", "s1", "s2", "s1"]);
  });

  it("a route jumps to its stage once its conditions hold, before the normal exit is looked at", () => {
    const route: StageRoute = { to: "s3", when: [{ kind: "inventoryAtLeast", item: "chloronite", qty: 1 }] };
    const f = flow([at("s1", "wheat", [cycles(1)], { routes: [route] }), at("s2", "potato"), at("s3", "carrot")], false);
    expect(ids(engine.run(start(scenario([f], { config: slotsOnly })), 3).state)).toEqual(["s1", "s2"]);
    expect(ids(engine.run(start(scenario([f], { config: slotsOnly, inventory: { chloronite: 1 } })), 3).state)).toEqual(["s1", "s3"]);
  });

  it("routes are checked in order; the first that holds wins", () => {
    const f = flow(
      [at("s1", "wheat", [], { routes: [{ to: "s3", when: [cycles(1)] }, { to: "s2", when: [cycles(1)] }] }), at("s2", "potato"), at("s3", "carrot")],
      false
    );
    expect(ids(engine.run(start(scenario([f], { config: slotsOnly })), 2).state)).toEqual(["s1", "s3"]);
  });

  it("the user's example: swap between 1 and 2, and go to 3 every 3rd time through stage 2", () => {
    const f = flow(
      [
        at("s1", "wheat", [cycles(1)]),
        at("s2", "potato", [cycles(1)], {
          next: "s1",
          routes: [{ to: "s3", when: [{ kind: "stageVisits", count: 3, sinceStage: "s3" }] }],
        }),
        at("s3", "carrot", [cycles(1)], { next: "s1" }),
      ],
      false
    );
    const r = engine.run(start(scenario([f], { config: slotsOnly })), 14);
    expect(ids(r.state)).toEqual(["s1", "s2", "s1", "s2", "s1", "s2", "s3", "s1", "s2", "s1", "s2", "s1", "s2", "s3", "s1"]);
  });

  it("a non-looping plot holding its final stage can still leave through a route", () => {
    const f = flow(
      [at("s1", "wheat", [cycles(1)]), at("s2", "potato", [cycles(1)], { routes: [{ to: "s1", when: [{ kind: "inventoryAtLeast", item: "wheat", qty: 1 }] }] })],
      false
    );
    const s = start(scenario([f], { config: slotsOnly }));
    const held = engine.run(s, 4).state;
    expect(held.flows[0].finished).toBe(true);
    expect(ids(held)).toEqual(["s1", "s2"]);
    const fed = engine.addItems(held, { wheat: 1 });
    const moved = engine.run(fed, 1).state;
    expect(ids(moved)).toEqual(["s1", "s2", "s1"]);
    expect(moved.flows[0].finished).toBe(false);
  });

  it("a route that becomes due while the player is away keeps its target for the next session", () => {
    const f = flow([at("s1", "wheat", [cycles(1)], { routes: [{ to: "s3", when: [cycles(1)] }] }), at("s2", "potato"), at("s3", "carrot")], false);
    const r = engine.run(start(scenario([f], { config: slotsOnly, activity: { kind: "everyN", n: 4, offset: 3 } })), 2);
    expect(r.state.flows[0]).toMatchObject({ pendingTransition: true, pendingTarget: 2 });
    const later = engine.run(r.state, 2).state;
    expect(ids(later)).toEqual(["s1", "s3"]);
    expect(later.flows[0].pendingTarget).toBeUndefined();
  });

  it("a stage can route to itself: the layout is re-applied and its counters restart", () => {
    const f = flow([at("s1", "wheat", [], { routes: [{ to: "s1", when: [cycles(2)] }] })], false);
    const r = engine.run(start(scenario([f], { config: slotsOnly })), 5);
    expect(ids(r.state)).toEqual(["s1", "s1", "s1"]);
    expect(r.state.flows[0].cyclesInStage).toBe(1);
  });

  it("routes keep runs deterministic and splittable", () => {
    const f = flow(
      [
        at("s1", "wheat", [cycles(2)]),
        at("s2", "potato", [cycles(1)], { next: "s1", routes: [{ to: "s3", when: [{ kind: "stageVisits", count: 2, sinceStage: "s3" }] }] }),
        at("s3", "carrot", [cycles(1)]),
      ],
      true
    );
    const s = start(scenario([f], { config: slotsOnly, activity: { kind: "everyN", n: 3, offset: 1 } }));
    const whole = engine.run(s, 40).state;
    const split = engine.run(engine.run(s, 17).state, 23).state;
    expect(JSON.stringify(split)).toBe(JSON.stringify(whole));
  });
});

describe("AND / OR conditions", () => {
  const two = (exit: Condition[], exitMatch?: "all" | "any") =>
    flow([at("s1", "wheat", exit, exitMatch ? { exitMatch } : {}), at("s2", "potato")], false);
  const blocked: Condition = { kind: "inventoryAtLeast", item: "chloronite", qty: 1 };

  it("exitMatch any leaves when one condition holds; all waits for every one", () => {
    const any = engine.run(start(scenario([two([cycles(2), blocked], "any")], { config: slotsOnly })), 5).state;
    expect(ids(any)).toEqual(["s1", "s2"]);
    const all = engine.run(start(scenario([two([cycles(2), blocked])], { config: slotsOnly })), 5).state;
    expect(ids(all)).toEqual(["s1"]);
  });

  it("nested groups: (blocked or 2 cycles) and 3 cycles", () => {
    const exit: Condition[] = [{ kind: "group", match: "any", of: [blocked, cycles(2)] }, cycles(3)];
    const r = engine.run(start(scenario([two(exit)], { config: slotsOnly })), 5).state;
    expect(r.flows[0].history[1]).toMatchObject({ stageId: "s2", startCycle: 2 });
  });

  it("an empty group never holds", () => {
    const r = engine.run(start(scenario([two([{ kind: "group", match: "any", of: [] }], "any")], { config: slotsOnly })), 5).state;
    expect(ids(r)).toEqual(["s1"]);
  });

  it("describes groups with brackets and stage names", () => {
    const text = describeConditions(
      [{ kind: "group", match: "any", of: [cycles(2), { kind: "stageVisits", count: 3, sinceStage: "s3" }] }, blocked],
      "all",
      (id) => `Stage ${id}`
    );
    expect(text).toBe("(2 cycles in stage or entered this stage 3+ times since Stage s3) and inventory chloronite >= 1");
  });
});

describe("validation of routes", () => {
  it("rejects a route, next or stageVisits naming a stage that does not exist", () => {
    const f = flow(
      [
        at("s1", "wheat", [{ kind: "stageVisits", count: 2, sinceStage: "gone" }], { next: "nope", routes: [{ to: "missing", when: [cycles(1)] }] }),
        at("s2", "potato"),
      ],
      true
    );
    const errors = engine.validate(scenario([f])).filter((i) => i.level === "error").map((i) => i.message);
    expect(errors.some((m) => m.includes('"missing"'))).toBe(true);
    expect(errors.some((m) => m.includes('"nope"'))).toBe(true);
    expect(errors.some((m) => m.includes('"gone"'))).toBe(true);
  });

  it("checks conditions inside groups and warns about empty ones", () => {
    const f = flow([at("s1", "wheat", [{ kind: "group", match: "any", of: [{ kind: "cycles", n: 0 }, { kind: "group", match: "all", of: [] }] }]), at("s2", "potato")]);
    const issues = engine.validate(scenario([f]));
    expect(issues.some((i) => i.level === "error" && /n >= 1/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.level === "warning" && /empty AND\/OR group/.test(i.message))).toBe(true);
  });

  it("a stage that only leaves through a route is not warned about", () => {
    const f = flow([at("s1", "wheat", [], { routes: [{ to: "s2", when: [cycles(1)] }] }), at("s2", "potato", [cycles(1)])], true);
    expect(engine.validate(scenario([f])).some((i) => /forever/.test(i.message))).toBe(false);
  });
});

describe("deleting a stage", () => {
  it("drops routes to it, resets a next to it and un-anchors stageVisits since it", () => {
    const f = flow(
      [
        at("s1", "wheat", [{ kind: "group", match: "any", of: [{ kind: "stageVisits", count: 2, sinceStage: "s3" }] }], {
          next: "s3",
          routes: [{ to: "s3", when: [cycles(1)] }, { to: "s2", when: [cycles(5)] }],
        }),
        at("s2", "potato"),
        at("s3", "carrot"),
      ],
      true
    );
    const p = deleteStage({ id: 1, flow: f }, 2);
    const s1 = p.flow.stages[0];
    expect(p.flow.stages.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(s1.next).toBeUndefined();
    expect(s1.routes).toEqual([{ to: "s2", when: [cycles(5)] }]);
    expect(s1.exit).toEqual([{ kind: "group", match: "any", of: [{ kind: "stageVisits", count: 2 }] }]);
    expect(engine.validate(scenario([p.flow])).filter((i) => i.level === "error")).toEqual([]);
  });
});
