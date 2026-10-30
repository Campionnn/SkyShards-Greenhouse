import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioPlot } from "../../../simulator";
import { engine, flow, LAYOUT_A_CODE, LAYOUT_B_CODE, scenario, step } from "../../../simulator/testHelpers";
import { autoLayout, withLayout } from "./autoLayout";
import { cleanStepUi, engineKey, exitTarget, explicitExits, hasFinishExit, insertStep, moveStep, setLoop, withoutEditorUi, withStepUi } from "./model";

const A = { code: LAYOUT_A_CODE };
const B = { code: LAYOUT_B_CODE };

const loopPlot = (): ScenarioPlot => ({
  id: 1,
  flow: flow([step("a", A, [{ kind: "cycles", n: 3 }]), step("b", B, [{ kind: "cycles", n: 4 }]), step("c", A, [{ kind: "cycles", n: 2 }])], true),
});
const finishPlot = (): ScenarioPlot => ({
  id: 1,
  flow: flow([step("a", A, [{ kind: "cycles", n: 3 }]), step("b", B, [{ kind: "cycles", n: 4 }])], false),
});

const withPlot = (p: ScenarioPlot): Scenario => ({ ...scenario([p.flow]), plots: [p] });
/** What happened, by step id (indexes change when steps are reordered; behaviour must not). */
const fingerprint = (sc: Scenario, cycles: number) => {
  const r = engine.run(engine.initState(sc).state, cycles).state;
  const flows = r.flows.map((f) => ({ finished: f.finished, history: f.history.map(({ stepIndex: _i, ...h }) => (void _i, h)) }));
  return JSON.stringify({ flows, summary: r.summary, inv: r.inventory, plots: r.plots });
};

describe("explicit exits", () => {
  it("writes out 'the following step' and keeps the finish exit", () => {
    const p = explicitExits(finishPlot());
    expect(p.flow.steps[0].exits[0].to).toBe("b");
    expect(p.flow.steps[1].exits[0].to).toBeUndefined();
    expect(hasFinishExit(p)).toBe(true);
    expect(exitTarget(p, 1, p.flow.steps[1].exits[0])).toEqual({ kind: "finish" });
    const looped = explicitExits(loopPlot());
    expect(looped.flow.steps.map((s) => s.exits[0].to)).toEqual(["b", "c", "a"]);
    expect(hasFinishExit(looped)).toBe(false);
  });

  it("returns the same object when there is nothing to write out", () => {
    const p = explicitExits(loopPlot());
    expect(explicitExits(p)).toBe(p);
  });

  it("does not change what the engine does", () => {
    for (const p of [loopPlot(), finishPlot()]) {
      expect(fingerprint(withPlot(explicitExits(p)), 60)).toBe(fingerprint(withPlot(p), 60));
    }
  });

  it("does not change the real Rose Dragon flow's results", () => {
    const file = JSON.parse(readFileSync("public/greenhouse/flows/rose-dragon.flows.json", "utf8"));
    const base = scenario([flow([step("x", A)])]);
    const sc: Scenario = { ...base, plots: file.plots, startingInventory: { dead_plant: 500, fermento: 100 } };
    const explicit: Scenario = { ...sc, plots: sc.plots.map(explicitExits) };
    expect(fingerprint(explicit, 120)).toBe(fingerprint(sc, 120));
  });

  it("setLoop turns a finish exit into a jump to step 1, and back leaves targets alone", () => {
    const on = setLoop(finishPlot(), true);
    expect(on.flow.steps[1].exits[0].to).toBe("a");
    const off = setLoop(on, false);
    expect(off.flow.steps[1].exits[0].to).toBe("a");
    expect(off.flow.loop).toBe(false);
  });
});

describe("reordering and inserting", () => {
  it("moveStep keeps every exit target and the start step", () => {
    const p = { ...loopPlot(), flow: { ...loopPlot().flow, startIndex: 1 } };
    const moved = moveStep(p, 0, 2);
    expect(moved.flow.steps.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(moved.flow.steps.map((s) => s.exits[0].to)).toEqual(["c", "a", "b"]);
    expect(moved.flow.steps[moved.flow.startIndex].id).toBe("b");
    expect(fingerprint(withPlot(moved), 50)).toBe(fingerprint(withPlot(p), 50));
  });

  it("the final step of a flow with a finish exit stays last", () => {
    const p = finishPlot();
    expect(moveStep(p, 1, 0)).toBe(p);
    expect(moveStep(p, 0, 1)).toBe(p);
    const { plot, index } = insertStep(p, step("n", B, []));
    expect(index).toBe(1);
    expect(plot.flow.steps.map((s) => s.id)).toEqual(["a", "n", "b"]);
    expect(plot.flow.steps[0].exits[0].to).toBe("b");
  });
});

describe("editor-only data", () => {
  it("never reaches the engine", () => {
    const p = loopPlot();
    const sc = withPlot(p);
    const moved = withPlot({ ...p, flow: { ...p.flow, steps: p.flow.steps.map((s, i) => withStepUi(s, { x: i * 300, y: 0, note: "hi", frame: "Main" })) } });
    expect(engineKey(moved)).toBe(engineKey(sc));
    expect(engineKey(withPlot(explicitExits(p)))).toBe(engineKey(sc));
    const changed = { ...p, flow: { ...p.flow, steps: p.flow.steps.map((s, i) => (i ? s : { ...s, exits: [{ when: [{ kind: "cycles" as const, n: 9 }] }] })) } };
    expect(engineKey(withPlot(changed))).not.toBe(engineKey(sc));
    expect(withoutEditorUi(sc)).toBe(sc);
    expect(JSON.stringify(withoutEditorUi(moved))).not.toContain('"ui"');
  });

  it("withStepUi drops empty fields and positionless ui", () => {
    const s = step("a", A);
    expect(withStepUi(s, { x: 1, y: 2, note: "" }).ui).toEqual({ x: 1, y: 2 });
    expect("ui" in withStepUi(s, { note: "x" })).toBe(false);
  });

  it("cleanStepUi keeps only known, valid fields", () => {
    expect(cleanStepUi({ x: 1.4, y: 2.6, note: "n", frame: "F", frameColor: "violet", evil: 1 })).toEqual({ x: 1, y: 3, note: "n", frame: "F", frameColor: "violet" });
    expect(cleanStepUi({ x: "1", y: 2 })).toBeUndefined();
    expect(cleanStepUi({ x: 1, y: 2, frameColor: "chartreuse" })).toEqual({ x: 1, y: 2 });
  });
});

describe("auto layout", () => {
  it("lays a loop out left to right and keeps saved positions", () => {
    const pos = autoLayout(loopPlot());
    expect(pos[0].x).toBeLessThan(pos[1].x);
    expect(pos[1].x).toBeLessThan(pos[2].x);
    // Four or more steps wrap into two reading-order rows.
    const four: ScenarioPlot = { id: 1, flow: flow(["a", "b", "c", "d"].map((id) => step(id, A, [{ kind: "cycles", n: 2 }])), true) };
    const p4 = autoLayout(four);
    expect(p4[0].y).toBe(p4[1].y);
    expect(p4[2].y).toBeGreaterThan(p4[0].y);
    expect(p4[2].x).toBe(p4[0].x);
    const p = loopPlot();
    p.flow.steps[1] = withStepUi(p.flow.steps[1], { x: 5000, y: 7 });
    const kept = autoLayout(p);
    expect(kept[1]).toEqual({ x: 5000, y: 7 });
    // Step c follows b, so it goes right of b.
    expect(kept[2].x).toBeGreaterThan(5000);
    expect(withLayout(p).flow.steps.every((s) => typeof s.ui?.x === "number")).toBe(true);
  });

  it("puts steps that no exit reaches below the graph", () => {
    const p: ScenarioPlot = { id: 1, flow: flow([step("hub", A), step("x", B), step("y", B)], false) };
    p.flow.steps[0] = { ...p.flow.steps[0], exits: [{ to: "hub", when: [{ kind: "cycles", n: 1 }] }] };
    const pos = autoLayout(p);
    expect(pos[1].y).toBeGreaterThan(pos[0].y);
    expect(pos[2].y).toBe(pos[1].y);
    expect(pos[2].x).toBeGreaterThan(pos[1].x);
  });

  it("packs many script-entered steps into rows of at most 6", () => {
    const steps = Array.from({ length: 19 }, (_, i) => step(`s${i}`, B));
    const p: ScenarioPlot = { id: 1, flow: flow(steps, false) };
    p.flow.steps[0] = { ...p.flow.steps[0], exits: [] };
    const pos = autoLayout(p);
    const rows = new Set(pos.slice(1).map((q) => q.y));
    expect(rows.size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...[...rows].map((y) => pos.filter((q) => q.y === y).length))).toBeLessThanOrEqual(6);
  });
});
