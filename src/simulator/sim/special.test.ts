import { describe, expect, it } from "vitest";
import { ALOE_FRAGMENT, aloeHarvestItems, aloeRow } from "../growth/aloe";
import { DEFAULT_POLICIES, mergePolicies } from "../flow/policies";
import { THUNDERLING_CHARGE_PER_STAGE, THUNDERLING_MAX_CHARGE, type SimConfig } from "../config";
import type { Engine } from "../engine";
import { engine, engineWith, flow, inject, layout, NEVER_ACTIVE, plantAt, scenario, step, start, TIMER_ONLY } from "../testHelpers";
import type { ActivitySchedule, TimedEvent } from "./state";

const blank = (activity: ActivitySchedule = NEVER_ACTIVE, config: Partial<SimConfig> = {}, eng: Engine = engine) =>
  start(scenario([flow([step("a", layout())])], { config, activity }), eng);
const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);

describe("Soggybud", () => {
  it("starts dry, draws water from wet neighbours, and its stage is its water level", () => {
    const s = blank();
    inject(s, 1, "soggybud", 5, 5, "spawned");
    // Planted crops start at 0 too: these two have been watered by the player.
    inject(s, 1, "wheat", 5, 4, "planted", { water: 100 });
    inject(s, 1, "wheat", 5, 6, "planted", { water: 100 });
    expect(plantAt(s, 1, 5, 5)).toMatchObject({ water: 0, stage: 1 }); // every spawn enters at stage 1

    const one = engine.run(s, 1).state;
    expect(plantAt(one, 1, 5, 5)).toMatchObject({ water: 4, stage: 1 }); // 2 from each of 2 wheat; never below its spawn stage
    expect(plantAt(one, 1, 5, 4)!.water).toBeLessThanOrEqual(98);

    const five = engine.run(s, 5).state;
    expect(plantAt(five, 1, 5, 5)).toMatchObject({ water: 20, stage: 2 });

    // Wheat watered and not decaying; the Soggybud's timer is stretched to 30 days so only water limits growth.
    const slow = engineWith({ noBaseCropDecay: true, decayDays: { soggybud: 30 } });
    const grown = blank({ kind: "everyN", n: 1, offset: 0 }, {}, slow);
    inject(grown, 1, "soggybud", 5, 5, "spawned", {}, slow);
    inject(grown, 1, "wheat", 5, 4, "planted", { water: 100 }, slow);
    inject(grown, 1, "wheat", 5, 6, "planted", { water: 100 }, slow);
    // 2 wheat x 2 water = 4 per tick: stage 10 (100 water) on the 25th tick, then the player harvests it.
    const before = slow.run(grown, 24).state;
    expect(plantAt(before, 1, 5, 5)).toMatchObject({ water: 96, stage: 9 });
    const done = slow.run(before, 1);
    expect(ofKind(done.events, "fullyGrown").some((e) => e.kindId === "soggybud")).toBe(true);
    expect(ofKind(done.events, "harvested").some((e) => e.kindId === "soggybud")).toBe(true);
  });

  it("with only 2 neighbours its 3-day timer runs out before it finishes growing", () => {
    // 4 water a tick means 25 ticks to mature; the 3-day timer runs out after ~18-19 cycles.
    // Timer-only, so its unmet minimum (8) doesn't extend it.
    const s = blank(NEVER_ACTIVE, {}, TIMER_ONLY);
    inject(s, 1, "soggybud", 5, 5, "spawned", {}, TIMER_ONLY);
    inject(s, 1, "wheat", 5, 4, "planted", {}, TIMER_ONLY);
    inject(s, 1, "wheat", 5, 6, "planted", {}, TIMER_ONLY);
    const r = TIMER_ONLY.run(s, 20);
    expect(r.summary.decayed.soggybud).toBe(1);
    expect(ofKind(r.events, "fullyGrown").some((e) => e.kindId === "soggybud")).toBe(false);
  });

  it("never grows without wet neighbours, and the player never waters it", () => {
    const s = blank({ kind: "everyN", n: 1, offset: 0 });
    inject(s, 1, "soggybud", 5, 5, "spawned");
    const r = engine.run(s, 10).state;
    expect(plantAt(r, 1, 5, 5)).toMatchObject({ water: 0, stage: 1 });
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
    inject(s, 1, "melon", 4, 5, "planted", { water: 100 });
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
    const s = start(scenario([flow([step("a", layout())])], { inventory: { all_in_aloe_fragment: 12 } }));
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
      const s = start(scenario([flow([step("a", layout())])], { seed, config: { aloeHarvestStage: 9 } }));
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

  it("can be harvested at any stage: a step change takes it at its current stage", () => {
    const f = flow([step("a", layout(), [{ kind: "cycles", n: 1 }]), step("b", layout(), [], { fullClear: true })], false);
    const s = start(scenario([f]));
    inject(s, 1, "all_in_aloe", 5, 5, "spawned", { stage: 2 });
    const r = engine.run(s, 1);
    const h = ofKind(r.events, "harvested")[0];
    expect(h?.kindId).toBe("all_in_aloe");
    expect(r.summary.destroyed.all_in_aloe).toBeUndefined();
  });
});

describe("Magic Jellybean", () => {
  // Zeroed stats, no base crops standing: yield sum 1, FF x1, so drops are the raw multiplier.
  const online = (config: Partial<SimConfig> = {}) =>
    start(scenario([flow([step("a", layout())])], { config, activity: { kind: "everyN", n: 1, offset: 0 } }));
  const jellyHarvest = (events: TimedEvent[]) => ofKind(events, "harvested").find((e) => e.kindId === "magic_jellybean");

  it("the player only harvests it at stage 120: 10x jellybeans and 10x the stage-12 crop bundle", () => {
    const s = online();
    // Stage 58 under an online player: already watered (a fresh spawn's 0 water could roll a below-0 skip on the first tick).
    const p = inject(s, 1, "magic_jellybean", 5, 5, "spawned", { stage: 58, water: 100 });
    expect(p.readyStage).toBe(120);
    const early = engine.run(s, 61); // online every cycle through stages 59-119: never harvested
    expect(jellyHarvest(early.events)).toBeUndefined();
    expect(plantAt(early.state, 1, 5, 5)?.stage).toBe(119);
    const h = jellyHarvest(engine.run(early.state, 1).events)!;
    expect(h.drops).toMatchObject({ magic_jellybean: 10, moonflower: 6000, sunflower: 6000, sugar_cane: 12000 });
  });

  it("broken early by a step change, it still drops at its current stage (60 = 5x / 5x); below 12 nothing", () => {
    const f = flow([step("a", layout(), [{ kind: "cycles", n: 1 }]), step("b", layout(), [], { fullClear: true })], false);
    const s = start(scenario([f]));
    inject(s, 1, "magic_jellybean", 5, 5, "spawned", { stage: 59 }); // 60 after the tick
    inject(s, 1, "magic_jellybean", 7, 7, "spawned", { stage: 5 });
    const r = engine.run(s, 1);
    const h = jellyHarvest(r.events)!;
    expect(h.drops).toMatchObject({ magic_jellybean: 5, moonflower: 3000, sunflower: 3000, sugar_cane: 6000 });
    expect(r.summary.destroyed.magic_jellybean).toBe(1);
  });
});

describe("harvest yield", () => {
  const harvestAshwreath = (seed: number) => {
    // No base crops standing: yield sum = 1 + 0.5 upgrade = 1.5. FF 0, Evergreen 0.6.
    const s = start(scenario([flow([step("a", layout())])], { seed, stats: { plantYieldUpgrade: 0.5, evergreenChip: 0.6 } }));
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

describe("Zombud", () => {
  const grown = { stage: 16, lockedEffects: [], fullyGrownAtCycle: 0 };
  const online = (inventory: Record<string, number> = {}, stats: Record<string, number> = {}) =>
    start(scenario([flow([step("a", layout())])], { activity: { kind: "everyN", n: 1, offset: 0 }, inventory, stats }));

  it("fills empty ring cells with dead plants from stock, then gives 1 Zombud per adjacent dead plant and consumes them", () => {
    const s = online({ dead_plant: 3 }, { plantYieldUpgrade: 0.9 });
    inject(s, 1, "zombud", 5, 5, "spawned", grown);
    inject(s, 1, "dead_plant", 4, 4, "placed");
    inject(s, 1, "dead_plant", 6, 6, "placed");
    inject(s, 1, "wheat", 4, 5, "planted", { lockedEffects: [], stage: 99 });
    const r = engine.run(s, 1);
    const h = ofKind(r.events, "harvested").find((e) => e.kindId === "zombud")!;
    expect(h.drops.zombud).toBe(5); // 2 standing + 3 filled; not yield-scaled
    expect(r.state.inventory.dead_plant).toBe(0);
    expect(r.state.inventory.zombud).toBe(5);
    expect(r.state.summary.debtEvents).toBe(0);
    expect(r.state.plots[0].plants.some((p) => p.kindId === "dead_plant")).toBe(false);
    expect(plantAt(r.state, 1, 4, 5)?.kindId).toBe("wheat"); // occupied cells are never touched
    expect(ofKind(r.events, "removed").filter((e) => e.reason === "became a Zombud mob")).toHaveLength(5);
  });

  it("with a full ring in stock it yields 8; with none it yields no Zombud and records no debt", () => {
    const full = online({ dead_plant: 20 });
    inject(full, 1, "zombud", 5, 5, "spawned", grown);
    const rf = engine.run(full, 1);
    expect(ofKind(rf.events, "harvested")[0].drops.zombud).toBe(8);
    expect(rf.state.inventory.dead_plant).toBe(12);

    const none = online();
    inject(none, 1, "zombud", 5, 5, "spawned", grown);
    const rn = engine.run(none, 1);
    const h = ofKind(rn.events, "harvested")[0];
    expect(h.drops.zombud).toBeUndefined();
    expect(h.drops.pumpkin).toBeGreaterThan(0);
    expect(rn.state.summary.debtEvents).toBe(0);
  });

  it("the crop bundle drops once on breaking it, however many dead plants turn into mobs", () => {
    const bundle = (deadPlants: number) => {
      const s = online({ dead_plant: deadPlants });
      inject(s, 1, "zombud", 5, 5, "spawned", grown);
      const h = ofKind(engine.run(s, 1).events, "harvested").find((e) => e.kindId === "zombud")!;
      return { zombud: h.drops.zombud ?? 0, pumpkin: h.drops.pumpkin, wild_rose: h.drops.wild_rose };
    };
    const none = bundle(0);
    const full = bundle(8);
    expect(none.zombud).toBe(0);
    expect(full.zombud).toBe(8);
    expect(none.pumpkin).toBeGreaterThan(0);
    expect(full.pumpkin).toBe(none.pumpkin); // 8 mobs, still one bundle
    expect(full.wild_rose).toBe(none.wild_rose);
  });

  it("decay just leaves a Dead Plant: the adjacent dead plants stay and nothing drops", () => {
    // Timer-only: the Zombud never helped a mutation, so its minimum (6) would otherwise extend it.
    // A 6 h timer, so it decays within the 3 cycles.
    const eng = engineWith({ timerOnly: true, decayDays: { zombud: 0.25 } });
    const s = blank(NEVER_ACTIVE, {}, eng);
    inject(s, 1, "zombud", 5, 5, "spawned", grown, eng);
    inject(s, 1, "dead_plant", 4, 4, "placed", {}, eng);
    const r = eng.run(s, 3);
    expect(r.summary.decayed.zombud).toBe(1);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "dead_plant", isDeadPlant: true });
    expect(plantAt(r.state, 1, 4, 4)?.kindId).toBe("dead_plant");
    expect(r.state.inventory.zombud ?? 0).toBe(0);
  });
});

describe("Timestalk", () => {
  it("gives exactly 1 Timestalk per harvest, with no yield scaling", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = start(scenario([flow([step("a", layout())])], { seed, stats: { plantYieldUpgrade: 0.9 } }));
      inject(s, 1, "timestalk", 5, 5, "spawned", { stage: 14, lockedEffects: [], fullyGrownAtCycle: 0 });
      const h = ofKind(engine.run(s, 1).events, "harvested").find((e) => e.kindId === "timestalk")!;
      expect(h.drops.timestalk).toBe(1);
      expect(h.drops.cactus).toBeGreaterThan(0); // its crop bundle, once, on breaking it
    }
  });
});

describe("Noctilume", () => {
  it("advances only on ticks the player is online (they set the time); there is no day/night cycle", () => {
    const offline = blank();
    inject(offline, 1, "noctilume", 4, 4, "spawned");
    expect(plantAt(engine.run(offline, 6).state, 1, 4, 4)?.stage).toBe(1); // stuck at its spawn stage

    const everyOther = blank({ kind: "everyN", n: 2, offset: 0 });
    inject(everyOther, 1, "noctilume", 4, 4, "spawned");
    const r = engine.run(everyOther, 3);
    expect(ofKind(r.events, "advanced").map((e) => e.cycle)).toEqual([0, 2]);
  });
});

describe("Minigame mutations (PlantBoy Advance, Stoplight Petal, Phantomleaf) harvest like any spawn", () => {
  const everyCycle: ActivitySchedule = { kind: "everyN", n: 1, offset: 0 };
  const grown = (stage: number) => ({ stage, lockedEffects: [], fullyGrownAtCycle: 0 });

  it.each([
    ["plantboy_advance", 12],
    ["stoplight_petal", 12],
    ["phantomleaf", 15],
  ] as const)("%s is simply harvested by the online player", (kindId, stage) => {
    const s = blank(everyCycle);
    inject(s, 1, kindId, 5, 5, "spawned", grown(stage));
    const r = engine.run(s, 1, { retainEvents: "all" });
    expect(ofKind(r.events, "harvested").filter((e) => e.kindId === kindId)).toHaveLength(1);
    expect(ofKind(r.events, "destroyed")).toHaveLength(0);
    expect(r.summary.destroyed[kindId]).toBeUndefined();
    expect(plantAt(r.state, 1, 5, 5)).toBeUndefined();
  });
});
describe("Thunderling charge", () => {
  const everyCycle: ActivitySchedule = { kind: "everyN", n: 1, offset: 0 };
  const spawn = (s: ReturnType<typeof blank>) => inject(s, 1, "thunderling", 5, 5, "spawned");

  it("starts at 0 charge, gains 2000 per stage, and stops exactly at 16,000 (stage 9) and stays there", () => {
    const s = blank();
    const p = spawn(s);
    expect(p.stage).toBe(1);
    expect(p.gate.charge).toBe(0);

    const three = engine.run(s, 3).state;
    expect(plantAt(three, 1, 5, 5)).toMatchObject({ stage: 4 });
    expect(plantAt(three, 1, 5, 5)!.gate.charge).toBe(6000);

    const r = engine.run(s, 8, { retainEvents: "all" });
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 9 }); // 8 stages after spawning
    expect(plantAt(r.state, 1, 5, 5)!.gate.charge).toBe(16000);
    expect(ofKind(r.events, "growthBlocked")).toHaveLength(0);

    const later = engine.run(r.state, 10, { retainEvents: "all" });
    expect(plantAt(later.state, 1, 5, 5)).toMatchObject({ stage: 9 });
    expect(plantAt(later.state, 1, 5, 5)!.gate.charge).toBe(16000); // no charge above the max
    expect(ofKind(later.events, "growthBlocked").every((e) => e.kindId === "thunderling" && e.gate === "overcharged")).toBe(true);
    expect(ofKind(later.events, "growthBlocked")).toHaveLength(10);
    expect(ofKind(later.events, "advanced")).toHaveLength(0);
  });

  it("an overcharged Thunderling still counts as standing (a growth stop only)", () => {
    const s = blank();
    spawn(s);
    const halted = plantAt(engine.run(s, 12).state, 1, 5, 5)!;
    expect(halted.isDeadPlant).toBe(false);
    expect(halted.stage).toBe(9);
  });

  it("discharging resumes growth", () => {
    const s = blank();
    spawn(s);
    const halted = engine.run(s, 12).state;
    expect(plantAt(halted, 1, 5, 5)).toMatchObject({ stage: 9 });

    halted.scenario.settings.activity = everyCycle;
    const r = engine.run(halted, 1);
    expect(plantAt(r.state, 1, 5, 5)!.gate.charge).toBe(0); // the session discharged it
    const grown = engine.run(r.state, 1);
    expect(plantAt(grown.state, 1, 5, 5)).toMatchObject({ stage: 10 });
  });

  it("an online player discharges every session, so it never halts", () => {
    const s = blank(everyCycle);
    spawn(s);
    const r = engine.run(s, 7);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 8 });
    expect(plantAt(r.state, 1, 5, 5)!.gate.charge).toBe(0);
  });

  it("with the discharge toggle off it halts for good, even when the player is online", () => {
    const s = start(
      scenario([flow([step("a", layout())])], { activity: everyCycle, policies: { gateInteractions: { dischargeThunderling: false } } })
    );
    spawn(s);
    const r = engine.run(s, 20);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 9 });
    expect(plantAt(r.state, 1, 5, 5)!.gate.charge).toBe(16000);
  });

  it("the charge numbers are the fixed THUNDERLING_* constants", () => {
    expect(THUNDERLING_CHARGE_PER_STAGE).toBe(2000);
    expect(THUNDERLING_MAX_CHARGE).toBe(16000);
    const s = blank();
    spawn(s);
    const stagesToMax = THUNDERLING_MAX_CHARGE / THUNDERLING_CHARGE_PER_STAGE;
    const r = engine.run(s, stagesToMax + 3);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 1 + stagesToMax });
    expect(plantAt(r.state, 1, 5, 5)!.gate.charge).toBe(THUNDERLING_MAX_CHARGE);
  });

  it("the discharge policy defaults on and survives partial gateInteractions overrides (old saves get it)", () => {
    expect(DEFAULT_POLICIES.gateInteractions.dischargeThunderling).toBe(true);
    const merged = mergePolicies(DEFAULT_POLICIES, { gateInteractions: { wakeSnoozling: false } });
    expect(merged.gateInteractions).toMatchObject({ wakeSnoozling: false, dischargeThunderling: true });
  });

  it("a placed Thunderling does not grow, so it has no charge", () => {
    const s = blank();
    const p = inject(s, 1, "thunderling", 5, 5, "placed");
    expect(p.gate.charge).toBeUndefined();
    const r = engine.run(s, 5);
    expect(plantAt(r.state, 1, 5, 5)!.gate.charge).toBeUndefined();
  });
});