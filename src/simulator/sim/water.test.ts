import { describe, expect, it } from "vitest";
import type { SimConfig } from "../config";
import type { PolicyOverrides } from "../flow/types";
import { engine, inject, layout, NEVER_ACTIVE, NO_BASE_CROP_DECAY, plantAt, singlePlot, start, TIMER_ONLY } from "../testHelpers";
import { isDry } from "./plants";
import type { ActivitySchedule, PlantState, SimulationState, TimedEvent } from "./state";

// A plant whose water reaches haltWater (-100) dries out and halts. A dry plant
// doesn't grow, gives or relays no effects (it still receives them), doesn't
// count toward requirements or the unique crop bonus, still blocks Lonelily,
// and keeps decaying. Watering un-halts it.

const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);

const HALT = -100;
const ONLINE: ActivitySchedule = { kind: "everyN", n: 1, offset: 0 };

/** An empty plot, only slots roll, base crops don't decay (unless a test asks), the player is away. */
const blank = (
  opts: { slots?: [string, number, number][]; config?: Partial<SimConfig>; activity?: ActivitySchedule; policies?: PolicyOverrides } = {}
): SimulationState =>
  start(
    singlePlot(layout([], opts.slots ?? []), {
      config: { spawnCells: "slotsOnly", ...NO_BASE_CROP_DECAY, ...opts.config },
      activity: opts.activity ?? NEVER_ACTIVE,
      policies: opts.policies,
    })
  );

const held = (s: SimulationState, row: number, col: number) => plantAt(s, 1, row, col)!.held;

describe("drying out", () => {
  it("isDry is derived from water alone: at or below haltWater, never for a Dead Plant", () => {
    const s = blank();
    const config = s.scenario.settings.config;
    expect(config.haltWater).toBe(HALT);
    const wheat = inject(s, 1, "wheat", 5, 5, "planted", { water: HALT + 1 });
    expect(isDry(wheat, config)).toBe(false);
    wheat.water = HALT;
    expect(isDry(wheat, config)).toBe(true);
    const dead = inject(s, 1, "dead_plant", 0, 0, "placed", { water: HALT, isDeadPlant: true });
    expect(isDry(dead, config)).toBe(false);
  });

  it("a dry plant doesn't grow: it stays at its stage and emits growthBlocked {gate: dry} every tick", () => {
    const s = blank();
    inject(s, 1, "wheat", 5, 5, "planted", { water: HALT, stage: 2 });
    const r = engine.run(s, 5);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", stage: 2, water: HALT, isDeadPlant: false });
    expect(ofKind(r.events, "growthBlocked").map((e) => e.gate)).toEqual(["dry", "dry", "dry", "dry", "dry"]);
    expect(ofKind(r.events, "advanced")).toHaveLength(0);
    // It drank nothing while halted, so it didn't "dry out" again either.
    expect(ofKind(r.events, "driedOut")).toHaveLength(0);
  });

  it("a natural drying out is reported once (driedOut event + summary), and the plant is still standing", () => {
    const s = blank({ config: { waterLossMin: 3, waterLossMax: 3, negativeWaterSkipChance: 0 } });
    inject(s, 1, "wheat", 5, 5, "planted", { water: -94 }); // -97 after one stage, -100 after two
    const r = engine.run(s, 6);
    expect(ofKind(r.events, "driedOut")).toHaveLength(1);
    expect(ofKind(r.events, "driedOut")[0].cycle).toBe(1);
    expect(r.summary.driedOut).toEqual({ wheat: 1 });
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", stage: 2, water: HALT });
  });
});

describe("dry plants don't count toward requirements (but still block Lonelily)", () => {
  it("a dry wheat doesn't satisfy Dustgrain: the checked target drops to `requirements` and never spawns", () => {
    const setup = (dryOne: boolean) => {
      const s = blank({ slots: [["dustgrain", 4, 5]] });
      inject(s, 1, "wheat", 3, 5, "planted", { stage: 8 }); // fully grown: never drinks, so stays wet
      inject(s, 1, "wheat", 5, 5, "planted", dryOne ? { water: HALT, stage: 2 } : { stage: 8 });
      return s;
    };
    const wet = engine.run(setup(false), 1);
    expect(wet.state.plots[0].watchStatus["4,5"]).toBe("ready");

    const r = engine.run(setup(true), 40);
    expect(r.state.plots[0].watchStatus["4,5"]).toBe("requirements");
    expect(r.summary.spawned.dustgrain).toBeUndefined();
    const report = engine.analyse(r.state);
    expect(report.totals).toMatchObject({ watched: 40, requirements: 40 });
    expect(report.sustainable).toBe(false);
  });

  it("a dry neighbour still blocks Lonelily: it is physically there", () => {
    // blankFillTo 1: an eligible Lonelily (weight 6) takes every roll.
    const run = (neighbour: "none" | "dry") => {
      const s = blank({ slots: [["lonelily", 5, 5]], config: { blankFillTo: 1 } });
      if (neighbour === "dry") inject(s, 1, "wheat", 4, 5, "planted", { water: HALT });
      return engine.run(s, 30);
    };
    expect(run("none").summary.spawned.lonelily).toBeGreaterThan(0);
    const blocked = run("dry");
    expect(blocked.summary.spawned.lonelily).toBeUndefined();
    expect(blocked.state.plots[0].watchStatus["5,5"]).toBe("requirements");
  });
});

describe("dry plants give and relay no effects, but still receive them", () => {
  it.each([
    // Melon drinks water, so it can dry out for real.
    ["melon", "planted"],
    // Gloomgourd never dries in play (no watering); forced dry to test the effect rule.
    ["gloomgourd", "spawned"],
  ] as const)("a dry %s gives no water_retain (and still receives what its neighbours give)", (giver, origin) => {
    const setup = (dry: boolean) => {
      const s = blank();
      inject(s, 1, giver, 5, 5, origin, dry ? { water: HALT } : {});
      inject(s, 1, "wheat", 5, 6, "planted", { stage: 8 }); // receives from the giver
      inject(s, 1, "carrot", 5, 4, "planted", { stage: 8 }); // gives xp_boost to the giver
      return engine.run(s, 1).state;
    };
    const wet = setup(false);
    expect(held(wet, 5, 6)).toContain("water_retain");
    const dry = setup(true);
    expect(held(dry, 5, 6)).not.toContain("water_retain");
    expect(held(dry, 5, 6)).toEqual([]);
    expect(held(dry, 5, 5)).toContain("xp_boost"); // receive-only
  });

  it("a dry relay doesn't spread what it holds", () => {
    // Wild rose makes the wheat at (5,6) a relay. The carrot at (5,7) gives the
    // wheat xp_boost, which the wheat relays to the probe potato at (4,6).
    const setup = (dry: boolean) => {
      const s = blank();
      inject(s, 1, "wild_rose", 5, 5, "planted", { stage: 15 });
      inject(s, 1, "wheat", 5, 6, "planted", dry ? { water: HALT } : { stage: 8 });
      inject(s, 1, "carrot", 5, 7, "planted", { stage: 8 });
      inject(s, 1, "potato", 4, 6, "planted", { stage: 8 });
      return engine.run(s, 1).state;
    };
    const wet = setup(false);
    expect(held(wet, 4, 6)).toEqual(expect.arrayContaining(["harvest_boost", "xp_boost"]));
    const dry = setup(true);
    expect(held(dry, 4, 6)).not.toContain("xp_boost"); // not relayed
    expect(held(dry, 4, 6)).not.toContain("harvest_boost"); // not given directly either
    // The dry relay itself still receives everything around it.
    expect(held(dry, 5, 6)).toEqual(expect.arrayContaining(["effect_spread", "xp_boost", "immunity"]));
  });
});

describe("unique crops", () => {
  it("a dry base crop drops out of the unique count (Flora 0, so the count is visible)", () => {
    const setup = (dry: boolean) => {
      const s = blank();
      inject(s, 1, "wheat", 5, 5, "planted", { stage: 8 });
      inject(s, 1, "carrot", 2, 2, "planted", dry ? { water: HALT } : { stage: 8 });
      return engine.run(s, 1).state;
    };
    const wet = setup(false);
    expect(wet.scenario.settings.playerStats.floraShard).toBe(0);
    expect(wet).toMatchObject({ uniqueCropsStanding: 2, uniqueCropCount: 2 });
    const dry = setup(true);
    expect(dry).toMatchObject({ uniqueCropsStanding: 1, uniqueCropCount: 1 });
    expect(dry.lastCycleSeconds).toBeGreaterThan(wet.lastCycleSeconds); // fewer crops counted: slower cycles
  });
});

// A water consumer loses waterLossMin..Max x retain/drain every cycle while not
// fully grown (advanced, gated, skipped or blocked), and nothing once fully
// grown or dried out.
describe("water loss per cycle until fully grown", () => {
  /** A fixed loss of 20 a cycle and no below-0 skips, so the numbers are exact. */
  const FIXED = { waterLossMin: 20, waterLossMax: 20, negativeWaterSkipChance: 0 };

  it("defaults: 18-22 a cycle", () => {
    const s = blank();
    expect(s.scenario.settings.config).toMatchObject({ waterLossMin: 18, waterLossMax: 22 });
    inject(s, 1, "wheat", 5, 5, "planted");
    const r = engine.run(s, 1);
    const water = plantAt(r.state, 1, 5, 5)!.water;
    expect(water).toBeGreaterThanOrEqual(-22);
    expect(water).toBeLessThanOrEqual(-18);
  });

  it("a gated plant still loses water every cycle it is blocked (asleep Snoozling)", () => {
    const s = blank({ config: FIXED });
    inject(s, 1, "snoozling", 3, 3, "spawned", { stage: 4, water: 100 });
    const r = engine.run(s, 3);
    expect(ofKind(r.events, "advanced")).toHaveLength(1); // 4 -> 5, then it falls asleep
    expect(ofKind(r.events, "growthBlocked")).toHaveLength(2);
    expect(plantAt(r.state, 1, 3, 3)).toMatchObject({ stage: 5, water: 40 }); // 3 cycles x 20
  });

  it("a water-skipped cycle still drains, and below 0 each drained cycle rolls the skip again", () => {
    const s = blank({ config: { ...FIXED, negativeWaterSkipChance: 1 } });
    inject(s, 1, "wheat", 5, 5, "planted", { water: 30, stage: 2 });
    const r = engine.run(s, 4);
    // Cycle 0 grows (30 -> 10); cycle 1 grows (10 -> -10, skip set); cycles 2-3 are skipped but still drain.
    expect(ofKind(r.events, "advanced")).toHaveLength(2);
    expect(ofKind(r.events, "growthSkipped")).toHaveLength(2);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 4, water: -50, skipNextGrowth: true });
  });

  it("a fully grown plant stops losing water; a plant fully grown from the start never loses any", () => {
    const s = blank({ config: FIXED });
    inject(s, 1, "wheat", 5, 5, "planted", { stage: 7, water: 100 }); // grows its last stage on cycle 0
    inject(s, 1, "wheat", 2, 2, "planted", { stage: 8, water: 100 }); // already fully grown
    const r = engine.run(s, 5);
    // The cycle it grew its last stage it was still growing, so it drank once; never again.
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 8, water: 80 });
    expect(plantAt(r.state, 1, 2, 2)).toMatchObject({ stage: 8, water: 100 });
  });

  it("Glasscorn stops drinking once fully grown (stage 7) and drinks again after its lap resets it to 1", () => {
    const s = blank({ config: FIXED });
    inject(s, 1, "glasscorn", 4, 4, "spawned", { stage: 6, water: 100 });
    const steps = [];
    let state = s;
    for (let i = 0; i < 4; i++) {
      state = engine.run(state, 1).state;
      const p = plantAt(state, 1, 4, 4)!;
      steps.push([p.stage, p.water]);
    }
    // 6->7 drinks; 7->8 and the 8->1 reset are fully grown ticks; back at 1 it drinks again.
    expect(steps).toEqual([
      [7, 80],
      [8, 80],
      [1, 80],
      [2, 60],
    ]);
  });

  it("a dried-out plant loses no more water, and driedOut fires once", () => {
    const s = blank({ config: FIXED });
    inject(s, 1, "wheat", 5, 5, "planted", { water: -90, stage: 1 });
    const r = engine.run(s, 6);
    expect(ofKind(r.events, "driedOut")).toHaveLength(1);
    expect(ofKind(r.events, "driedOut")[0].cycle).toBe(0);
    expect(r.summary.driedOut).toEqual({ wheat: 1 });
    // -90 -> -110 on cycle 0, then halted: no growth and no more loss.
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 2, water: -110 });
    expect(ofKind(r.events, "growthBlocked").filter((e) => e.gate === "dry")).toHaveLength(5);
  });

  it("dries out again after being watered (one driedOut per drying out)", () => {
    // Online every 12th cycle: watered to 100, then 20 a cycle reaches -100 on the 10th drained cycle.
    // A 120-stage Magic Jellybean (never decays) is still growing throughout.
    const s = blank({ config: FIXED, activity: { kind: "everyN", n: 12, offset: 0 } });
    inject(s, 1, "magic_jellybean", 5, 5, "spawned", { water: HALT });
    const r = engine.run(s, 24);
    // Cycle 0: already dry (no event), watered. Cycles 1-10 drain 100 -> -100 (dried out on cycle 10).
    // Cycle 12: watered again; cycles 13-22 drain to -100 again (dried out on cycle 22).
    expect(ofKind(r.events, "driedOut").map((e) => e.cycle)).toEqual([10, 22]);
    expect(r.summary.driedOut).toEqual({ magic_jellybean: 2 });
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 21, water: HALT }); // grew on cycles 1-10 and 13-22
  });
});

describe("everything starts at 0 water", () => {
  it("natural spawns, placed items and planted crops all start at 0", () => {
    // blankFillTo 1: an eligible Lonelily takes the roll on cycle 0.
    const s = blank({ slots: [["lonelily", 5, 5]], config: { blankFillTo: 1 } });
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["lonelily"]);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ origin: "spawned", water: 0 });

    const t = blank();
    expect(inject(t, 1, "startlevine", 1, 1, "spawned").water).toBe(0);
    expect(inject(t, 1, "startlevine", 3, 3, "placed").water).toBe(0);
    expect(inject(t, 1, "wheat", 6, 6, "planted").water).toBe(0);
  });

  it("layout plants start at 0: a placed item never drinks, a base crop drinks until the player waters it", () => {
    const sc = (activity: ActivitySchedule) =>
      start(singlePlot(layout([["chloronite", 5, 5], ["wheat", 2, 2]]), { config: { spawnCells: "slotsOnly", waterLossMin: 20, waterLossMax: 20, negativeWaterSkipChance: 0 }, activity }));
    const away = sc(NEVER_ACTIVE);
    expect(plantAt(away, 1, 5, 5)).toMatchObject({ origin: "placed", water: 0 });
    expect(plantAt(away, 1, 2, 2)).toMatchObject({ origin: "planted", water: 0 });
    const r = engine.run(away, 5).state;
    expect(plantAt(r, 1, 5, 5)!.water).toBe(0);
    expect(plantAt(r, 1, 2, 2)!.water).toBe(-100); // dried out after 5 cycles, never watered
    // An online player waters everything to max at the first session.
    const online = engine.run(sc(ONLINE), 1).state;
    expect(plantAt(online, 1, 2, 2)!.water).toBe(100);
    expect(plantAt(online, 1, 5, 5)!.water).toBe(100);
  });

  it("with watering: never a base crop is never raised above 0", () => {
    const s = start(singlePlot(layout([["wheat", 2, 2]]), { config: { spawnCells: "slotsOnly", ...NO_BASE_CROP_DECAY, waterLossMin: 20, waterLossMax: 20, negativeWaterSkipChance: 0 }, activity: ONLINE, policies: { watering: "never" } }));
    expect(plantAt(engine.run(s, 1).state, 1, 2, 2)!.water).toBe(-20);
  });

  it("a fresh spawn drinks below 0 on its first tick; the player's session tops it up", () => {
    const away = blank({ config: { waterLossMin: 20, waterLossMax: 20, negativeWaterSkipChance: 0 } });
    inject(away, 1, "startlevine", 5, 5, "spawned");
    expect(plantAt(engine.run(away, 1).state, 1, 5, 5)!.water).toBe(-20);

    const online = blank({ activity: ONLINE });
    inject(online, 1, "startlevine", 5, 5, "spawned");
    expect(plantAt(engine.run(online, 1).state, 1, 5, 5)!.water).toBe(100);
  });
});

describe("uptime: a dried-out target on its own slot is `halted`", () => {
  const withTarget = (patch: Partial<PlantState>, activity: ActivitySchedule = NEVER_ACTIVE) => {
    const s = blank({ slots: [["startlevine", 5, 5]], activity, config: { waterLossMin: 0, waterLossMax: 0 } });
    inject(s, 1, "startlevine", 5, 5, "spawned", { stage: 3, ...patch });
    return s;
  };

  it("records halted (not growing), lowers uptime, and does not make the run unsustainable", () => {
    const r = engine.run(withTarget({ water: HALT }), 4);
    expect(r.state.plots[0].watchStatus["5,5"]).toBe("halted");
    const report = engine.analyse(r.state);
    expect(report.totals).toEqual({ watched: 4, growing: 0, ready: 0, requirements: 0, blocked: 0, halted: 4 });
    expect(report.uptime).toBe(0);
    expect(report.sustainable).toBe(true);
    expect(report.firstFailure).toBeNull();
    expect(report.spots[0]).toMatchObject({ mutationId: "startlevine", halted: 4, uptime: 0 });

    // The same target with water is growing: full uptime.
    const wet = engine.analyse(engine.run(withTarget({ water: 50 }), 4).state);
    expect(wet.totals).toMatchObject({ watched: 4, growing: 4, halted: 0 });
    expect(wet.uptime).toBe(1);
  });

  it("watering ends it: halted on the cycle the tick saw it dry, growing after the session watered it", () => {
    const r = engine.run(withTarget({ water: HALT }, ONLINE), 3);
    const report = engine.analyse(r.state);
    expect(report.totals).toMatchObject({ watched: 3, halted: 1, growing: 2 });
    expect(report.uptime).toBeCloseTo(2 / 3);
    expect(report.sustainable).toBe(true);
    expect(r.state.plots[0].watchStatus["5,5"]).toBe("growing");
  });

  it("a dried-out plant of another kind on the slot is still `blocked`, not halted", () => {
    const s = blank({ slots: [["startlevine", 5, 5]] });
    inject(s, 1, "wheat", 5, 5, "planted", { water: HALT });
    const report = engine.analyse(engine.run(s, 2).state);
    expect(report.totals).toMatchObject({ watched: 2, blocked: 2, halted: 0 });
  });

  it("a dry neighbour still gives `requirements`, not halted", () => {
    const s = blank({ slots: [["dustgrain", 4, 5]] });
    inject(s, 1, "wheat", 3, 5, "planted", { stage: 8 });
    inject(s, 1, "wheat", 5, 5, "planted", { water: HALT, stage: 2 });
    const r = engine.run(s, 3);
    expect(r.state.plots[0].watchStatus["4,5"]).toBe("requirements");
    const report = engine.analyse(r.state);
    expect(report.totals).toMatchObject({ watched: 3, requirements: 3, halted: 0 });
    expect(report.sustainable).toBe(false);
  });

  it("halted spots and totals are splittable like the rest of the run", () => {
    const s = withTarget({ water: HALT }, { kind: "everyN", n: 3, offset: 1 });
    const whole = engine.run(s, 6).state;
    const halves = engine.run(engine.run(s, 3).state, 3).state;
    expect(JSON.stringify(halves)).toBe(JSON.stringify(whole));
  });
});

describe("watering and decay", () => {
  it("watering to max un-halts it: it grows, gives and counts again", () => {
    const s = blank({ activity: ONLINE });
    inject(s, 1, "wheat", 5, 5, "planted", { water: HALT, stage: 2 });
    inject(s, 1, "carrot", 5, 6, "planted", { stage: 8 });
    // Cycle 0: the tick sees it dry (no growth); the session afterwards waters it.
    const first = engine.run(s, 1);
    expect(ofKind(first.events, "growthBlocked").map((e) => e.gate)).toEqual(["dry"]);
    expect(plantAt(first.state, 1, 5, 5)).toMatchObject({ stage: 2, water: 100 });
    // Cycle 1: it grows, its harvest_boost reaches the carrot, and it is counted again.
    const next = engine.run(first.state, 1);
    expect(plantAt(next.state, 1, 5, 5)?.stage).toBe(3);
    expect(held(next.state, 5, 6)).toContain("harvest_boost");
    expect(next.state.uniqueCropsStanding).toBe(2);
  });

  it("with watering: never it stays halted for good - not killed, not replaced", () => {
    const s = blank({ activity: ONLINE, policies: { watering: "never" } });
    inject(s, 1, "wheat", 5, 5, "planted", { water: HALT, stage: 2 });
    const r = engine.run(s, 20);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", stage: 2, water: HALT, isDeadPlant: false });
    expect(r.summary.replacements).toBe(0);
    expect(ofKind(r.events, "growthBlocked")).toHaveLength(20);
  });

  it("its decay timer keeps running while it is halted, and it decays on time", () => {
    // Data's 3-day base-crop timer; timer-only, since a minimum would hold a plant that never helped.
    const s = blank({ config: { decayDaysOverrides: {}, ...TIMER_ONLY } });
    const p = inject(s, 1, "wheat", 5, 5, "planted", { water: HALT, stage: 2 });
    const timer = p.decaySecondsRemaining!;
    expect(timer).toBe(72 * 3600);
    const one = engine.run(s, 1);
    expect(plantAt(one.state, 1, 5, 5)!.decaySecondsRemaining).toBeCloseTo(timer - one.state.lastCycleSeconds);
    const cycles = Math.ceil(timer / one.state.lastCycleSeconds);
    const gone = engine.run(s, cycles);
    expect(gone.summary.decayed.wheat).toBe(1);
    expect(plantAt(gone.state, 1, 5, 5)).toMatchObject({ kindId: "dead_plant", isDeadPlant: true });
  });
});
