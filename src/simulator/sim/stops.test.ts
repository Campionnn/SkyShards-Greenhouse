import { describe, expect, it } from "vitest";
import { SCRIPT_EXAMPLES } from "../script/examples";
import { engine, flow, LAYOUT_A_CODE, LAYOUT_B_CODE, layout, scenario, start, step } from "../testHelpers";
import type { Scenario, SimulationState } from "./state";
import type { StopPoint } from "./stops";

// Stepping inside a cycle: a probe only watches. Runs with a probe give byte-identical states, the
// stops come in cycle order, and the state at the last stop is the cycle's state before the clock.

const json = (v: unknown) => JSON.stringify(v);

function withScripts(plotScript: string | null, controller?: string): Scenario {
  const spec = layout([["wheat", 4, 4], ["wheat", 4, 6], ["wheat", 6, 4], ["wheat", 6, 6]], [["chloronite", 5, 5]]);
  const sc = scenario([flow([step("a", spec, [{ kind: "cycles", n: 3 }]), step("b", spec, [{ kind: "cycles", n: 2 }])], true)], { inventory: { chloronite: 5 } });
  if (plotScript !== null) sc.plots[0].script = { source: plotScript };
  if (controller) sc.script = { source: controller };
  return sc;
}

const shareCodes = scenario([LAYOUT_A_CODE, LAYOUT_B_CODE, LAYOUT_B_CODE].map((code) => flow([step("s", { code })])));

const scenarios: [string, Scenario][] = [
  ["share codes, three plots", shareCodes],
  ["normal profile", { ...shareCodes, settings: { ...shareCodes.settings, profile: "normal" } }],
  ["plot script", withScripts(`function onSession() { for (const p of plot.spawns("chloronite")) if (p.stage >= 2) p.break(); plot.water() }`)],
  ["controller and event hooks", withScripts(`let seen = 0; function onHarvest(e) { seen += 1 }`, `function afterSession() { log(cycle) }`)],
  ...SCRIPT_EXAMPLES.map((ex): [string, Scenario] => [`example: ${ex.title}`, ex.target === "plot" ? withScripts(ex.source) : withScripts(null, ex.source)]),
];

/** Run cycle by cycle with a probe that reads (and copies) the state at every stop. */
function probedRun(s: SimulationState, n: number) {
  let state = s;
  const stops: StopPoint[] = [];
  for (let i = 0; i < n; i++) {
    state = engine.run(state, 1, {
      probe: (stop, at) => {
        stops.push(stop);
        structuredClone(at.state);
      },
    }).state;
  }
  return { state, stops };
}

describe("stop points", () => {
  it.each(scenarios)("a probe changes nothing: %s", (_name, sc) => {
    const s = start(sc);
    const plain = engine.run(s, 40).state;
    const probed = probedRun(s, 40);
    expect(json(probed.state)).toBe(json(plain));
    expect(probed.stops.length).toBeGreaterThan(0);
  });

  it("replaying a cycle never changes the session's states", () => {
    let s = start(withScripts(`function onSession() { plot.water() }`));
    for (let i = 0; i < 10; i++) {
      const before = json(s);
      const { stops } = engine.replayCycle(s, () => true);
      // Every stop of the cycle: copying a state at each of them.
      for (let k = 0; k < stops.length; k++) engine.replayCycle(s, (_stop, o) => o === k);
      expect(json(s)).toBe(before);
      s = engine.run(s, 1).state;
    }
  });

  it("lists every tick phase per plot, then session phases on an active cycle, in order", () => {
    const s = start(shareCodes);
    const { stops } = engine.replayCycle(s);
    const ticks = stops.filter((x) => x.kind === "tickPhase");
    expect(ticks.map((x) => `${x.plotId}:${x.id}`).slice(0, 7)).toEqual(["destruction", "effects", "growth", "soggybud", "water", "spawn", "decay"].map((id) => `1:${id}`));
    expect(ticks).toHaveLength(21);
    const firstSession = stops.findIndex((x) => x.kind === "sessionPhase");
    expect(firstSession).toBeGreaterThan(stops.lastIndexOf(ticks[ticks.length - 1]));
    expect(stops.filter((x) => x.kind === "sessionPhase" && x.plotId === 1).map((x) => x.id)[0]).toBe("session");
  });

  it("the state at the last stop is the cycle's result, before the clock moves", () => {
    let s = start(withScripts(`function onSession() { plot.water() }`));
    for (let i = 0; i < 8; i++) {
      const next = engine.run(s, 1).state;
      const all = engine.replayCycle(s).stops;
      const last = engine.replayCycle(s, (_x, o) => o === all.length - 1).capture!;
      expect(json(last.state.plots.map((p) => p.plants.map((q) => [q.id, q.kindId, q.stage, q.water])))).toBe(
        json(next.plots.map((p) => p.plants.map((q) => [q.id, q.kindId, q.stage, q.water])))
      );
      expect(json(last.state.inventory)).toBe(json(next.inventory));
      expect(last.state.cycle).toBe(s.cycle);
      s = next;
    }
  });

  it("each player action is its own stop, and script actions are told apart", () => {
    // A script plants and breaks wheat; the built-in phases water and change steps.
    const sc = withScripts(`function onSession() { plot.place("wheat", 0, 0); plot.breakAt(0, 0); plot.place("wheat", 9, 9) }`);
    let s = start(sc);
    const seen: StopPoint[] = [];
    for (let i = 0; i < 6; i++) {
      for (const x of engine.replayCycle(s).stops) if (x.kind === "scriptAction" || x.kind === "playerAction") seen.push(x);
      s = engine.run(s, 1).state;
    }
    const ids = new Set(seen.map((x) => `${x.kind}:${x.id}`));
    expect(ids.has("playerAction:water")).toBe(true);
    expect(ids.has("playerAction:stepChange")).toBe(true);
    const first = seen.filter((x) => x.kind === "scriptAction").slice(0, 3);
    expect(first.map((x) => [x.id, x.row, x.col, x.script, x.hook])).toEqual([
      ["plant", 0, 0, "plot:1", "onSession"],
      ["break", 0, 0, "plot:1", "onSession"],
      ["plant", 9, 9, "plot:1", "onSession"],
    ]);
  });

  it("script hooks are stops, with the script that ran them", () => {
    const s = start(withScripts(`function onTick() {} function onSession() {}`, `function onCycleEnd() {}`));
    const hooks = engine.replayCycle(s).stops.filter((x) => x.kind === "scriptHook");
    expect(hooks.map((x) => `${x.script}:${x.id}`)).toEqual(["plot:1:onTick", "plot:1:onSession", "global:onCycleEnd"]);
  });

  it("a mid-cycle copy shows the script variables as they are at that stop", () => {
    const s = start(withScripts(`let n = 0; function onTick() { n = 1 } function onSession() { n = 2 }`));
    const r = engine.replayCycle(s, (x) => x.kind === "scriptHook" && x.id === "onTick");
    const scope = r.capture!.state.scripts!.scopes["plot:1"];
    expect(scope.n[1]).toBe(1);
  });
});
