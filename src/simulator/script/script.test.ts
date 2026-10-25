import { describe, expect, it } from "vitest";
import { validateScenario } from "../flow/validate";
import type { Scenario, SimulationState } from "../sim/state";
import { engine, flow, inject, layout, NEVER_ACTIVE, plantAt, scenario, start, step } from "../testHelpers";
import { derivedSeed, seedRng } from "../rng";
import { diagnoseScript, identifierUses } from "./check";
import { SCRIPT_EXAMPLES } from "./examples";
import { inspectScriptVariables } from "./inspect";

const json = (v: unknown) => JSON.stringify(v);

/** One plot with wheat around a chloronite target, plus scripts. */
function withScripts(plotScript: string | null, opts: { controller?: string; plots?: number; activity?: Scenario["settings"]["activity"]; inventory?: Record<string, number> } = {}): Scenario {
  const spec = layout([["wheat", 4, 4], ["wheat", 4, 6], ["wheat", 6, 4], ["wheat", 6, 6]], [["chloronite", 5, 5]]);
  const sc = scenario(
    Array.from({ length: opts.plots ?? 1 }, () => flow([step("a", spec), step("b", spec)], true)),
    { activity: opts.activity, inventory: opts.inventory }
  );
  if (plotScript !== null) sc.plots[0].script = { source: plotScript };
  if (opts.controller) sc.script = { source: opts.controller };
  return sc;
}

const vars = (s: SimulationState) => Object.fromEntries(inspectScriptVariables(s).map((v) => [`${v.script}.${v.name}`, v.value]));

describe("scripts: no scripts, no change", () => {
  it("a scenario without scripts has no script state", () => {
    const s = start(withScripts(null));
    expect(s.scripts).toBeUndefined();
    expect(engine.run(s, 5).state.scripts).toBeUndefined();
  });

  it("an empty or disabled script changes nothing in the results", () => {
    const plain = engine.run(start(withScripts(null)), 60).state;
    const disabled = withScripts("let x = 1; function onSession() { plot.breakAll('wheat') }");
    disabled.plots[0].script!.enabled = false;
    const off = engine.run(start(disabled), 60).state;
    expect(off.scripts).toBeUndefined();
    expect(json(off.plots)).toBe(json(plain.plots));
    // A script that only reads: same plots, summary and RNG.
    const reader = engine.run(start(withScripts("let n = 0; function onTick() { n += plot.plants.length }")), 60).state;
    expect(json(reader.plots)).toBe(json(plain.plots));
    expect(json(reader.summary)).toBe(json(plain.summary));
    expect(reader.rng).toEqual(plain.rng);
  });
});

describe("scripts: variables and determinism", () => {
  const src = `
    let n = 0;
    let seen = [];
    const cfg = { every: 3 };
    function count() { return n }
    let fnRef = count;
    function onTick() {
      n++;
      if (n % cfg.every === 0) seen.push(randomInt(1, 100));
      shared.last = cycle;
    }`;

  it("top-level variables persist between cycles and across run() calls", () => {
    const s = start(withScripts(src));
    const r = engine.run(s, 10).state;
    const v = vars(r);
    expect(v["plot:1.n"]).toBe(10);
    expect((v["plot:1.seen"] as number[]).length).toBe(3);
    expect(v["shared.last"]).toBe(9);
    expect(v["plot:1.fnRef"]).toMatch(/function/);
  });

  it("run is splittable and deterministic with scripts", () => {
    const s = start(withScripts(src));
    const whole = engine.run(s, 40).state;
    const split = engine.run(engine.run(s, 17).state, 23).state;
    let step1 = s;
    for (let i = 0; i < 40; i++) step1 = engine.run(step1, 1).state;
    expect(json(split)).toBe(json(whole));
    expect(json(step1)).toBe(json(whole));
    expect(json(engine.run(s, 40).state)).toBe(json(whole));
  });

  it("random() uses its own stream and leaves the game's dice alone", () => {
    const a = engine.run(start(withScripts("function onTick() { random(); random() }")), 30).state;
    const b = engine.run(start(withScripts("function onTick() {}")), 30).state;
    expect(a.rng).toEqual(b.rng);
    expect(json(a.plots)).toBe(json(b.plots));
  });

  it("the script stream is seeded one way from the seed: it is neither the game's stream nor the old seed ^ constant", () => {
    const seed = 123456789;
    const s = start({ ...withScripts("function onTick() {}"), settings: { ...withScripts(null).settings, seed } });
    expect(s.scripts!.rng).toEqual(seedRng(derivedSeed(seed, "script")));
    expect(s.scripts!.rng).not.toEqual(seedRng(seed));
    expect(s.scripts!.rng).not.toEqual(seedRng((seed ^ 0x5c41b7) >>> 0));
    // Neighbouring seeds give unrelated streams (no simple offset to undo).
    expect(derivedSeed(seed + 1, "script") - derivedSeed(seed, "script")).not.toBe(1);
    expect(derivedSeed(seed, "script")).toBe(derivedSeed(seed, "script"));
  });

  it("under the leaderboard rules the script's config copy hides the credit settings", () => {
    const sc = withScripts("let seen = []; let debt = 1; let listed = []; function onTick() { debt = config.allowMutationDebt; seen = [config.bootstrapDebt, config.setupFromStock, config.leaderboardRules, config.waterLossMin]; listed = keys(config).filter((k) => k.includes('Debt') || k === 'leaderboardRules') }");
    sc.settings.config = { ...sc.settings.config, allowMutationDebt: true, bootstrapDebt: true, leaderboardRules: true };
    const r = engine.run(start(sc), 2).state;
    expect(r.scripts?.halt).toBeNull();
    const v = vars(r);
    expect(v["plot:1.debt"]).toBeUndefined();
    expect(v["plot:1.seen"]).toEqual([undefined, undefined, undefined, sc.settings.config.waterLossMin]);
    expect(v["plot:1.listed"]).toEqual([]);
    // Outside the rules the simulator shows the whole config.
    const free = withScripts("let debt = 0; function onTick() { debt = config.allowMutationDebt }");
    free.settings.config = { ...free.settings.config, allowMutationDebt: true };
    expect(vars(engine.run(start(free), 1).state)["plot:1.debt"]).toBe(true);
  });

  it("shared references and cycles survive saving", () => {
    const s = start(withScripts("let a = { list: [] }; let b = a; a.self = a; function onTick() { b.list.push(cycle) }"));
    const r = engine.run(engine.run(s, 3).state, 2).state;
    const v = vars(r);
    expect(v["plot:1.a"]).toEqual(v["plot:1.b"]);
    expect((v["plot:1.a"] as { list: number[] }).list).toEqual([0, 1, 2, 3, 4]);
  });

  it("plant handles kept in variables still refer to the same plant", () => {
    const s = start(withScripts(`
      let first = null;
      let same = false;
      function onTick() {
        const p = plot.at(4, 4);
        if (first === null) first = p;
        else same = first === p && first.kind === "wheat";
      }`));
    const r = engine.run(engine.run(s, 1).state, 1).state;
    expect(vars(r)["plot:1.same"]).toBe(true);
  });
});

describe("scripts: actions", () => {
  it("breaks a mutation at a stage (the motivating example)", () => {
    const s = start(withScripts(`function onSession() { for (const p of plot.spawns("chloronite")) if (p.stage >= 4) p.break() }`));
    inject(s, 1, "chloronite", 5, 5, "spawned", { stage: 3 });
    const r = engine.run(s, 1);
    expect(plantAt(r.state, 1, 5, 5)).toBeUndefined();
    expect(r.events.some((e) => e.kind === "destroyed" && e.kindId === "chloronite")).toBe(true);
  });

  describe("effects follow the player's actions within a session", () => {
    // An All-in Aloe past its harvest mark; the script changes its neighbours, then breaks it.
    const aloeHarvest = (source: string, setup?: (s: SimulationState) => void) => {
      for (let seed = 1; seed < 60; seed++) {
        const sc = scenario([flow([step("a", layout())])], { seed });
        sc.plots[0].script = { source };
        const s = start(sc);
        inject(s, 1, "all_in_aloe", 5, 5, "spawned", { stage: 14 });
        setup?.(s);
        const r = engine.run(s, 1);
        if (r.events.some((e) => e.kind === "reset")) continue;
        const h = r.events.find((e) => e.kind === "harvested" && e.kindId === "all_in_aloe");
        if (h?.kind === "harvested") return { drops: h.drops, state: r.state };
      }
      throw new Error("no seed without a reset");
    };

    it("a crop placed and broken before the aloe still buffs it", () => {
      const plain = aloeHarvest(`function onSession() { plot.at(5, 5).break() }`);
      const buffed = aloeHarvest(`function onSession() { plot.place("nether_wart", 5, 6); plot.at(5, 5).break(); plot.breakAt(5, 6) }`);
      expect(buffed.drops.wheat).toBeGreaterThan(plain.drops.wheat);
    });

    it("watering a dried-out neighbour lets its effects reach the aloe at once", () => {
      const dryWart = (s: SimulationState) => void inject(s, 1, "nether_wart", 5, 6, "planted", { water: -1000 });
      const dry = aloeHarvest(`plot.disable("water"); function onSession() { plot.at(5, 5).break() }`, dryWart);
      const watered = aloeHarvest(`plot.disable("water"); function onSession() { plot.at(5, 6).waterIt(); plot.at(5, 5).break() }`, dryWart);
      expect(watered.drops.wheat).toBeGreaterThan(dry.drops.wheat);
    });

    it("a Blastberry placed, used for the aloe harvest and broken before a tick is picked back up", () => {
      const plain = aloeHarvest(`function onSession() { plot.at(5, 5).break() }`);
      const src = `let could = null;
        function onSession() { plot.place("blastberry", 5, 6); plot.at(5, 5).break(); could = plot.at(5, 6).canPickUp; plot.breakAt(5, 6) }`;
      const buffed = aloeHarvest(src, (s) => void (s.inventory.blastberry = 1));
      expect(buffed.drops.wheat).toBeGreaterThan(plain.drops.wheat); // improved harvest boost reached it
      expect(vars(buffed.state)["plot:1.could"]).toBe(true);
      expect(plantAt(buffed.state, 1, 5, 6)).toBeUndefined();
      expect(buffed.state.inventory.blastberry).toBe(1); // item back
      expect(buffed.state.summary.destroyed.blastberry).toBeUndefined();
      expect(buffed.state.summary.placedItems.blastberry).toBeUndefined();
      expect(buffed.state.ledger.blastberry.consumed).toBe(0);
    });

    it("plant.effects reads the plot as the player left it", () => {
      const r = aloeHarvest(`let before = null; let after = null; function onSession() { const a = plot.at(5, 5); before = a.effects; plot.place("nether_wart", 5, 6); after = a.effects; a.break() }`);
      const v = vars(r.state);
      expect(v["plot:1.before"]).not.toContain("improved_harvest_boost");
      expect(v["plot:1.after"]).toContain("improved_harvest_boost");
    });
  });

  it("plants expose their properties, effects and a plain snapshot", () => {
    const s = start(withScripts(`
      let snap = null; let active = null; let gives = null; let cellFx = null; let byId = null; let cells = null; let ground = null; let has = null; let json = null;
      function onTick() {
        const w = plot.at(4, 4);
        snap = w.snapshot();
        gives = plot.at(4, 6).gives;
        active = w.activeEffects;
        has = w.hasEffect("harvest_boost");
        cellFx = plot.effectsAt(5, 5);
        byId = plot.plant(w.id) === w;
        cells = w.cells;
        ground = w.ground;
        json = JSON.stringify(snap);
      }`));
    const v = vars(engine.run(s, 1).state);
    const snap = v["plot:1.snap"] as Record<string, unknown>;
    expect(snap).toMatchObject({ plot: 1, kind: "wheat", row: 4, col: 4, size: 1, origin: "planted" });
    expect(typeof snap.water).toBe("number");
    expect(Array.isArray(snap.effects)).toBe(true);
    expect(v["plot:1.byId"]).toBe(true);
    expect(v["plot:1.cells"]).toEqual([[4, 4]]);
    expect(typeof v["plot:1.ground"]).toBe("string");
    expect(Array.isArray(v["plot:1.gives"])).toBe(true);
    expect(Array.isArray(v["plot:1.cellFx"])).toBe(true);
    expect(typeof v["plot:1.has"]).toBe("boolean");
    expect(JSON.parse(v["plot:1.json"] as string).kind).toBe("wheat");
  });

  it("activeEffects applies improved/immunity rules and effectsAt sees empty target cells", () => {
    const sc = scenario([flow([step("a", layout([["nether_wart", 5, 6]]))])]);
    sc.plots[0].script = { source: `let fx = null; let cell = null; function onTick() { const a = plot.at(5, 5); fx = [a.effects, a.activeEffects]; cell = plot.effectsAt(4, 6) }` };
    const s = start(sc);
    inject(s, 1, "all_in_aloe", 5, 5, "spawned", { stage: 2 });
    const v = vars(engine.run(s, 1).state);
    const [raw, active] = v["plot:1.fx"] as string[][];
    expect(raw).toContain("improved_harvest_boost");
    expect(active).toContain("improved_harvest_boost");
    for (const e of active) expect(raw).toContain(e);
    expect(active).not.toContain("harvest_boost");
    expect((v["plot:1.cell"] as string[]).length).toBeGreaterThan(0);
  });

  it("actions do nothing while the player is offline", () => {
    const s = start(withScripts(`let r = null; function onTick() { r = plot.breakAt(4, 4) }`, { activity: NEVER_ACTIVE }));
    const out = engine.run(s, 1).state;
    expect(plantAt(out, 1, 4, 4)?.kindId).toBe("wheat");
    expect(vars(out)["plot:1.r"]).toBe(false);
  });

  it("place spends inventory; base crops and fire are free", () => {
    const s = start(withScripts(`function onStart() { plot.place("fire", 0, 0); plot.place("chloronite", 0, 2); plot.place("chloronite", 0, 4); plot.place("wheat", 9, 9) }`, { inventory: { chloronite: 1 } }));
    expect(plantAt(s, 1, 0, 0)?.kindId).toBe("fire");
    expect(plantAt(s, 1, 0, 2)?.kindId).toBe("chloronite");
    expect(plantAt(s, 1, 0, 4)).toBeUndefined(); // out of stock
    expect(plantAt(s, 1, 9, 9)?.origin).toBe("planted");
    expect(s.inventory.chloronite).toBe(0);
  });

  describe("picking a placed mutation back up", () => {
    const EVERY = { kind: "everyN", n: 1, offset: 0 } as const;

    it("after a tick it is no longer free: breaking a placed item loses it", () => {
      const src = `function onSession() { if (cycle === 0) plot.place("chloronite", 0, 0); if (cycle === 1) plot.breakAt(0, 0) }`;
      const r = engine.run(start(withScripts(src, { activity: EVERY, inventory: { chloronite: 1 } })), 2);
      expect(r.state.inventory.chloronite).toBe(0);
      expect(r.summary.destroyed.chloronite).toBe(1);
    });

    it("a placed Blastberry picked up before the tick never primes or explodes; after the tick it does", () => {
      const at = (when: number) => `function onSession() { if (cycle === 0) plot.place("blastberry", 4, 5); if (cycle === ${when}) plot.breakAt(4, 5) }`;
      const quick = engine.run(start(withScripts(at(0), { activity: EVERY, inventory: { blastberry: 1 } })), 1);
      expect(quick.events.some((e) => e.kind === "exploded")).toBe(false);
      expect(plantAt(quick.state, 1, 4, 4)?.kindId).toBe("wheat");
      expect(quick.state.inventory.blastberry).toBe(1);
      const late = engine.run(start(withScripts(at(1), { activity: EVERY, inventory: { blastberry: 1 } })), 2);
      expect(late.events.some((e) => e.kind === "exploded")).toBe(true);
      expect(late.state.inventory.blastberry).toBe(0);
    });

    it("works for an early Magic Jellybean harvest too: buffed drops, Blastberry back", () => {
      const jelly = (source: string) => {
        const sc = scenario([flow([step("a", layout())])], { inventory: { blastberry: 1 } });
        sc.plots[0].script = { source };
        const s = start(sc);
        inject(s, 1, "magic_jellybean", 5, 5, "spawned", { stage: 59, water: 100 });
        const r = engine.run(s, 1);
        const h = r.events.find((e) => e.kind === "harvested" && e.kindId === "magic_jellybean");
        return { drops: h?.kind === "harvested" ? h.drops : {}, state: r.state };
      };
      const plain = jelly(`function onSession() { plot.at(5, 5).harvest() }`);
      const buffed = jelly(`function onSession() { plot.place("blastberry", 5, 6); plot.at(5, 5).harvest(); plot.breakAt(5, 6) }`);
      expect(buffed.drops.sugar_cane).toBeGreaterThan(plain.drops.sugar_cane);
      expect(buffed.state.inventory.blastberry).toBe(1);
    });

    it("canPickUp is false for the starting layout and for free items", () => {
      const s = start(withScripts(`let a = null; let f = null; function onStart() { plot.place("fire", 0, 0) } function onTick() { f = plot.at(0, 0).canPickUp; a = plot.at(4, 4).canPickUp }`));
      const v = vars(engine.run(s, 1).state);
      expect(v["plot:1.f"]).toBe(false);
      expect(v["plot:1.a"]).toBe(false);
    });
  });

  it("goto changes step now; offline it waits for the session", () => {
    const online = engine.run(start(withScripts(`function onSession() { if (plot.step.number === 1) plot.goto("b") }`)), 1).state;
    expect(online.flows[0].stepIndex).toBe(1);
    const sc = withScripts(`function onTick() { if (plot.step.number === 1) plot.goto(2) }`, { activity: { kind: "everyN", n: 3, offset: 2 } });
    const off = engine.run(start(sc), 1).state;
    expect(off.flows[0].stepIndex).toBe(0);
    expect(off.flows[0].pendingTransition).toBe(true);
    expect(engine.run(off, 2).state.flows[0].stepIndex).toBe(1);
  });

  it("hold keeps the built-in exits from firing", () => {
    const sc = withScripts(`plot.hold()`);
    sc.plots[0].flow.steps[0].exits = [{ when: [{ kind: "cycles", n: 1 }] }];
    expect(engine.run(start(sc), 5).state.flows[0].stepIndex).toBe(0);
    sc.plots[0].script!.source = "";
    expect(engine.run(start(sc), 1).state.flows[0].stepIndex).toBe(1);
  });

  it("disable switches built-in phases off; runPhase runs one on demand", () => {
    const sc = withScripts(`plot.disable("harvest")`);
    const s = start(sc);
    inject(s, 1, "chloronite", 5, 5, "spawned", { stage: 10, lockedEffects: [] });
    expect(plantAt(engine.run(s, 1).state, 1, 5, 5)?.kindId).toBe("chloronite");
    const sc2 = withScripts(`plot.disable("harvest"); function afterSession() { plot.runPhase("harvest") }`);
    const s2 = start(sc2);
    inject(s2, 1, "chloronite", 5, 5, "spawned", { stage: 10, lockedEffects: [] });
    expect(plantAt(engine.run(s2, 1).state, 1, 5, 5)).toBeUndefined();
  });

  it("setPolicy overrides policies; protect keeps a plant from built-in harvest", () => {
    const s = start(withScripts(`plot.setPolicy({ spawnedHarvest: "never" })`));
    inject(s, 1, "chloronite", 5, 5, "spawned", { stage: 10, lockedEffects: [] });
    expect(plantAt(engine.run(s, 1).state, 1, 5, 5)?.kindId).toBe("chloronite");
    const s2 = start(withScripts(`function onSession() { const p = plot.at(5, 5); if (p) p.protect() }`));
    inject(s2, 1, "chloronite", 5, 5, "spawned", { stage: 10, lockedEffects: [] });
    expect(plantAt(engine.run(s2, 1).state, 1, 5, 5)?.kindId).toBe("chloronite");
  });

  it("setLayout builds another layout until the next step change", () => {
    const s = start(withScripts(`function onStart() { plot.setLayout({ plants: [{ kind: "carrot", row: 0, col: 0 }], targets: [] }) }`));
    expect(plantAt(s, 1, 0, 0)?.kindId).toBe("carrot");
    expect(plantAt(s, 1, 4, 4)).toBeUndefined();
    expect(s.scripts!.plots["1"].layout).toBeDefined();
  });

  it("the controller coordinates plots and messages are delivered", () => {
    const sc = withScripts(`function afterSession() { if (cycle === 0) send("controller", { hi: plot.id }) }`, {
      plots: 2,
      controller: `let got = []; function onMessage(m, from) { got.push([m.hi, from]); getPlot(2).goto(2) }`,
    });
    const r = engine.run(start(sc), 1).state;
    expect(vars(r)["global.got"]).toEqual([[1, 1]]);
    expect(r.flows[1].stepIndex).toBe(1);
  });

  it("event hooks see spawns and harvests", () => {
    const s = start(withScripts(`let h = []; function onHarvest(e) { h.push(e.kind) }`));
    inject(s, 1, "chloronite", 5, 5, "spawned", { stage: 10, lockedEffects: [] });
    expect(vars(engine.run(s, 1).state)["plot:1.h"]).toEqual(["chloronite"]);
  });
});

describe("scripts: errors, pause, conditions", () => {
  it("a runtime error halts the run after the cycle with the line", () => {
    const s = start(withScripts(`function onTick() {\n  if (cycle === 2) null.x\n}`));
    const r = engine.run(s, 10);
    expect(r.cyclesRun).toBe(3);
    expect(r.truncated).toBe(true);
    expect(r.state.scripts!.halt).toMatchObject({ kind: "error", line: 2, hook: "onTick", script: "plot:1" });
    // It stays stopped.
    expect(engine.run(r.state, 5).cyclesRun).toBe(0);
  });

  it("pause stops after the cycle and the next run carries on", () => {
    const s = start(withScripts(`function onCycleEnd() { if (cycle === 4) pause("look") }`));
    const r = engine.run(s, 20);
    expect(r.cyclesRun).toBe(5);
    expect(r.state.scripts!.halt).toMatchObject({ kind: "pause", message: "look" });
    const more = engine.run(r.state, 3);
    expect(more.cyclesRun).toBe(3);
    expect(more.state.scripts!.halt).toBeNull();
    // ignorePauses gives the same states as stopping and continuing.
    expect(json(engine.run(s, 8, { ignorePauses: true }).state)).toBe(json(more.state));
  });

  it("an endless loop is stopped by the step budget", () => {
    const r = engine.run(start(withScripts(`function onTick() { while (true) {} }`)), 3);
    expect(r.state.scripts!.halt?.message).toMatch(/ran too long/);
  });

  it("a script exit condition uses the plot script's variables and can't act", () => {
    const sc = withScripts(`let ready = false; function onTick() { if (cycle >= 2) ready = true }`);
    sc.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: "ready && plot.count('wheat') === 4" }] }];
    const r = engine.run(start(sc), 3).state;
    expect(r.flows[0].history.map((h) => h.startCycle)).toEqual([0, 2]);
    const bad = withScripts(null);
    bad.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: "plot.breakAt(4, 4)" }] }];
    const out = engine.run(start(bad), 1).state;
    expect(out.scripts!.halt?.message).toMatch(/exit condition/);
    expect(plantAt(out, 1, 4, 4)?.kindId).toBe("wheat");
  });

  it("a script condition sees `shared` set by the controller earlier in the cycle", () => {
    const sc = withScripts(null, { controller: "function onSession() { shared.go = cycle === 3 }" });
    sc.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: "shared.go === true" }] }];
    const r = engine.run(start(sc), 6).state;
    expect(r.flows[0].history.map((h) => [h.stepId, h.startCycle])).toEqual([["a", 0], ["b", 3]]);
  });

  it("hooks run in the documented order", () => {
    const hooks = (who: string) =>
      ["onStart", "onTick", "onSession", "afterSession", "onCycleEnd"].map((h) => `function ${h}() { shared.log.push("${who}.${h}") }`).join("\n");
    const sc = withScripts(hooks("plot"), { controller: `shared.log = [];\n${hooks("ctl")}` });
    const r = engine.run(start(sc), 1).state;
    expect(vars(r)["shared.log"]).toEqual([
      "ctl.onStart", "plot.onStart",
      "ctl.onTick", "plot.onTick",
      "ctl.onSession", "plot.onSession", "plot.afterSession", "ctl.afterSession",
      "ctl.onCycleEnd", "plot.onCycleEnd",
    ]);
  });

  it("plot.check evaluates any flow-editor condition", () => {
    const s = start(withScripts(`let a, b; function onSession() { a = plot.check({ kind: "targetsFilled", count: 0 }); b = plot.check({ kind: "group", match: "any", of: [{ kind: "cycles", n: 1 }, { kind: "allFullyGrown" }] }) }`));
    const v = vars(engine.run(s, 1).state);
    expect(v["plot:1.a"]).toBe(false);
    expect(v["plot:1.b"]).toBe(true);
  });

  it("validation reports syntax errors and misspelled hooks", () => {
    const sc = withScripts("function onSesion() {}\nlet x = ;");
    const issues = validateScenario(sc, engine.data);
    expect(issues.some((i) => i.level === "error" && /Line 2/.test(i.message))).toBe(true);
    expect(diagnoseScript("function onSesion() {}", "plot")[0].message).toMatch(/onSession/);
    expect(diagnoseScript("function onTick() { plot.water() }", "controller")[0].message).toMatch(/no `plot`/);
    expect(diagnoseScript("function onTick() { for (const plot of plots) plot.water() }", "controller")).toEqual([]);
    const cond = withScripts(null);
    cond.plots[0].flow.steps[0].exits = [{ when: [{ kind: "script", expr: "a b" }] }];
    expect(validateScenario(cond, engine.data).some((i) => i.level === "error")).toBe(true);
  });

  it("identifierUses finds a built-in however it is reached, but not property names", () => {
    const names = ["forceEffects", "unforceEffects"];
    expect(identifierUses("forceEffects('a', [])", names)).toEqual([{ name: "forceEffects", line: 1, col: 1 }]);
    expect(identifierUses("const f = forceEffects;\nfunction onTick() { f() }", names).map((u) => u.line)).toEqual([1]);
    expect(identifierUses("function onTick() { if (x) { [1].map(() => unforceEffects()) } }", names).map((u) => u.name)).toEqual(["unforceEffects"]);
    expect(identifierUses("let o = { forceEffects: 1 }; o.forceEffects; o['x']", names)).toEqual([]);
    expect(identifierUses("let x = ;", names)).toEqual([]);
  });

  it("storing a function made inside a function is reported", () => {
    const r = engine.run(start(withScripts(`let f = null; function onTick() { f = () => 1 }`)), 1);
    expect(r.state.scripts!.halt?.message).toMatch(/top level/);
  });
});

describe("scripts: bundled examples", () => {
  for (const ex of SCRIPT_EXAMPLES) {
    it(`"${ex.title}" compiles and runs`, () => {
      expect(diagnoseScript(ex.source, ex.target === "controller" ? "controller" : "plot").filter((d) => d.level === "error")).toEqual([]);
      const sc = withScripts(ex.target === "plot" ? ex.source : null, {
        plots: 2,
        controller: ex.target === "controller" ? ex.source : undefined,
        inventory: { chloronite: 30, magic_jellybean: 2 },
      });
      const r = engine.run(start(sc), 120, { ignorePauses: true });
      expect(r.state.scripts!.halt?.kind === "error" ? r.state.scripts!.halt.message : null).toBeNull();
    });
  }
});
