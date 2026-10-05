import { describe, expect, it } from "vitest";
import { engine, flow, layout, scenario, step, start } from "../testHelpers";
import type { Condition, FlowStep, StepExit } from "./types";
import { describeConditions } from "./triggers";
import { deleteStep } from "../../components/simulator/scenarioEdit";

// Choosing which step to go to: a step's ordered `exits` ("go to X when ..."),
// AND / OR condition groups and the stepVisits condition.

const ids = (s: ReturnType<typeof start>, plotId = 1) => s.flows.find((f) => f.plotId === plotId)!.history.map((h) => h.stepId);
const at = (id: string, crop: string, exit: Condition[] = [], extra: Partial<FlowStep> = {}) => step(id, layout([[crop, 0, 0]]), exit, extra);
const cycles = (n: number): Condition => ({ kind: "cycles", n });
const go = (to: string | undefined, ...when: Condition[]): StepExit => (to === undefined ? { when } : { to, when });

describe("choosing the next step", () => {
  it("an exit with a target sends the plot there instead of the following step", () => {
    // 1 -> 2 -> 1 -> 2 ... ; step 3 is never reached.
    const f = flow([at("s1", "wheat", [cycles(1)]), at("s2", "potato", [], { exits: [go("s1", cycles(1))] }), at("s3", "carrot")], false);
    const r = engine.run(start(scenario([f], {})), 6);
    expect(ids(r.state)).toEqual(["s1", "s2", "s1", "s2", "s1", "s2", "s1"]);
  });

  it("an earlier exit wins over a later one once its conditions hold", () => {
    const toS3 = go("s3", { kind: "inventoryAtLeast", item: "chloronite", qty: 1 });
    const f = flow([at("s1", "wheat", [cycles(1)], { exits: [toS3] }), at("s2", "potato"), at("s3", "carrot")], false);
    expect(ids(engine.run(start(scenario([f], {})), 3).state)).toEqual(["s1", "s2"]);
    expect(ids(engine.run(start(scenario([f], { inventory: { chloronite: 1 } })), 3).state)).toEqual(["s1", "s3"]);
  });

  it("exits are checked in order; the first that holds wins", () => {
    const f = flow([at("s1", "wheat", [], { exits: [go("s3", cycles(1)), go("s2", cycles(1))] }), at("s2", "potato"), at("s3", "carrot")], false);
    expect(ids(engine.run(start(scenario([f], {})), 2).state)).toEqual(["s1", "s3"]);
  });

  it("swaps between 1 and 2, and goes to 3 every 3rd time through step 2", () => {
    const f = flow(
      [
        at("s1", "wheat", [cycles(1)]),
        at("s2", "potato", [], { exits: [go("s3", { kind: "stepVisits", count: 3, sinceStep: "s3" }), go("s1", cycles(1))] }),
        at("s3", "carrot", [], { exits: [go("s1", cycles(1))] }),
      ],
      false
    );
    const r = engine.run(start(scenario([f], {})), 14);
    expect(ids(r.state)).toEqual(["s1", "s2", "s1", "s2", "s1", "s2", "s3", "s1", "s2", "s1", "s2", "s1", "s2", "s3", "s1"]);
  });

  it("a non-looping plot holding its final step can still leave through a later exit", () => {
    const back = go("s1", { kind: "inventoryAtLeast", item: "wheat", qty: 1 });
    const f = flow([at("s1", "wheat", [cycles(1)]), at("s2", "potato", [], { exits: [go(undefined, cycles(1)), back] })], false);
    const s = start(scenario([f], {}));
    const held = engine.run(s, 4).state;
    expect(held.flows[0].finished).toBe(true);
    expect(ids(held)).toEqual(["s1", "s2"]);
    const fed = engine.addItems(held, { wheat: 1 });
    const moved = engine.run(fed, 1).state;
    expect(ids(moved)).toEqual(["s1", "s2", "s1"]);
    expect(moved.flows[0].finished).toBe(false);
  });

  it("an exit that becomes due while the player is away keeps its target for the next session", () => {
    const f = flow([at("s1", "wheat", [], { exits: [go("s3", cycles(1))] }), at("s2", "potato"), at("s3", "carrot")], false);
    const r = engine.run(start(scenario([f], { activity: { kind: "everyN", n: 4, offset: 3 } })), 2);
    expect(r.state.flows[0]).toMatchObject({ pendingTransition: true, pendingTarget: 2 });
    const later = engine.run(r.state, 2).state;
    expect(ids(later)).toEqual(["s1", "s3"]);
    expect(later.flows[0].pendingTarget).toBeUndefined();
  });

  it("a step can exit to itself: the layout is re-applied and its counters restart", () => {
    const f = flow([at("s1", "wheat", [], { exits: [go("s1", cycles(2))] })], false);
    const r = engine.run(start(scenario([f], {})), 5);
    expect(ids(r.state)).toEqual(["s1", "s1", "s1"]);
    expect(r.state.flows[0].cyclesInStep).toBe(1);
  });

  it("exits keep runs deterministic and splittable", () => {
    const f = flow(
      [
        at("s1", "wheat", [cycles(2)]),
        at("s2", "potato", [], { exits: [go("s3", { kind: "stepVisits", count: 2, sinceStep: "s3" }), go("s1", cycles(1))] }),
        at("s3", "carrot", [cycles(1)]),
      ],
      true
    );
    const s = start(scenario([f], { activity: { kind: "everyN", n: 3, offset: 1 } }));
    const whole = engine.run(s, 40).state;
    const split = engine.run(engine.run(s, 17).state, 23).state;
    expect(JSON.stringify(split)).toBe(JSON.stringify(whole));
  });
});

describe("an exit checked before its step is built (checkOnEntry)", () => {
  const rich = { kind: "inventoryAtLeast", item: "chloronite", qty: 1 } as const;
  const early = (e: StepExit): StepExit => ({ ...e, checkOnEntry: true });
  const steps = (flag: boolean) =>
    flow([at("s1", "wheat", [cycles(1)]), at("s2", "potato", [], { exits: [flag ? early(go(undefined, rich)) : go(undefined, rich)] }), at("s3", "carrot")], false);
  const kinds = (s: ReturnType<typeof start>) => s.plots[0].plants.map((p) => p.kindId);

  it("off: the next step is built for a cycle even though its exit already holds", () => {
    const r = engine.run(start(scenario([steps(false)], { inventory: { chloronite: 1 } })), 2);
    expect(ids(r.state)).toEqual(["s1", "s2", "s3"]);
    expect(r.state.flows[0].history[1]).toMatchObject({ startCycle: 0, endCycle: 1 });
  });

  it("on: goes straight through to the step after, without building it", () => {
    const r = engine.run(start(scenario([steps(true)], { inventory: { chloronite: 1 } })), 2);
    expect(ids(r.state)).toEqual(["s1", "s2", "s3"]);
    const [, skipped, s3] = r.state.flows[0].history;
    expect(skipped).toMatchObject({ stepId: "s2", startCycle: 0, endCycle: 0, skipped: true });
    expect(s3).toMatchObject({ stepId: "s3", startCycle: 0 });
    expect(r.events.filter((e) => e.kind === "placed").map((e) => (e as { kindId: string }).kindId)).not.toContain("potato");
    const change = r.events.find((e) => e.kind === "stepChanged");
    expect(change).toMatchObject({ fromStep: "s1", toStep: "s3", skipped: ["s2"] });
    expect(kinds(r.state)).toEqual(["carrot"]);
  });

  it("on, exits not met yet: the step is built as usual", () => {
    const r = engine.run(start(scenario([steps(true)], {})), 3);
    expect(ids(r.state)).toEqual(["s1", "s2"]);
    expect(r.state.flows[0].history[1].skipped).toBeUndefined();
    expect(kinds(r.state)).toEqual(["potato"]);
  });

  it("checks with fresh counters, so a cycles exit never skips", () => {
    const f = flow([at("s1", "wheat", [cycles(1)]), at("s2", "potato", [], { exits: [early(go(undefined, cycles(1)))] }), at("s3", "carrot")], false);
    expect(ids(engine.run(start(scenario([f], {})), 1).state)).toEqual(["s1", "s2"]);
  });

  it("only flagged exits are checked on arrival; unflagged ones wait for the step's first session", () => {
    // s2: unflagged exit to s1 (holds) above a flagged exit to s3 (holds): on arrival only the flagged one counts.
    const f = flow([at("s1", "wheat", [cycles(1)]), at("s2", "potato", [], { exits: [go("s1", rich), early(go("s3", rich))] }), at("s3", "carrot")], false);
    const r = engine.run(start(scenario([f], { inventory: { chloronite: 1 } })), 1);
    expect(ids(r.state)).toEqual(["s1", "s2", "s3"]);
    expect(r.state.flows[0].history[1].skipped).toBe(true);
    // An unflagged-only step is built and left normally.
    const g = flow([at("s1", "wheat", [cycles(1)]), at("s2", "potato", [], { exits: [go("s3", rich)] }), at("s3", "carrot")], false);
    expect(engine.run(start(scenario([g], { inventory: { chloronite: 1 } })), 1).state.flows[0].history[1].skipped).toBeUndefined();
  });

  it("chains through several steps and stops on a loop", () => {
    const f = flow(
      [
        at("s1", "wheat", [cycles(1)]),
        at("s2", "potato", [], { exits: [early(go("s3", rich))] }),
        at("s3", "carrot", [], { exits: [early(go("s2", rich))] }),
      ],
      false
    );
    const r = engine.run(start(scenario([f], { inventory: { chloronite: 1 } })), 1);
    // s2 -> s3 -> s2 again: s2 was already passed through this change, so it is built.
    expect(ids(r.state)).toEqual(["s1", "s2", "s3", "s2"]);
    expect(r.state.flows[0].history.map((h) => !!h.skipped)).toEqual([false, true, true, false]);
  });

  it("stays deterministic and splittable", () => {
    const s = start(scenario([{ ...steps(true), loop: true }], { inventory: { chloronite: 1 }, activity: { kind: "everyN", n: 3, offset: 1 } }));
    const whole = engine.run(s, 30).state;
    const split = engine.run(engine.run(s, 13).state, 17).state;
    expect(JSON.stringify(split)).toBe(JSON.stringify(whole));
  });
});

describe("AND / OR conditions", () => {
  const two = (when: Condition[], match?: "all" | "any") =>
    flow([at("s1", "wheat", [], { exits: [{ when, ...(match ? { match } : {}) }] }), at("s2", "potato")], false);
  const blocked: Condition = { kind: "inventoryAtLeast", item: "chloronite", qty: 1 };

  it("match any leaves when one condition holds; all waits for every one", () => {
    const any = engine.run(start(scenario([two([cycles(2), blocked], "any")], {})), 5).state;
    expect(ids(any)).toEqual(["s1", "s2"]);
    const all = engine.run(start(scenario([two([cycles(2), blocked])], {})), 5).state;
    expect(ids(all)).toEqual(["s1"]);
  });

  it("nested groups: (blocked or 2 cycles) and 3 cycles", () => {
    const when: Condition[] = [{ kind: "group", match: "any", of: [blocked, cycles(2)] }, cycles(3)];
    const r = engine.run(start(scenario([two(when)], {})), 5).state;
    expect(r.flows[0].history[1]).toMatchObject({ stepId: "s2", startCycle: 2 });
  });

  it("an empty group never holds", () => {
    const r = engine.run(start(scenario([two([{ kind: "group", match: "any", of: [] }], "any")], {})), 5).state;
    expect(ids(r)).toEqual(["s1"]);
  });

  it("describes groups with brackets and step names", () => {
    const text = describeConditions(
      [{ kind: "group", match: "any", of: [cycles(2), { kind: "stepVisits", count: 3, sinceStep: "s3" }] }, blocked],
      "all",
      (id) => `Step ${id}`
    );
    expect(text).toBe("(2 cycles in step or entered this step 3+ times since Step s3) and inventory chloronite >= 1");
  });
});

describe("validation of exits", () => {
  it("rejects an exit or stepVisits naming a step that does not exist", () => {
    const f = flow([at("s1", "wheat", [{ kind: "stepVisits", count: 2, sinceStep: "gone" }], { exits: [go("missing", cycles(1))] }), at("s2", "potato")], true);
    const errors = engine.validate(scenario([f])).filter((i) => i.level === "error").map((i) => i.message);
    expect(errors.some((m) => m.includes('"missing"'))).toBe(true);
    expect(errors.some((m) => m.includes('"gone"'))).toBe(true);
  });

  it("checks conditions inside groups and warns about empty ones", () => {
    const f = flow([at("s1", "wheat", [{ kind: "group", match: "any", of: [{ kind: "cycles", n: 0 }, { kind: "group", match: "all", of: [] }] }]), at("s2", "potato")]);
    const issues = engine.validate(scenario([f]));
    expect(issues.some((i) => i.level === "error" && /cycles must be at least 1/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.level === "warning" && /empty AND\/OR group/.test(i.message))).toBe(true);
  });

  it("warns about a step with no exits, and about an exit without conditions", () => {
    const f = flow([at("s1", "wheat"), at("s2", "potato", [], { exits: [go("s1")] })], true);
    const warnings = engine.validate(scenario([f])).filter((i) => i.level === "warning");
    expect(warnings.some((i) => /no way out/.test(i.message) && /Step 1/.test(i.path))).toBe(true);
    expect(warnings.some((i) => /never be taken/.test(i.message) && /Step 2/.test(i.path))).toBe(true);
  });

  it("a step whose only exit jumps to another step is not warned about", () => {
    const f = flow([at("s1", "wheat", [], { exits: [go("s2", cycles(1))] }), at("s2", "potato", [cycles(1)])], true);
    expect(engine.validate(scenario([f])).some((i) => /forever/.test(i.message))).toBe(false);
  });
});

describe("deleting a step", () => {
  it("drops exits to it and un-anchors stepVisits since it", () => {
    const f = flow(
      [
        at("s1", "wheat", [{ kind: "group", match: "any", of: [{ kind: "stepVisits", count: 2, sinceStep: "s3" }] }], {
          exits: [go("s3", cycles(1)), go("s2", cycles(5))],
        }),
        at("s2", "potato"),
        at("s3", "carrot"),
      ],
      true
    );
    const p = deleteStep({ id: 1, flow: f }, 2);
    expect(p.flow.steps.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(p.flow.steps[0].exits).toEqual([go("s2", cycles(5)), { when: [{ kind: "group", match: "any", of: [{ kind: "stepVisits", count: 2 }] }] }]);
    expect(engine.validate(scenario([p.flow])).filter((i) => i.level === "error")).toEqual([]);
  });

  it("a step whose only exits led to it keeps them, going to the following step instead", () => {
    const f = flow([at("s1", "wheat", [], { exits: [go("s3", cycles(4))] }), at("s2", "potato"), at("s3", "carrot")], true);
    const p = deleteStep({ id: 1, flow: f }, 2);
    expect(p.flow.steps[0].exits).toEqual([{ when: [cycles(4)] }]);
  });
});
