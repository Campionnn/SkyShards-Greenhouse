import { describe, expect, it } from "vitest";
import { EFFORT_WEIGHTS } from "../config";
import { engine, flow, inject, layout, NEVER_ACTIVE, plantAt, scenario, singlePlot, start, step, TIMER_ONLY } from "../testHelpers";
import { effortPerSession } from "./effort";
import type { ActivitySchedule } from "./state";

// Effort: a weighted count of the player's actions per online session (config.ts EFFORT_WEIGHTS).

const ONLINE: ActivitySchedule = { kind: "everyN", n: 1, offset: 0 };
const NO_WATER = { waterLossMin: 0, waterLossMax: 0 };

describe("effort counters", () => {
  it("starts at zero and stays there while the player is never online", () => {
    const s = start(singlePlot(layout([["wheat", 0, 0]]), { activity: NEVER_ACTIVE }));
    expect(s.summary.effort).toEqual({ sessions: 0, total: 0, peak: 0, counts: {} });
    const r = engine.run(s, 10);
    expect(r.state.summary.effort).toEqual({ sessions: 0, total: 0, peak: 0, counts: {} });
  });

  it("counts a session per online cycle and watering once per plot only when something needed water", () => {
    // Two plots: one with a thirsty crop, one with nothing to water.
    const s = start(scenario([flow([step("a", layout([["wheat", 0, 0]]))]), flow([step("b", layout())])], { activity: ONLINE, config: NO_WATER }));
    plantAt(s, 1, 0, 0)!.water = 10;
    const r = engine.run(s, 1);
    const e = r.state.summary.effort!;
    expect(e.sessions).toBe(1);
    expect(e.counts.water).toBe(1);
    // The next session finds everything full (no water loss): nothing to do.
    const again = engine.run(r.state, 1).state.summary.effort!;
    expect(again.sessions).toBe(2);
    expect(again.counts.water).toBe(1);
  });

  it("weights a harvest 1 and a minigame harvest 2", () => {
    const s = start(singlePlot(layout(), { activity: ONLINE, config: NO_WATER }), TIMER_ONLY);
    const plot = s.plots[0];
    inject(s, 1, "wheat", 0, 0, "spawned", { stage: 99, lockedEffects: [] }, TIMER_ONLY);
    inject(s, 1, "phantomleaf", 5, 5, "spawned", { stage: 99, lockedEffects: [] }, TIMER_ONLY);
    expect(plot.plants.length).toBe(2);
    const r = TIMER_ONLY.run(s, 1);
    const e = r.state.summary.effort!;
    expect(e.counts.harvest).toBe(1);
    expect(e.counts.minigame).toBe(1);
    expect(e.total).toBe(EFFORT_WEIGHTS.harvest + EFFORT_WEIGHTS.minigame + (e.counts.water ?? 0) * EFFORT_WEIGHTS.water);
  });

  it("counts placements outside setup (3 each) but never the free starting layout", () => {
    const s = start(singlePlot(layout([["puffercloud", 0, 0]]), { activity: ONLINE, inventory: { puffercloud: 5 }, config: NO_WATER }), TIMER_ONLY);
    expect(s.summary.effort!.counts.place ?? 0).toBe(0);
    plantAt(s, 1, 0, 0)!.decaySecondsRemaining = 1; // decays on the first tick, re-placed in the session
    const r = TIMER_ONLY.run(s, 1);
    const e = r.state.summary.effort!;
    expect(e.counts.remove).toBe(1); // the Dead Plant is cleared
    expect(e.counts.place).toBe(1);
    expect(e.total).toBeGreaterThanOrEqual(EFFORT_WEIGHTS.remove + EFFORT_WEIGHTS.place);
  });

  it("counts a step change and keeps the heaviest session as the peak", () => {
    const sc = scenario([flow([step("one", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 2 }]), step("two", layout([["carrot", 0, 0]]))])], {
      activity: ONLINE,
      config: NO_WATER,
    });
    const r = engine.run(start(sc), 3);
    const e = r.state.summary.effort!;
    expect(e.counts.stepChange).toBe(1);
    expect(e.sessions).toBe(3);
    // The step-change session replaces the crop (remove + place) and so is the peak.
    expect(e.peak).toBeGreaterThanOrEqual(EFFORT_WEIGHTS.stepChange);
    expect(e.peak).toBeLessThanOrEqual(e.total);
    expect(effortPerSession(e)).toBeCloseTo(e.total / 3);
  });

  it("counts watering once per plot per session, also when the session plants and waters again", () => {
    // The step change breaks the wheat and plants a carrot; `waterNew` waters the carrot in the same visit.
    const sc = scenario([flow([step("one", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 1 }]), step("two", layout([["carrot", 0, 0]]))])], {
      activity: ONLINE,
      config: NO_WATER,
    });
    const r = engine.run(start(sc), 1);
    const e = r.state.summary.effort!;
    expect(e.counts.stepChange).toBe(1);
    expect(plantAt(r.state, 1, 0, 0)?.kindId).toBe("carrot");
    expect(e.counts.water).toBe(1);
  });

  it("doesn't count work a step change undoes in the same session (a replant broken again)", () => {
    // Harvest-and-replant, then a full-clear step change breaks the fresh crop and plants the same crop
    // back: the player harvests once and plants once.
    const sc = scenario(
      [flow([step("one", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 1 }]), step("two", layout([["wheat", 0, 0]]), [], { fullClear: true })])],
      { activity: ONLINE, config: NO_WATER, policies: { baseCropUpkeep: "harvestWhenGrown" } }
    );
    const s = start(sc);
    const wheat = plantAt(s, 1, 0, 0)!;
    wheat.stage = wheat.readyStage;
    wheat.lockedEffects = [];
    const r = engine.run(s, 1);
    const e = r.state.summary.effort!;
    expect(r.events.filter((x) => x.kind === "placed")).toHaveLength(2); // the replant and the step's crop
    expect(e.counts).toEqual({ water: 1, harvest: 1, replant: 1, stepChange: 1 });
    expect(e.total).toBe(EFFORT_WEIGHTS.water + EFFORT_WEIGHTS.harvest + EFFORT_WEIGHTS.replant + EFFORT_WEIGHTS.stepChange);
  });

  it("still counts breaking a plant put down in an earlier session", () => {
    const sc = scenario([flow([step("one", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 2 }]), step("two", layout([["carrot", 0, 0]]))])], {
      activity: ONLINE,
      config: NO_WATER,
    });
    const r = engine.run(start(sc), 2);
    const e = r.state.summary.effort!;
    expect(e.counts.stepChange).toBe(1);
    expect(e.counts.remove).toBe(1); // the growing wheat from setup
    expect(e.counts.replant).toBe(1);
  });

  it("is deterministic and splittable", () => {
    const sc = scenario([flow([step("one", layout([["wheat", 0, 0], ["carrot", 0, 2]]), [{ kind: "cycles", n: 5 }])], true)], { activity: { kind: "everyN", n: 2, offset: 0 } });
    const s = start(sc);
    const whole = engine.run(s, 30).state;
    const split = engine.run(engine.run(s, 11).state, 19).state;
    expect(JSON.stringify(split.summary.effort)).toBe(JSON.stringify(whole.summary.effort));
    expect(whole.summary.effort!.sessions).toBe(15);
  });

  it("reads a state saved without an effort summary as zero and creates it on first use", () => {
    const s = start(singlePlot(layout([["wheat", 0, 0]]), { activity: ONLINE }));
    delete s.summary.effort;
    const r = engine.run(s, 1);
    expect(r.state.summary.effort!.sessions).toBe(1);
  });
});
