// The `debug` script namespace: spawn, setStage, growUp, setDecay, give. Debugging tools only:
// refused under the leaderboard rules, both at run time and when a flow is submitted.

import { describe, expect, it } from "vitest";
import { checkSubmission, debugApiErrors, submissionFromScenario } from "../../leaderboard/rules";
import type { Scenario, SimulationState } from "../sim/state";
import { engine, flow, layout, NEVER_ACTIVE, plantAt, scenario, start, step, TIMER_ONLY } from "../testHelpers";
import { identifierUses } from "./check";
import { inspectScriptVariables } from "./inspect";
import { DEBUG_SCRIPT_APIS } from "./overrides";

/** One plot (wheat at 4,4 and a chloronite target at 5,5) with a plot script. */
function withScript(source: string, opts: { config?: Record<string, unknown>; activity?: Scenario["settings"]["activity"] } = {}): Scenario {
  const sc = scenario([flow([step("a", layout([["wheat", 4, 4]], [["chloronite", 5, 5]]))])], { config: opts.config, activity: opts.activity });
  sc.plots[0].script = { source };
  return sc;
}
const run = (sc: Scenario, cycles = 1) => engine.run(start(sc), cycles);
const vars = (s: SimulationState) => Object.fromEntries(inspectScriptVariables(s).map((v) => [v.name, v.value]));

describe("debug.spawn", () => {
  it("spawns a mutation anywhere as a natural spawn, counted and announced", () => {
    const r = run(withScript(`let seen = []; let got = null;
      function onSpawn(e) { seen.push(e.kind) }
      function onSession() { if (cycle === 0) got = debug.spawn(plot, "magic_jellybean", 0, 0)?.kind }`));
    expect(r.state.scripts?.halt).toBeNull();
    const p = plantAt(r.state, 1, 0, 0)!;
    expect(p).toMatchObject({ kindId: "magic_jellybean", origin: "spawned", stage: 1, isRival: false });
    expect(r.state.summary.spawned.magic_jellybean).toBe(1);
    expect(r.events.some((e) => e.kind === "spawned" && e.mutationId === "magic_jellybean")).toBe(true);
    expect(vars(r.state)).toMatchObject({ seen: ["magic_jellybean"], got: "magic_jellybean" });
  });

  it("takes a stage, latching full growth; a spawn on another target is a rival; a taken cell gives null", () => {
    const r = run(withScript(`let taken = 1;
      function afterSession() { if (cycle > 0) return;
        debug.spawn(plot, "chorus_fruit", 5, 5, 999);
        taken = debug.spawn(plot, "chorus_fruit", 4, 4) }`));
    expect(r.state.scripts?.halt).toBeNull();
    const p = plantAt(r.state, 1, 5, 5)!;
    expect(p.isRival).toBe(true);
    expect(p.stage).toBe(p.growthStages);
    expect(p.lockedEffects).not.toBeNull();
    expect(r.state.summary.rivals.spawned).toBe(1);
    expect(vars(r.state).taken).toBeNull();
  });

  it("works offline too (it isn't a player action)", () => {
    const r = run(withScript(`debug.spawn(plot, "gloomgourd", 2, 2)
      function onTick() { if (cycle === 0) debug.spawn(plot, "chloronite", 5, 5) }`, { activity: NEVER_ACTIVE }));
    expect(r.state.scripts?.halt).toBeNull();
    expect(plantAt(r.state, 1, 2, 2)?.kindId).toBe("gloomgourd");
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "chloronite", isRival: false });
  });

  it("refuses crops, unknown ids, bad cells and missing plots", () => {
    for (const [src, msg] of [
      [`debug.spawn(plot, "wheat", 0, 0)`, /isn't a mutation id/],
      [`debug.spawn(plot, "constructor", 0, 0)`, /can't be used/],
      [`debug.spawn(plot, "magic_jellybean", 10, 0)`, /not a cell/],
      [`debug.spawn("magic_jellybean", 0, 0)`, /needs a plot first/],
    ] as const) {
      expect(run(withScript(src)).state.scripts?.halt?.message, src).toMatch(msg);
    }
  });
});

describe("debug.setStage / growUp / setDecay / give", () => {
  it("setStage sets the stage, latching and unlatching full growth", () => {
    const r = run(withScript(`let grown = []; let stages = [];
      function onSession() { if (cycle > 0) return;
        const w = plot.at(4, 4);
        debug.setStage(w, 999); grown.push(w.fullyGrown); stages.push(w.stage);
        debug.setStage(w, 0); grown.push(w.fullyGrown); stages.push(w.stage);
        debug.growUp(w); grown.push(w.fullyGrown) }`));
    expect(r.state.scripts?.halt).toBeNull();
    const w = plantAt(r.state, 1, 4, 4)!;
    expect(vars(r.state)).toMatchObject({ grown: [true, false, true], stages: [w.growthStages, 0] });
  });

  it("setStage refuses placed items; a plant that is gone returns false", () => {
    const placed = withScript(`function onSession() { if (cycle === 0) { plot.place("fire", 0, 0); debug.setStage(plot.at(0, 0), 1) } }`);
    expect(run(placed).state.scripts?.halt?.message).toMatch(/only works on growing plants/);
    const gone = run(withScript(`let r = 1; function onSession() { if (cycle > 0) return; const w = plot.at(4, 4); w.destroy(); r = debug.setStage(w, 2) }`));
    expect(vars(gone.state).r).toBe(false);
  });

  it("setDecay makes a plant decay at the next tick, or never", () => {
    const sc = withScript(`function afterSession() { if (cycle === 0) debug.setDecay(plot.at(4, 4), 0) }`);
    // Timer-only data: wheat's minimum mutations would push the decay back by 24h.
    const r = TIMER_ONLY.run(start(sc, TIMER_ONLY), 2);
    expect(r.state.scripts?.halt).toBeNull();
    expect(r.events.some((e) => e.kind === "decayed" && e.kindId === "wheat")).toBe(true);
    const never = run(withScript(`function onSession() { if (cycle === 0) debug.setDecay(plot.at(4, 4), null) }`), 1);
    expect(plantAt(never.state, 1, 4, 4)!.decaySecondsRemaining).toBeNull();
  });

  it("give adds items as injected (not produced) and takes them away", () => {
    const r = run(withScript(`let left = 0; debug.give("chloronite", 5); left = debug.give("chloronite", -2)`));
    expect(r.state.scripts?.halt).toBeNull();
    expect(r.state.inventory.chloronite).toBe(3);
    expect(r.state.summary.injected.chloronite).toBe(3);
    expect(r.state.ledger.chloronite?.produced ?? 0).toBe(0);
    expect(vars(r.state).left).toBe(3);
    expect(run(withScript(`debug.give("nope", 1)`)).state.scripts?.halt?.message).toMatch(/isn't an item/);
    expect(run(withScript(`debug.give("chloronite", 1.5)`)).state.scripts?.halt?.message).toMatch(/whole number/);
  });

  it("nothing debug can be used in an exit condition", () => {
    const sc = withScript("");
    delete sc.plots[0].script;
    sc.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: `debug.give("wheat", 1) > 0` }] }];
    expect(run(sc).state.scripts?.halt?.message).toMatch(/can't be used in an exit condition/);
  });

  it("splitting a run doesn't change the result", () => {
    const s = start(withScript(`function onSession() { if (cycle % 4 === 0) { debug.spawn(plot, "magic_jellybean", 0, cycle % 10, 30); debug.give("wheat", 2) } }`));
    expect(JSON.stringify(engine.run(engine.run(s, 7).state, 9).state)).toBe(JSON.stringify(engine.run(s, 16).state));
  });
});

describe("debug tools and the leaderboard", () => {
  it("under the leaderboard rules every debug tool stops the script and changes nothing", () => {
    const rules = { leaderboardRules: true };
    for (const src of [
      `debug.spawn(plot, "magic_jellybean", 0, 0)`,
      `debug.setStage(plot.at(4, 4), 99)`,
      `debug.growUp(plot.at(4, 4))`,
      `debug.setDecay(plot.at(4, 4), null)`,
      `debug.give("chloronite", 5)`,
      `function onSession() { debug.give("chloronite", 5) }`,
    ]) {
      const r = run(withScript(src, { config: rules }), 2).state;
      expect(r.scripts?.halt?.kind, src).toBe("error");
      expect(r.scripts?.halt?.message, src).toMatch(/debug\.\w+\(\) is a debugging tool and isn't allowed under the leaderboard rules/);
      expect(r.inventory.chloronite ?? 0, src).toBe(0);
      expect(plantAt(r, 1, 0, 0), src).toBeUndefined();
    }
  });

  it("submitting a flow that uses debug is refused, naming the script and line", () => {
    const sc = withScript(`// test\nfunction onSession() { debug.spawn(plot, "chorus_fruit", 5, 5) }`);
    const errors = debugApiErrors(submissionFromScenario(sc));
    expect(errors).toEqual([expect.stringMatching(/^Plot 1 script, line 2: debug\.\* is a debugging tool and isn't allowed on the leaderboard/)]);
    expect(checkSubmission(submissionFromScenario(sc), engine.data).ok).toBe(false);
    // However it is reached.
    const aliased = withScript(`const d = debug; function onSession() { d.give("wheat") }`);
    expect(debugApiErrors(submissionFromScenario(aliased))).toHaveLength(1);
    const ctrl = withScript("");
    delete ctrl.plots[0].script;
    ctrl.script = { source: `function onTick() { for (const p of plots) debug.give("wheat") }` };
    expect(debugApiErrors(submissionFromScenario(ctrl))[0]).toMatch(/^Controller script, line 1/);
    const cond = withScript("");
    delete cond.plots[0].script;
    cond.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: "debug !== null" }] }];
    expect(debugApiErrors(submissionFromScenario(cond))[0]).toMatch(/exit condition/);
  });

  it("a script's own `debug` variable or a `.debug` property isn't the built-in", () => {
    expect(identifierUses(`const debug = true; if (debug) log(1)`, DEBUG_SCRIPT_APIS)).toEqual([]);
    expect(identifierUses(`function f(debug) { return debug } let o = { debug: 1 }; log(o.debug)`, DEBUG_SCRIPT_APIS)).toEqual([]);
    expect(identifierUses(`debug.give("wheat")`, DEBUG_SCRIPT_APIS)).toHaveLength(1);
    // A declared variable runs fine under the rules: it shadows the built-in in its own scope.
    const own = withScript(`let debugMode = false; function onTick() { const debug = 1; log(debug) }`, { config: { leaderboardRules: true } });
    expect(run(own).state.scripts?.halt).toBeNull();
    expect(checkSubmission(submissionFromScenario(own), engine.data).errors.filter((e) => /debugging tool/.test(e))).toEqual([]);
  });
});
