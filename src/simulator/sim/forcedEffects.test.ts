import { describe, expect, it } from "vitest";
import { engine, inject, layout, NEVER_ACTIVE, plantAt, singlePlot, start } from "../testHelpers";
import { normalizeForcedEffects } from "../config";
import { exportFlows, importFlows } from "../../components/simulator/scenarioEdit";
import { inspectScriptVariables } from "../script/inspect";

// Debug override (config.forcedEffects): every plant of a kind always holds the listed effects.

const FORCED = { all_in_aloe: ["immunity", "improved_harvest_boost"] };

describe("forced effects (debug)", () => {
  it("a lone All-in Aloe holds the forced effects", () => {
    const s = start(singlePlot(layout([]), { activity: NEVER_ACTIVE, config: { forcedEffects: FORCED } }));
    inject(s, 1, "all_in_aloe", 5, 5, "spawned");
    inject(s, 1, "wheat", 2, 2, "planted");
    const r = engine.run(s, 1).state;
    expect(plantAt(r, 1, 5, 5)!.held).toEqual(expect.arrayContaining(["immunity", "improved_harvest_boost"]));
    // Other kinds are untouched, and the aloe gives nothing it was forced to hold.
    expect(plantAt(r, 1, 2, 2)!.held).toEqual([]);
  });

  it("forced effects are not given to neighbours", () => {
    const s = start(singlePlot(layout([]), { activity: NEVER_ACTIVE, config: { forcedEffects: FORCED } }));
    inject(s, 1, "all_in_aloe", 5, 5, "spawned");
    inject(s, 1, "wheat", 5, 6, "planted");
    const r = engine.run(s, 1).state;
    expect(plantAt(r, 1, 5, 6)!.held).not.toContain("improved_harvest_boost");
  });

  it("off by default: no forcedEffects key, runs unchanged", () => {
    const sc = singlePlot(layout([["wheat", 4, 4]]));
    expect(sc.settings.config).not.toHaveProperty("forcedEffects");
    const a = engine.run(start(sc), 20).state;
    const b = engine.run(start({ ...sc, settings: { ...sc.settings, config: { ...sc.settings.config, forcedEffects: {} } } }), 20).state;
    expect(b.plots).toEqual(a.plots);
  });

  it("normalizeForcedEffects drops empty entries", () => {
    expect(normalizeForcedEffects({ a: [], b: ["immunity", "immunity"] })).toEqual({ b: ["immunity"] });
    expect(normalizeForcedEffects({ a: [] })).toBeUndefined();
  });

  describe("from scripts", () => {
    /** Wheat at (4,4) on one plot with a script; returns the wheat's held effects after `cycles`. */
    const withScript = (source: string, config = {}) => {
      const sc = singlePlot(layout([["wheat", 4, 4]]), { config });
      sc.plots[0].script = { source };
      return start(sc);
    };
    const wheatHeld = (s: ReturnType<typeof start>) => plantAt(s, 1, 4, 4)!.held;

    it("forceEffects switches effects on at top level and they apply from the first tick", () => {
      const r = engine.run(withScript(`forceEffects("wheat", ["immunity", "improved_harvest_boost"])`), 1).state;
      expect(r.scripts?.halt).toBeNull();
      expect(r.scripts?.forcedEffects).toEqual({ wheat: ["immunity", "improved_harvest_boost"] });
      expect(wheatHeld(r)).toEqual(expect.arrayContaining(["immunity", "improved_harvest_boost"]));
    });

    it("can switch the scenario setting off and on again by cycle", () => {
      const src = `function onCycleEnd() { if (cycle === 2) unforceEffects(); if (cycle === 4) resetForcedEffects() }`;
      let s = withScript(src, { forcedEffects: { wheat: ["immunity"] } });
      const seen: boolean[] = [];
      for (let i = 0; i < 6; i++) {
        s = engine.run(s, 1).state;
        seen.push(wheatHeld(s).includes("immunity"));
      }
      expect(seen).toEqual([true, true, true, false, false, true]);
    });

    it("forcedEffects reads the current set; effects take effect within the session", () => {
      const src = `let before = null; let after = null; let list = null;
        function onSession() { const w = plot.at(4, 4); before = w.effects; forceEffects("wheat", "xp_boost"); after = w.effects; list = forcedEffects }`;
      const r = engine.run(withScript(src), 1).state;
      expect(r.scripts?.halt).toBeNull();
      const v = Object.fromEntries(inspectScriptVariables(r).map((x) => [x.name, x.value]));
      expect(JSON.stringify(v.before)).not.toContain("xp_boost");
      expect(JSON.stringify(v.after)).toContain("xp_boost");
      expect(JSON.stringify(v.list)).toContain("xp_boost");
      expect(wheatHeld(r)).toContain("xp_boost");
    });

    it("splitting a run doesn't change the result", () => {
      const s = withScript(`function onCycleEnd() { if (cycle % 3 === 0) forceEffects("wheat", ["immunity"]); else unforceEffects("wheat") }`);
      expect(JSON.stringify(engine.run(engine.run(s, 4).state, 6).state)).toBe(JSON.stringify(engine.run(s, 10).state));
    });

    it("under the leaderboard rules every debug API fails with a clear error and forces nothing", () => {
      const rules = { leaderboardRules: true };
      for (const src of [`forceEffects("wheat", ["immunity"])`, `unforceEffects()`, `resetForcedEffects()`, `function onSession() { forceEffects("wheat", ["immunity"]) }`]) {
        const r = engine.run(withScript(src, rules), 2).state;
        expect(r.scripts?.halt?.kind).toBe("error");
        expect(r.scripts?.halt?.message).toMatch(/debugging tool and isn't allowed under the leaderboard rules/);
        expect(r.scripts?.forcedEffects).toBeUndefined();
        expect(wheatHeld(r)).not.toContain("immunity");
      }
      // Reading what is forced stays harmless.
      expect(engine.run(withScript(`let f = forcedEffects`, rules), 2).state.scripts?.halt).toBeNull();
    });

    it("rejects unknown ids and use in exit conditions", () => {
      expect(engine.run(withScript(`forceEffects("nope", ["immunity"])`), 1).state.scripts?.halt?.message).toMatch(/isn't a crop or mutation/);
      expect(engine.run(withScript(`forceEffects("wheat", ["nope"])`), 1).state.scripts?.halt?.message).toMatch(/isn't an effect id/);
      expect(engine.run(withScript(`forceEffects("constructor", ["immunity"])`), 1).state.scripts?.halt?.kind).toBe("error");
      expect(engine.run(withScript(`forceEffects("wheat", ["toString"])`), 1).state.scripts?.halt?.kind).toBe("error");
    });
  });

  it("imports from a flows file and rejects unknown ids", () => {
    const sc = singlePlot(layout([["wheat", 4, 4]]));
    const exported = exportFlows({ ...sc, settings: { ...sc.settings, config: { ...sc.settings.config, forcedEffects: FORCED } } }, { advancedSettings: true });
    expect(exported.settings?.config?.forcedEffects).toEqual(FORCED);
    const withForced = (forcedEffects: unknown) =>
      JSON.stringify({ ...exported, settings: { ...exported.settings, config: { ...exported.settings!.config, forcedEffects } } });
    expect(importFlows(sc, withForced(FORCED)).settings.config.forcedEffects).toEqual(FORCED);
    expect(() => importFlows(sc, withForced({ nope: ["immunity"] }))).toThrow(/unknown plant/);
    expect(() => importFlows(sc, withForced({ all_in_aloe: ["nope"] }))).toThrow(/effect ids/);
  });
});
