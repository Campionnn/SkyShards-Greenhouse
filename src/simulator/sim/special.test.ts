import { describe, expect, it } from "vitest";
import { ALOE_FRAGMENT, aloeHarvestItems, aloeRow } from "../stage/aloe";
import { engine, flow, inject, layout, NEVER_ACTIVE, plantAt, scenario, stage, start } from "../testHelpers";
import type { ActivitySchedule, TimedEvent } from "./state";

const slotsOnly = { spawnCells: "slotsOnly" as const };
const blank = (activity: ActivitySchedule = NEVER_ACTIVE, config: Record<string, unknown> = {}) =>
  start(scenario([flow([stage("a", layout())])], { config: { ...slotsOnly, ...config }, activity }));
const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);

describe("Soggybud", () => {
  it("starts dry, draws water from wet neighbours, and its stage is its water level", () => {
    const s = blank();
    inject(s, 1, "soggybud", 5, 5, "spawned");
    inject(s, 1, "wheat", 5, 4, "planted");
    inject(s, 1, "wheat", 5, 6, "planted");
    expect(plantAt(s, 1, 5, 5)).toMatchObject({ water: 0, stage: 0 });

    const one = engine.run(s, 1).state;
    expect(plantAt(one, 1, 5, 5)).toMatchObject({ water: 4, stage: 0 }); // 2 from each of 2 wheat
    expect(plantAt(one, 1, 5, 4)!.water).toBeLessThanOrEqual(98);

    const five = engine.run(s, 5).state;
    expect(plantAt(five, 1, 5, 5)).toMatchObject({ water: 20, stage: 2 });

    // The player keeps the wheat watered; wheat decay is off so the neighbours stay put, and the
    // Soggybud's own 3-day timer is stretched out so the water mechanic is what this test measures.
    const grown = blank({ kind: "everyN", n: 1, offset: 0 }, { baseCropDecayHours: 0, decayDaysOverrides: { soggybud: 30 } });
    inject(grown, 1, "soggybud", 5, 5, "spawned");
    inject(grown, 1, "wheat", 5, 4, "planted");
    inject(grown, 1, "wheat", 5, 6, "planted");
    // 2 wheat x 2 water = 4 per tick: stage 10 (100 water) on the 25th tick, then the player harvests it.
    const before = engine.run(grown, 24).state;
    expect(plantAt(before, 1, 5, 5)).toMatchObject({ water: 96, stage: 9 });
    const done = engine.run(before, 1);
    expect(ofKind(done.events, "fullyGrown").some((e) => e.kindId === "soggybud")).toBe(true);
    expect(ofKind(done.events, "harvested").some((e) => e.kindId === "soggybud")).toBe(true);
  });

  it("with only 2 neighbours its 3-day timer runs out before it finishes growing", () => {
    // 4 water a tick means 25 ticks to mature, but a spawn only lives 3 days (~18-19 cycles).
    const s = blank();
    inject(s, 1, "soggybud", 5, 5, "spawned");
    inject(s, 1, "wheat", 5, 4, "planted");
    inject(s, 1, "wheat", 5, 6, "planted");
    const r = engine.run(s, 20);
    expect(r.summary.decayed.soggybud).toBe(1);
    expect(ofKind(r.events, "fullyGrown").some((e) => e.kindId === "soggybud")).toBe(false);
  });

  it("never grows without wet neighbours, and the player never waters it", () => {
    const s = blank({ kind: "everyN", n: 1, offset: 0 });
    inject(s, 1, "soggybud", 5, 5, "spawned");
    const r = engine.run(s, 10).state;
    expect(plantAt(r, 1, 5, 5)).toMatchObject({ water: 0, stage: 0 });
  });

  it("never draws from another Soggybud", () => {
    const s = blank();
    inject(s, 1, "soggybud", 5, 5, "spawned");
    inject(s, 1, "soggybud", 5, 6, "spawned", { water: 50 });
    const r = engine.run(s, 3).state;
    expect(plantAt(r, 1, 5, 5)!.water).toBe(0);
    expect(plantAt(r, 1, 5, 6)!.water).toBe(50);
  });

  it("the water drawn per neighbour is configurable", () => {
    const s = blank(NEVER_ACTIVE, { soggybudWaterPerNeighbour: 25 });
    inject(s, 1, "soggybud", 5, 5, "spawned");
    inject(s, 1, "melon", 4, 5, "planted");
    expect(plantAt(engine.run(s, 1).state, 1, 5, 5)).toMatchObject({ water: 25, stage: 2 });
  });
});

describe("All-in Aloe", () => {
  it("fragment table: every 9 fragments become one All-in Aloe", () => {
    expect(aloeHarvestItems(3)).toEqual({ aloes: 0, fragments: 0 });
    expect(aloeHarvestItems(4)).toEqual({ aloes: 0, fragments: 1 });
    expect(aloeHarvestItems(9)).toEqual({ aloes: 1, fragments: 0 });
    expect(aloeHarvestItems(14)).toEqual({ aloes: 6, fragments: 6 });
    expect(aloeHarvestItems(27)).toEqual({ aloes: 829, fragments: 1 });
    expect(aloeRow(14).resetChance).toBe(0.33);
  });

  it("fragments in the inventory turn into All-in Aloe automatically, 9 at a time", async () => {
    const { convertAloeFragments } = await import("./inventory");
    const s = start(scenario([flow([stage("a", layout())])], { inventory: { all_in_aloe_fragment: 12 } }));
    expect(s.inventory.all_in_aloe).toBe(1); // converted at setup
    expect(s.inventory.all_in_aloe_fragment).toBe(3);
    s.inventory.all_in_aloe_fragment += 6;
    expect(convertAloeFragments(s)).toBe(1);
    expect(s.inventory).toMatchObject({ all_in_aloe: 2, all_in_aloe_fragment: 0 });
  });

  it("resets to stage 1 on reaching new stages, at the table's rates", () => {
    const s = blank();
    for (let i = 0; i < 10; i++) inject(s, 1, "all_in_aloe", i, 0, "spawned");
    const r = engine.run(s, 400, { retainEvents: "all" });
    const resets = ofKind(r.events, "reset");
    expect(resets.length).toBeGreaterThan(50);
    expect(resets.every((e) => e.fromStage >= 4)).toBe(true);
    expect(r.state.plots[0].plants.every((p) => p.stage <= 27)).toBe(true);
  });

  it("the online player harvests it at the target stage for fragments + crops", () => {
    // Find a seed where the aloe survives 8 -> 9 without resetting (18% reset chance at 9).
    for (let seed = 1; seed < 40; seed++) {
      const s = start(scenario([flow([stage("a", layout())])], { seed, config: { ...slotsOnly, aloeHarvestStage: 9 } }));
      inject(s, 1, "all_in_aloe", 5, 5, "spawned", { stage: 8 });
      const r = engine.run(s, 1);
      const h = ofKind(r.events, "harvested")[0];
      if (!h) continue;
      expect(h.drops.all_in_aloe).toBe(1); // 9x at stage 9 = 9 fragments = 1 aloe
      expect(h.drops[ALOE_FRAGMENT]).toBeUndefined();
      expect(h.drops.wheat).toBeGreaterThan(0);
      return;
    }
    throw new Error("no seed without a reset");
  });

  it("can be harvested at any stage: a stage change takes it at its current stage", () => {
    const f = flow([stage("a", layout(), [{ kind: "cycles", n: 1 }]), stage("b", layout(), [], { fullClear: true })], false);
    const s = start(scenario([f], { config: slotsOnly }));
    inject(s, 1, "all_in_aloe", 5, 5, "spawned", { stage: 2 });
    const r = engine.run(s, 1);
    const h = ofKind(r.events, "harvested")[0];
    expect(h?.kindId).toBe("all_in_aloe");
    expect(r.summary.destroyed.all_in_aloe).toBeUndefined();
  });
});

describe("harvest yield", () => {
  const harvestAshwreath = (seed: number) => {
    // No base crops standing: yield sum = 1 + 0.5 upgrade = 1.5. FF 0, Evergreen 0.6.
    const s = start(scenario([flow([stage("a", layout())])], { seed, config: slotsOnly, stats: { plantYieldUpgrade: 0.5, evergreenChip: 0.6 } }));
    inject(s, 1, "ashwreath", 5, 5, "spawned", { lockedEffects: [], fullyGrownAtCycle: 0 });
    return ofKind(engine.run(s, 1).events, "harvested").find((e) => e.kindId === "ashwreath")!;
  };

  it("Evergreen scales a mutation's crop bundle: 180 nether wart x 1.5 x 1.6 = 432", () => {
    expect(harvestAshwreath(1).drops.nether_wart).toBe(432);
  });

  it("yield 1.5 on Ashwreath: 1 item guaranteed, a 2nd about half the time", () => {
    const counts = Array.from({ length: 400 }, (_, i) => harvestAshwreath(i + 1).drops.ashwreath);
    expect(counts.every((n) => n === 1 || n === 2)).toBe(true);
    const twos = counts.filter((n) => n === 2).length / counts.length;
    expect(twos).toBeGreaterThan(0.4);
    expect(twos).toBeLessThan(0.6);
  });
});

describe("Noctilume", () => {
  it("advances only on ticks the player is online (they set the time); there is no day/night cycle", () => {
    const offline = blank();
    inject(offline, 1, "noctilume", 4, 4, "spawned");
    expect(plantAt(engine.run(offline, 6).state, 1, 4, 4)?.stage).toBe(0);

    const everyOther = blank({ kind: "everyN", n: 2, offset: 0 });
    inject(everyOther, 1, "noctilume", 4, 4, "spawned");
    const r = engine.run(everyOther, 3);
    expect(ofKind(r.events, "advanced").map((e) => e.cycle)).toEqual([0, 2]);
  });
});
