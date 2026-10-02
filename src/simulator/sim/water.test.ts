import { describe, expect, it } from "vitest";
import type { SimConfig } from "../config";
import type { PolicyOverrides } from "../flow/types";
import { engine, inject, layout, NEVER_ACTIVE, plantAt, singlePlot, start } from "../testHelpers";
import { isDry } from "./plants";
import type { ActivitySchedule, SimulationState, TimedEvent } from "./state";

// 0.27.2: a plant whose water reaches haltWater (-100) dries out and HALTS
// instead of dying. A dry plant doesn't grow, gives and relays no effects
// (it still receives them), doesn't count toward requirements or the unique
// crop bonus, still blocks Lonelily, and keeps decaying. Watering un-halts it.

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
      config: { spawnCells: "slotsOnly", baseCropDecayHours: 0, ...opts.config },
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
  it("a dry wheat no longer satisfies Dustgrain: the checked target drops to `requirements` and never spawns", () => {
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
    // Gloomgourd doesn't need watering, so in play it never dries; forced here to pin the effect rule itself.
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
    const s = blank({ config: { baseCropDecayHours: 72 } });
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
