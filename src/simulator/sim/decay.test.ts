import { describe, expect, it } from "vitest";
import type { MutationCreditOrder, SimConfig } from "../config";
import { triggerHolds } from "../flow/triggers";
import type { PolicyOverrides } from "../flow/types";
import {
  engine,
  flow,
  inject,
  layout,
  NEVER_ACTIVE,
  NO_BASE_CROP_DECAY,
  plantAt,
  scenario,
  singlePlot,
  start,
  step,
  TIMER_ONLY,
} from "../testHelpers";
import type { CycleCtx } from "./context";
import { combinedRemaining, creditInputs, decayStatus, isPooled, minimumMet, wouldDecayWithin } from "./decay";
import { buildOccupancy } from "./plants";
import type { ActivitySchedule, PlantState, SimulationState, TimedEvent } from "./state";

// Minimum mutations: a plant decays only once its timer has run out AND it has
// helped create its minimum number of mutations; until then the timer is
// extended by 24 h. Fully grown plants of one kind on a plot that have helped
// at least once share the count.

/** The two things creditInputs reads from a cycle context: the config and the run's RNG. */
const fakeCtx = (s: SimulationState) => ({ state: s, config: s.scenario.settings.config }) as unknown as CycleCtx;

const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);

const ONLINE: ActivitySchedule = { kind: "everyN", n: 1, offset: 0 };
const H = 3600;
const DAY = 86400;
/** No base crops standing and Flora 0: cycles are exactly 4 h. */
const CYCLE = 4 * H;

/**
 * An empty plot with optional target slots: only slots roll, nobody loses
 * water, cycles are a fixed 4 h (no unique-crop speed-up), the player is away.
 * blankFillTo 1: an eligible target takes every roll.
 */
const blank = (
  opts: { slots?: [string, number, number][]; config?: Partial<SimConfig>; activity?: ActivitySchedule; policies?: PolicyOverrides; seed?: number } = {}
): SimulationState =>
  start(
    singlePlot(layout([], opts.slots ?? []), {
      seed: opts.seed,
      config: { spawnCells: "slotsOnly", waterLossMin: 0, waterLossMax: 0, uniqueCropGrowthPerCrop: 0, blankFillTo: 1, ...opts.config },
      activity: opts.activity ?? NEVER_ACTIVE,
      policies: opts.policies,
    })
  );

/** A fully grown base crop (latched already, so it counts as fully grown before the first tick). */
const grownCrop = (stage: number, patch: Partial<PlantState> = {}): Partial<PlantState> => ({ stage, lockedEffects: [], fullyGrownAtCycle: 0, ...patch });
const counters = (s: SimulationState, row: number, col: number) => {
  const p = plantAt(s, 1, row, col)!;
  return { timesMutated: p.timesMutated, mutatesRemaining: p.mutatesRemaining };
};

describe("counters", () => {
  it("every plant starts with timesMutated 0 and its kind's minimum (overrides applied); roots have none", () => {
    const s = blank({ config: { minimumMutationsOverrides: { carrot: 3, potato: "infinite", melon: "none" } } });
    expect(inject(s, 1, "wheat", 0, 0, "planted")).toMatchObject({ timesMutated: 0, mutatesRemaining: 12 });
    expect(inject(s, 1, "dead_plant", 0, 1, "placed")).toMatchObject({ timesMutated: 0, mutatesRemaining: 10 });
    expect(inject(s, 1, "fire", 0, 2, "placed")).toMatchObject({ timesMutated: 0, mutatesRemaining: null, decaySecondsRemaining: null });
    expect(inject(s, 1, "creambloom", 0, 3, "spawned")).toMatchObject({ timesMutated: 0, mutatesRemaining: 8 });
    expect(inject(s, 1, "magic_jellybean", 0, 4, "placed")).toMatchObject({ mutatesRemaining: "infinite" });
    expect(inject(s, 1, "godseed", 2, 0, "placed")).toMatchObject({ mutatesRemaining: null });
    expect(inject(s, 1, "carrot", 0, 5, "planted")).toMatchObject({ mutatesRemaining: 3 });
    expect(inject(s, 1, "potato", 0, 6, "planted")).toMatchObject({ mutatesRemaining: "infinite" });
    expect(inject(s, 1, "melon", 0, 7, "planted")).toMatchObject({ mutatesRemaining: null });
    expect(inject(s, 1, "devourer_root", 9, 9, "placed")).toMatchObject({ timesMutated: 0, mutatesRemaining: null, decaySecondsRemaining: null });
  });

  it("timers come from data.json: base crops and dead plants 3 days, fire / fermento never; decayDaysOverrides applies to any kind", () => {
    const s = blank({ config: { decayDaysOverrides: { wheat: 1, fire: 2, dead_plant: 0 } } });
    expect(inject(s, 1, "potato", 0, 0, "planted").decaySecondsRemaining).toBe(3 * DAY);
    expect(inject(s, 1, "wheat", 0, 1, "planted").decaySecondsRemaining).toBe(1 * DAY);
    expect(inject(s, 1, "fermento", 0, 2, "placed").decaySecondsRemaining).toBeNull();
    expect(inject(s, 1, "fire", 0, 3, "placed").decaySecondsRemaining).toBe(2 * DAY);
    expect(inject(s, 1, "dead_plant", 0, 4, "placed").decaySecondsRemaining).toBeNull();
    expect(inject(blank(), 1, "dead_plant", 0, 0, "placed").decaySecondsRemaining).toBe(3 * DAY);
  });
});

describe("credit at spawn", () => {
  /** A Dustgrain target (needs 2 wheat) at (4,5). Wheat ring cells in ring order: (3,4) (3,5) (3,6) (4,4) (4,6) (5,4) (5,5) (5,6). */
  const dustgrain = (config: Partial<SimConfig> = {}, seed?: number) => blank({ slots: [["dustgrain", 4, 5]], config, seed });

  it("credits only up to the required count, each plant once, in ring order by default", () => {
    const s = dustgrain();
    for (const [r, c] of [[3, 4], [3, 5], [3, 6], [5, 5]]) inject(s, 1, "wheat", r, c, "planted", grownCrop(8));
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["dustgrain"]);
    expect(counters(r.state, 3, 4)).toEqual({ timesMutated: 1, mutatesRemaining: 11 });
    expect(counters(r.state, 3, 5)).toEqual({ timesMutated: 1, mutatesRemaining: 11 });
    expect(counters(r.state, 3, 6)).toEqual({ timesMutated: 0, mutatesRemaining: 12 });
    expect(counters(r.state, 5, 5)).toEqual({ timesMutated: 0, mutatesRemaining: 12 });
    // The new spawn itself helped nothing yet.
    expect(counters(r.state, 4, 5)).toEqual({ timesMutated: 0, mutatesRemaining: 10 });
  });

  it("a multi-cell neighbour covering several ring cells is credited once and counts all its cells", () => {
    // Puffercloud (1x1) needs 2 Snoozling cells + 6 Do-not-eat-shroom. One 3x3 Snoozling at (2,2)
    // covers 2 of its ring cells ((3,4) and (4,4)), which is the whole Snoozling requirement.
    const s = blank({ slots: [["puffercloud", 4, 5]] });
    const snooze = inject(s, 1, "snoozling", 2, 2, "placed");
    const shrooms = [[3, 5], [3, 6], [4, 6], [5, 4], [5, 5], [5, 6]].map(([r, c]) => inject(s, 1, "do_not_eat_shroom", r, c, "placed"));
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["puffercloud"]);
    expect(plantAt(r.state, 1, 2, 2)).toMatchObject({ id: snooze.id, timesMutated: 1, mutatesRemaining: 7 });
    for (const q of shrooms) expect(plantAt(r.state, 1, q.row, q.col)).toMatchObject({ timesMutated: 1, mutatesRemaining: 7 });
  });

  it("a big neighbour covering more cells than needed gets one credit and fills the count: the next one isn't credited", () => {
    // White-box (creditInputs directly): a 1x1 spawn at (4,7) needing 2 Snoozling cells.
    // Its ring: (3,6) (3,7) (3,8) (4,6) (4,8) (5,6) (5,7) (5,8). A 3x3 Snoozling at (3,4) covers (3,6) (4,6) (5,6):
    // 3 cells, first in ring order - one credit, and the count is full. A second at (5,7) covers (5,7) (5,8): not credited.
    const s = blank();
    const a = inject(s, 1, "snoozling", 3, 4, "placed");
    const b = inject(s, 1, "snoozling", 5, 7, "placed");
    const spawned = inject(s, 1, "dustgrain", 4, 7, "spawned");
    const plot = s.plots[0];
    const occ = buildOccupancy(plot);
    const need = { ...engine.data.mutations.dustgrain, requirements: [{ crop: "snoozling", count: 2 }] };
    creditInputs(plot, occ, spawned, need, fakeCtx(s));
    expect(a).toMatchObject({ timesMutated: 1, mutatesRemaining: 7 });
    expect(b).toMatchObject({ timesMutated: 0, mutatesRemaining: 8 });
  });

  it("dried-out neighbours are not credited: the next wet ones are", () => {
    const s = dustgrain();
    inject(s, 1, "wheat", 3, 4, "planted", { stage: 2, water: -100 }); // dry: doesn't count toward requirements
    inject(s, 1, "wheat", 3, 5, "planted", grownCrop(8));
    inject(s, 1, "wheat", 3, 6, "planted", grownCrop(8));
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["dustgrain"]);
    expect(counters(r.state, 3, 4)).toEqual({ timesMutated: 0, mutatesRemaining: 12 });
    expect(counters(r.state, 3, 5).timesMutated).toBe(1);
    expect(counters(r.state, 3, 6).timesMutated).toBe(1);
  });

  it("a mutation without crop requirements (Lonelily) credits nobody", () => {
    // Lonelily needs an empty ring; a wheat two cells away is outside it and is never credited.
    const s = blank({ slots: [["lonelily", 5, 5]] });
    inject(s, 1, "wheat", 5, 7, "planted", grownCrop(8));
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["lonelily"]);
    expect(counters(r.state, 5, 7).timesMutated).toBe(0);
  });

  it("two spawns in one tick: each credits its own ring, a shared neighbour is credited by both", () => {
    // Two Dustgrain targets two cells apart share the wheat at (3,5).
    const s = blank({ slots: [["dustgrain", 4, 4], ["dustgrain", 4, 6]] });
    for (const [r, c] of [[3, 4], [3, 5], [3, 6], [3, 7]]) inject(s, 1, "wheat", r, c, "planted", grownCrop(8));
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["dustgrain", "dustgrain"]);
    // (4,4) credits (3,4) (3,5) in ring order; (4,6)'s ring is (3,5) (3,6) (3,7) ...: it credits (3,5) and (3,6).
    expect(counters(r.state, 3, 4).timesMutated).toBe(1);
    expect(counters(r.state, 3, 5).timesMutated).toBe(2);
    expect(counters(r.state, 3, 6).timesMutated).toBe(1);
    expect(counters(r.state, 3, 7).timesMutated).toBe(0);
    // The first Dustgrain is in the second's ring but isn't one of its requirements.
    expect(counters(r.state, 4, 4).timesMutated).toBe(0);
  });

  it("an earlier same-tick spawn that IS a requirement counts as a neighbour and is credited by the later one", () => {
    // Choconut (2 cocoa) at (4,5) spawns first (row-major) inside the ring of Chocoberry at (4,6),
    // which needs 6 Choconut + 2 Gloomgourd; the ring already holds 5 placed Choconut + 2 Gloomgourd.
    const s = blank({ slots: [["choconut", 4, 5], ["chocoberry", 4, 6]] });
    inject(s, 1, "cocoa_beans", 3, 4, "planted", grownCrop(6));
    inject(s, 1, "cocoa_beans", 5, 4, "planted", grownCrop(6));
    for (const [r, c] of [[3, 5], [3, 6], [3, 7], [4, 7], [5, 5]]) inject(s, 1, "choconut", r, c, "placed");
    inject(s, 1, "gloomgourd", 5, 6, "placed");
    inject(s, 1, "gloomgourd", 5, 7, "placed");
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["choconut", "chocoberry"]);
    // The fresh Choconut (4,5) was one of the Chocoberry's 6: credited, but still a 0-stage spawn fully grown.
    expect(counters(r.state, 4, 5)).toEqual({ timesMutated: 1, mutatesRemaining: 9 });
    for (const [rr, c] of [[3, 5], [3, 6], [3, 7], [4, 7], [5, 5], [5, 6], [5, 7]]) expect(counters(r.state, rr, c).timesMutated).toBe(1);
    // And the cocoa beans that made the Choconut were credited by it.
    expect(counters(r.state, 3, 4).timesMutated).toBe(1);
    expect(counters(r.state, 5, 4).timesMutated).toBe(1);
  });

  it("a Witherbloom spawn credits its 4 dead plants", () => {
    const s = blank({ slots: [["witherbloom", 4, 4]] });
    for (const [r, c] of [[3, 3], [3, 4], [3, 5], [4, 3]]) inject(s, 1, "dead_plant", r, c, "placed");
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "spawned").map((e) => e.mutationId)).toEqual(["witherbloom"]);
    for (const [rr, c] of [[3, 3], [3, 4], [3, 5], [4, 3]]) expect(counters(r.state, rr, c)).toEqual({ timesMutated: 1, mutatesRemaining: 9 });
  });
});

describe("credit order (mutationCreditOrder)", () => {
  /** 4 wheat around a Dustgrain target, with different counts left. Ring order: (3,4) (3,5) (3,6) (5,5). */
  const setup = (order: MutationCreditOrder, seed = 1, fifth: PlantState["mutatesRemaining"] = 5) => {
    const s = blank({ slots: [["dustgrain", 4, 5]], config: { mutationCreditOrder: order }, seed });
    inject(s, 1, "wheat", 3, 4, "planted", grownCrop(8, { mutatesRemaining: 12 }));
    inject(s, 1, "wheat", 3, 5, "planted", grownCrop(8, { mutatesRemaining: 3 }));
    inject(s, 1, "wheat", 3, 6, "planted", grownCrop(8, { mutatesRemaining: 9 }));
    inject(s, 1, "wheat", 5, 5, "planted", grownCrop(8, { mutatesRemaining: fifth }));
    return engine.run(s, 1).state;
  };
  const creditedCells = (s: SimulationState) =>
    s.plots[0].plants.filter((p) => p.kindId === "wheat" && p.timesMutated > 0).map((p) => `${p.row},${p.col}`);

  it("ringOrder (default): ascending cell index", () => {
    expect(engine.data && blank().scenario.settings.config.mutationCreditOrder).toBe("ringOrder");
    expect(creditedCells(setup("ringOrder"))).toEqual(["3,4", "3,5"]);
  });

  it("mostRemainingFirst spreads the use: the ones with the most left", () => {
    expect(creditedCells(setup("mostRemainingFirst"))).toEqual(["3,4", "3,6"]);
  });

  it("fewestRemainingFirst uses the same ones up: the ones with the fewest left", () => {
    expect(creditedCells(setup("fewestRemainingFirst"))).toEqual(["3,5", "5,5"]);
  });

  it("no minimum (N/A) and Infinite sort as never running out; ties fall back to ring order", () => {
    expect(creditedCells(setup("mostRemainingFirst", 1, null))).toEqual(["3,4", "5,5"]);
    expect(creditedCells(setup("mostRemainingFirst", 1, "infinite"))).toEqual(["3,4", "5,5"]);
    expect(creditedCells(setup("fewestRemainingFirst", 1, "infinite"))).toEqual(["3,5", "3,6"]);
    expect(creditedCells(setup("fewestRemainingFirst", 1, 3))).toEqual(["3,5", "5,5"]); // tie at 3: ring order
  });

  it("random: a seeded pick of exactly the required count, reproducible by seed", () => {
    const picks = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const a = setup("random", seed);
      expect(creditedCells(a)).toHaveLength(2);
      expect(JSON.stringify(setup("random", seed))).toBe(JSON.stringify(a)); // same seed, same result
      picks.add(creditedCells(a).join(" "));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("only random draws RNG: the other orders leave the stream untouched", () => {
    const rng = (order: MutationCreditOrder) => JSON.stringify(setup(order, 7).rng);
    expect(rng("mostRemainingFirst")).toBe(rng("ringOrder"));
    expect(rng("fewestRemainingFirst")).toBe(rng("ringOrder"));
    expect(rng("random")).not.toBe(rng("ringOrder"));
  });
});

describe("decay check", () => {
  it("a plant that never helped (timesMutated 0) never decays: its timer extends by 24h each time it runs out", () => {
    const s = blank();
    inject(s, 1, "chloronite", 5, 5, "placed"); // minimum 8, 3-day timer
    const r = engine.run(s, 36);
    // 3 days = 18 cycles: runs out on cycle 17, then every 6 cycles (24 h).
    const ext = ofKind(r.events, "decayExtended");
    expect(ext.map((e) => e.cycle)).toEqual([17, 23, 29, 35]);
    expect(ext[0]).toMatchObject({ kindId: "chloronite", row: 5, col: 5, mutatesRemaining: 8, combined: null });
    expect(r.summary.extended).toEqual({ chloronite: 4 });
    expect(r.summary.decayed.chloronite).toBeUndefined();
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "chloronite", timesMutated: 0, decaySecondsRemaining: DAY });
  });

  it("the extension length is configurable, and a long gap adds as many extensions as needed to get back above 0", () => {
    const s = blank({ config: { decayExtensionHours: 5 } });
    inject(s, 1, "chloronite", 5, 5, "placed", { decaySecondsRemaining: 1 });
    const r = engine.run(s, 1);
    // 1 - 4 h, + 5 h = ~1 h left: one extension.
    expect(ofKind(r.events, "decayExtended")).toHaveLength(1);
    expect(plantAt(r.state, 1, 5, 5)!.decaySecondsRemaining).toBeCloseTo(1 + H);

    const t = blank({ config: { decayExtensionHours: 1 } });
    inject(t, 1, "chloronite", 5, 5, "placed", { decaySecondsRemaining: 1 });
    const r2 = engine.run(t, 1);
    // 1 - 4 h is about -4 h: four 1 h extensions bring it back above 0, reported once.
    expect(ofKind(r2.events, "decayExtended")).toHaveLength(1);
    expect(r2.summary.extended).toEqual({ chloronite: 1 });
    expect(plantAt(r2.state, 1, 5, 5)!.decaySecondsRemaining).toBeCloseTo(1);
  });

  it("not pooled: decays once its own remaining is <= 0", () => {
    const s = blank();
    // Still-growing Startlevines (12 stages, minimum 6) are not pooled: (5,5) has met its minimum, (7,7) has 1 left.
    inject(s, 1, "startlevine", 5, 5, "spawned", { stage: 3, timesMutated: 6, mutatesRemaining: 0, decaySecondsRemaining: 1 });
    inject(s, 1, "startlevine", 7, 7, "spawned", { stage: 3, timesMutated: 5, mutatesRemaining: 1, decaySecondsRemaining: 1 });
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "decayed").map((e) => [e.row, e.col])).toEqual([[5, 5]]);
    expect(ofKind(r.events, "decayExtended").map((e) => [e.row, e.col, e.combined])).toEqual([[7, 7, null]]);
  });
});

describe("pool", () => {
  it("a growing plant isn't pooled, even after helping; it joins once fully grown", () => {
    const s = blank({ slots: [["dustgrain", 4, 5]] });
    inject(s, 1, "wheat", 3, 4, "planted", { stage: 4 });
    inject(s, 1, "wheat", 3, 5, "planted", { stage: 5 });
    const r = engine.run(s, 1);
    const plot = r.state.plots[0];
    const growing = plantAt(r.state, 1, 3, 4)!;
    expect(growing).toMatchObject({ timesMutated: 1, mutatesRemaining: 11, stage: 5 });
    expect(isPooled(growing)).toBe(false);
    expect(decayStatus(plot, growing)).toEqual({ timesMutated: 1, mutatesRemaining: 11, pooled: false, combined: null, minimumMet: false });
    expect(combinedRemaining(plot, "wheat")).toBeNull();

    const grown = engine.run(r.state, 3).state; // stages 6, 7, 8: fully grown on the 3rd tick
    const both = grown.plots[0].plants.filter((p) => p.kindId === "wheat");
    expect(both.every((p) => p.stage === 8 && isPooled(p))).toBe(true);
    expect(combinedRemaining(grown.plots[0], "wheat")).toBe(22);
    expect(decayStatus(grown.plots[0], both[0])).toMatchObject({ pooled: true, combined: 22, minimumMet: false });
  });

  it("pooled plants share their count, which can go negative; then all of them decay, even one with its own left", () => {
    const s = blank();
    const a = inject(s, 1, "wheat", 3, 4, "planted", grownCrop(8, { timesMutated: 14, mutatesRemaining: -2, decaySecondsRemaining: 1 }));
    const b = inject(s, 1, "wheat", 3, 6, "planted", grownCrop(8, { timesMutated: 11, mutatesRemaining: 1, decaySecondsRemaining: 1 }));
    expect(minimumMet(b, -1)).toBe(true);
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "decayed").map((e) => e.plantId).sort()).toEqual([a.id, b.id].sort());
    expect(r.summary.decayed.wheat).toBe(2);
  });

  it("a newly placed plant joins only after helping once and fully grown, bringing its own remaining: it can lift the pool above 0...", () => {
    // Pool before: 0 + -1 = -1, both timers run out this tick. The Dustgrain spawn this tick credits
    // the newcomer (3,4) (ring order first) and (3,5): newcomer 12 -> 11 joins, (3,5) 0 -> -1.
    // Pool at the decay phase: 11 - 1 - 1 = 9 > 0: nobody decays, both are extended.
    const s = blank({ slots: [["dustgrain", 4, 5]] });
    inject(s, 1, "wheat", 3, 4, "planted", grownCrop(8));
    inject(s, 1, "wheat", 3, 5, "planted", grownCrop(8, { timesMutated: 12, mutatesRemaining: 0, decaySecondsRemaining: 1 }));
    inject(s, 1, "wheat", 3, 6, "planted", grownCrop(8, { timesMutated: 13, mutatesRemaining: -1, decaySecondsRemaining: 1 }));
    const before = structuredClone(s.plots[0]);
    expect(combinedRemaining(before, "wheat")).toBe(-1); // the newcomer hasn't helped yet: not in the pool
    const r = engine.run(s, 1);
    expect(counters(r.state, 3, 4)).toEqual({ timesMutated: 1, mutatesRemaining: 11 });
    expect(combinedRemaining(r.state.plots[0], "wheat")).toBe(9);
    expect(ofKind(r.events, "decayed")).toHaveLength(0);
    expect(ofKind(r.events, "decayExtended").map((e) => [e.col, e.mutatesRemaining, e.combined])).toEqual([
      [5, -1, 9],
      [6, -1, 9],
    ]);
  });

  it("...or not, when it has little left of its own", () => {
    const s = blank({ slots: [["dustgrain", 4, 5]] });
    inject(s, 1, "wheat", 3, 4, "planted", grownCrop(8, { mutatesRemaining: 1 })); // never helped, 1 left
    inject(s, 1, "wheat", 3, 5, "planted", grownCrop(8, { timesMutated: 12, mutatesRemaining: 0, decaySecondsRemaining: 1 }));
    inject(s, 1, "wheat", 3, 6, "planted", grownCrop(8, { timesMutated: 13, mutatesRemaining: -1, decaySecondsRemaining: 1 }));
    const r = engine.run(s, 1);
    // Pool: 0 - 1 - 1 = -2.
    expect(ofKind(r.events, "decayed").map((e) => e.col)).toEqual([5, 6]);
    expect(plantAt(r.state, 1, 3, 4)).toMatchObject({ kindId: "wheat", timesMutated: 1, mutatesRemaining: 0 });
  });

  it("the pool is snapshotted once per tick: pooled plants whose timers run out together decay together", () => {
    // Pool -3 + 2 = -1 for both. Without a snapshot the second would see +2 after the first leaves.
    const together = blank();
    inject(together, 1, "wheat", 3, 4, "planted", grownCrop(8, { timesMutated: 15, mutatesRemaining: -3, decaySecondsRemaining: 1 }));
    inject(together, 1, "wheat", 3, 6, "planted", grownCrop(8, { timesMutated: 10, mutatesRemaining: 2, decaySecondsRemaining: 1 }));
    const r = engine.run(together, 1);
    expect(ofKind(r.events, "decayed").map((e) => e.col)).toEqual([4, 6]);

    // A tick apart, the second sees the pool without the first (+2): it is extended.
    const apart = blank();
    inject(apart, 1, "wheat", 3, 4, "planted", grownCrop(8, { timesMutated: 15, mutatesRemaining: -3, decaySecondsRemaining: 1 }));
    inject(apart, 1, "wheat", 3, 6, "planted", grownCrop(8, { timesMutated: 10, mutatesRemaining: 2, decaySecondsRemaining: CYCLE + 1 }));
    const r2 = engine.run(apart, 2);
    expect(ofKind(r2.events, "decayed").map((e) => [e.cycle, e.col])).toEqual([[0, 4]]);
    expect(ofKind(r2.events, "decayExtended").map((e) => [e.cycle, e.col, e.combined])).toEqual([[1, 6, 2]]);
  });

  it("met during an extension: it decays when that extension runs out, not at once", () => {
    // A pumpkin that helped once (1 left) runs out on cycle 0 and is extended 24 h (6 cycles).
    // On cycle 1 a melon arrives, a Gloomgourd spawns and credits the pumpkin: 0 left, met.
    const s = blank({ slots: [["gloomgourd", 4, 5]] });
    inject(s, 1, "pumpkin", 4, 4, "planted", grownCrop(11, { timesMutated: 1, mutatesRemaining: 1, decaySecondsRemaining: CYCLE }));
    const first = engine.run(s, 1);
    expect(ofKind(first.events, "decayExtended").map((e) => e.kindId)).toEqual(["pumpkin"]);
    inject(first.state, 1, "melon", 4, 6, "planted", grownCrop(11));
    const r = engine.run(first.state, 8);
    expect(ofKind(r.events, "spawned").map((e) => [e.cycle, e.mutationId])).toEqual([[1, "gloomgourd"]]);
    expect(ofKind(r.events, "decayed").map((e) => [e.cycle, e.kindId])).toEqual([[6, "pumpkin"]]);
    expect(ofKind(r.events, "decayExtended")).toHaveLength(0);
    expect(plantAt(r.state, 1, 4, 4)).toMatchObject({ kindId: "dead_plant", isDeadPlant: true });
  });
});

describe("kinds without a minimum or without a timer", () => {
  it("N/A (Stoplight Petal, Godseed): timer-only decay, never extended", () => {
    const s = blank();
    inject(s, 1, "stoplight_petal", 0, 0, "placed"); // 5 days = 30 cycles
    inject(s, 1, "godseed", 5, 5, "placed"); // 10 days = 60 cycles
    const r = engine.run(s, 60);
    expect(ofKind(r.events, "decayed").map((e) => [e.cycle, e.kindId])).toEqual([
      [29, "stoplight_petal"],
      [59, "godseed"],
    ]);
    expect(ofKind(r.events, "decayExtended").filter((e) => e.kindId !== "dead_plant")).toHaveLength(0);
  });

  it("Infinite (Magic Jellybean) never decays, even with a decay timer override", () => {
    const s = blank({ config: { decayDaysOverrides: { magic_jellybean: 1 } } });
    inject(s, 1, "magic_jellybean", 5, 5, "placed", { timesMutated: 50 });
    const r = engine.run(s, 60);
    expect(r.summary.decayed.magic_jellybean).toBeUndefined();
    expect(r.summary.extended.magic_jellybean).toBe(10); // runs out every day
    expect(ofKind(r.events, "decayExtended")[0]).toMatchObject({ mutatesRemaining: "infinite", combined: "infinite" });
    expect(plantAt(r.state, 1, 5, 5)?.kindId).toBe("magic_jellybean");
  });

  it("no timer (Fleshtrap: decay 0, minimum 6) never decays and never needs extending", () => {
    const s = blank();
    const p = inject(s, 1, "fleshtrap", 5, 5, "placed", { timesMutated: 20, mutatesRemaining: -14 });
    expect(p.decaySecondsRemaining).toBeNull();
    const r = engine.run(s, 200, { retainEvents: "none" });
    expect(r.summary.decayed.fleshtrap).toBeUndefined();
    expect(r.summary.extended.fleshtrap).toBeUndefined();
    expect(plantAt(r.state, 1, 5, 5)?.kindId).toBe("fleshtrap");
  });
});

describe("Dead Plants", () => {
  /** A layout dead plant at (5,5) that has already helped its 10 mutations: it decays when its 3-day timer runs out (cycle 17). */
  const used = (inventory: Record<string, number>, activity: ActivitySchedule = ONLINE) => {
    const s = start(singlePlot(layout([["dead_plant", 5, 5]]), { config: { spawnCells: "slotsOnly" }, inventory, activity }));
    Object.assign(plantAt(s, 1, 5, 5)!, { timesMutated: 10, mutatesRemaining: 0 });
    return s;
  };

  it("a decayed dead plant leaves nothing: the cell goes empty", () => {
    const r = engine.run(used({}, NEVER_ACTIVE), 18);
    expect(ofKind(r.events, "decayed")).toMatchObject([{ cycle: 17, kindId: "dead_plant", row: 5, col: 5 }]);
    expect(r.summary.decayed.dead_plant).toBe(1);
    expect(r.summary.perPlot["1"].decayed).toBe(1);
    expect(plantAt(r.state, 1, 5, 5)).toBeUndefined();
    expect(r.state.inventory.dead_plant ?? 0).toBe(0); // nothing to clear, nothing credited
  });

  it("the player re-places the layout's dead plant from inventory at the next session (fresh counters)", () => {
    const r = engine.run(used({ dead_plant: 1 }), 18);
    expect(r.summary.decayed.dead_plant).toBe(1);
    expect(r.state.inventory.dead_plant).toBe(0);
    expect(r.summary.replacements).toBe(1);
    expect(r.summary.placedItems.dead_plant).toBe(1);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "dead_plant", origin: "placed", timesMutated: 0, mutatesRemaining: 10, decaySecondsRemaining: 3 * DAY });
    expect(ofKind(r.events, "placed").filter((e) => e.kindId === "dead_plant" && e.replacement)).toHaveLength(1);
  });

  it("with no dead plant in stock, re-placing it is debt", () => {
    const r = engine.run(used({}), 18);
    expect(r.state.debts[0]).toMatchObject({ cycle: 17, item: "dead_plant", row: 5, col: 5, needed: 1, available: 0 });
    expect(plantAt(r.state, 1, 5, 5)).toBeUndefined();
  });

  it("a Dead Plant left behind by decay has a timer and fresh counters, and never decays on its own", () => {
    // Timer-only Chloronite, so it decays on time (cycle 17) and leaves a Dead Plant.
    const s = blank({ config: { minimumMutationsOverrides: { chloronite: "none" } } });
    inject(s, 1, "chloronite", 5, 5, "placed");
    const r = engine.run(s, 18);
    expect(r.summary.decayed.chloronite).toBe(1);
    const dead = plantAt(r.state, 1, 5, 5)!;
    expect(dead).toMatchObject({ kindId: "dead_plant", isDeadPlant: true, timesMutated: 0, mutatesRemaining: 10, decaySecondsRemaining: 3 * DAY });
    expect(decayStatus(r.state.plots[0], dead)).toMatchObject({ pooled: false, minimumMet: false });
    const later = engine.run(r.state, 200);
    expect(later.summary.decayed.dead_plant).toBeUndefined();
    expect(later.summary.extended.dead_plant).toBeGreaterThan(0);
    expect(plantAt(later.state, 1, 5, 5)).toMatchObject({ id: dead.id, kindId: "dead_plant" });
  });

  it("a Witherbloom setup uses up its dead plants over time: each decays only after helping 10 times, and is re-placed", () => {
    // 4 layout dead plants around a Witherbloom target (needs exactly 4): every spawn credits all 4.
    const sc = singlePlot(layout([["dead_plant", 3, 3], ["dead_plant", 3, 4], ["dead_plant", 3, 5], ["dead_plant", 4, 3]], [["witherbloom", 4, 4]]), {
      config: { spawnCells: "slotsOnly" },
      inventory: { dead_plant: 60 },
      seed: 3,
    });
    const r = engine.run(start(sc), 400, { retainEvents: "none" });
    const spawned = r.summary.spawned.witherbloom ?? 0;
    expect(spawned).toBeGreaterThan(30);
    expect(r.summary.decayed.dead_plant).toBeGreaterThanOrEqual(4);
    // A plant decays only once its pool's 10 credits each are used up: 4 credits per spawn.
    expect(r.summary.decayed.dead_plant).toBeLessThanOrEqual((4 * spawned) / 10);
    expect(r.state.ledger.dead_plant.consumed).toBe(r.summary.decayed.dead_plant);
    expect(r.summary.debtEvents).toBe(0);
    expect(r.summary.extended.dead_plant).toBeGreaterThan(0); // timers ran out before the 10th help
  });

  it("a pure Zombud farm: every harvest turns the ring dead plants into Zombud mobs; they are re-placed and never decay", () => {
    // Zombud needs 4 dead plants, 2 Cindershade, 2 Fleshtrap. Ring of (4,4): rows 3-5, cols 3-5.
    const plants: [string, number, number][] = [
      ["dead_plant", 3, 3],
      ["dead_plant", 3, 4],
      ["dead_plant", 3, 5],
      ["dead_plant", 4, 3],
      ["cindershade", 4, 5],
      ["cindershade", 5, 3],
      ["fleshtrap", 5, 4],
      ["fleshtrap", 5, 5],
    ];
    const sc = singlePlot(layout(plants, [["zombud", 4, 4]]), {
      config: { spawnCells: "slotsOnly" },
      inventory: { dead_plant: 400, cindershade: 50 },
      seed: 11,
    });
    let s = start(sc);
    const harvests: number[] = [];
    let mobs = 0;
    let maxHelped = 0;
    for (let i = 0; i < 600; i++) {
      const r = engine.run(s, 1);
      s = r.state;
      for (const e of ofKind(r.events, "harvested")) if (e.kindId === "zombud") harvests.push(e.drops.zombud ?? 0);
      mobs += ofKind(r.events, "removed").filter((e) => e.reason === "became a Zombud mob").length;
      for (const p of s.plots[0].plants) if (p.kindId === "dead_plant") maxHelped = Math.max(maxHelped, p.timesMutated);
    }
    expect(harvests.length).toBeGreaterThan(5);
    // 1 Zombud per ring dead plant: the 4 layout ones (a Cindershade that decayed into a Dead Plant in the ring would make a 5th).
    expect(harvests.every((n) => n >= 4)).toBe(true);
    expect(mobs).toBe(harvests.reduce((a, b) => a + b, 0));
    // Consumed by the harvest, never decayed; the player re-places them from stock.
    expect(s.summary.decayed.dead_plant).toBeUndefined();
    expect(s.ledger.dead_plant.consumed).toBeGreaterThanOrEqual(4 * harvests.length);
    // The 4 dead plants also let Witherbloom spawn as a rival (credited too), but each Zombud
    // harvest consumes them before they reach their minimum of 10.
    expect(s.summary.rivals.spawned).toBeGreaterThan(0);
    expect(maxHelped).toBeGreaterThanOrEqual(1);
    expect(maxHelped).toBeLessThan(10);
  });
});

describe("Turtlellini -> Shellfruit", () => {
  it("the Shellfruit made by a second blast gets fresh counters", () => {
    const s = blank();
    inject(s, 1, "turtlellini", 5, 5, "spawned", { gate: { exploded: 1 }, timesMutated: 3, mutatesRemaining: 7 });
    // A placed, primed Blastberry next to it that has met its minimum decays this tick and explodes.
    inject(s, 1, "blastberry", 5, 6, "placed", { gate: { primed: true }, timesMutated: 8, mutatesRemaining: 0, decaySecondsRemaining: 1 });
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "exploded")).toHaveLength(1);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "shellfruit", timesMutated: 0, mutatesRemaining: 6, decaySecondsRemaining: 3 * DAY });
  });
});

describe("predictions use the current counters", () => {
  /** A fully grown spawned Startlevine (minimum 6) whose timer runs out before the next session (online every cycle). */
  const nearlyOut = (patch: Partial<PlantState>, config: Partial<SimConfig> = {}) => {
    const s = blank({ activity: ONLINE, policies: { spawnedHarvest: "beforeDecay" }, config });
    inject(s, 1, "startlevine", 5, 5, "spawned", { stage: 12, lockedEffects: [], fullyGrownAtCycle: 0, water: 100, decaySecondsRemaining: 1.5 * CYCLE, ...patch });
    return s;
  };
  const harvested = (s: SimulationState) => ofKind(engine.run(s, 1).events, "harvested").map((e) => e.kindId);

  it("'before decay' doesn't harvest a plant that would only be extended", () => {
    expect(harvested(nearlyOut({}))).toEqual([]);
    const r = engine.run(nearlyOut({}), 3);
    expect(ofKind(r.events, "decayExtended").map((e) => e.kindId)).toEqual(["startlevine"]);
    expect(ofKind(r.events, "harvested")).toHaveLength(0);
    expect(plantAt(r.state, 1, 5, 5)?.kindId).toBe("startlevine");
  });

  it("...but does harvest it once its minimum is met (or timer-only)", () => {
    expect(harvested(nearlyOut({ timesMutated: 6, mutatesRemaining: 0 }))).toEqual(["startlevine"]);
    expect(harvested(nearlyOut({}, TIMER_ONLY))).toEqual(["startlevine"]);
  });

  it("wouldDecayWithin needs both: the timer runs out in time AND the minimum is met", () => {
    const s = blank();
    const plot = s.plots[0];
    const fresh = inject(s, 1, "chloronite", 1, 1, "placed", { decaySecondsRemaining: 100 });
    const used = inject(s, 1, "chloronite", 3, 3, "placed", { decaySecondsRemaining: 100, timesMutated: 8, mutatesRemaining: 0 });
    const never = inject(s, 1, "fire", 5, 5, "placed");
    expect(wouldDecayWithin(plot, fresh, 1000)).toBe(false); // never helped
    expect(wouldDecayWithin(plot, used, 1000)).toBe(true);
    expect(wouldDecayWithin(plot, used, 50)).toBe(false); // not in time
    expect(wouldDecayWithin(plot, used, Infinity)).toBe(true);
    expect(wouldDecayWithin(plot, never, Infinity)).toBe(false); // no timer
  });

  it("decayImminent ignores a plant that would just be extended", () => {
    const f = flow([step("a", layout([["chloronite", 5, 5]]), [{ kind: "decayImminent", withinCycles: 2 }]), step("b", layout())], false);
    const held = engine.run(start(scenario([f], { config: { spawnCells: "slotsOnly" }, inventory: { chloronite: 5 } })), 40);
    expect(ofKind(held.events, "stepChanged")).toHaveLength(0);
    expect(ofKind(held.events, "decayExtended").length).toBeGreaterThan(0);

    const moved = engine.run(start(scenario([f], { config: { spawnCells: "slotsOnly", ...TIMER_ONLY } })), 40);
    // Timer-only: 18 cycles to decay; "within 2 cycles" holds from the end of cycle 15.
    expect(ofKind(moved.events, "stepChanged").map((e) => e.cycle)).toEqual([15]);
  });

  it("decayImminent never counts dead plants", () => {
    const s = blank();
    const plot = s.plots[0];
    inject(s, 1, "dead_plant", 5, 5, "placed", { timesMutated: 10, mutatesRemaining: 0, decaySecondsRemaining: 1 });
    const view = { plot, runner: s.flows[0], inventory: s.inventory, cycleSeconds: CYCLE };
    expect(wouldDecayWithin(plot, plot.plants[0], CYCLE)).toBe(true);
    expect(triggerHolds({ kind: "decayImminent", withinCycles: 5 }, view)).toBe(false);
  });
});

describe("long runs", () => {
  it("a long, busy run stays splittable and deterministic under every credit order", () => {
    for (const order of ["ringOrder", "mostRemainingFirst", "fewestRemainingFirst", "random"] as const) {
      const sc = singlePlot(
        layout(
          [
            ["wheat", 3, 4],
            ["wheat", 3, 5],
            ["wheat", 3, 6],
            ["wheat", 5, 5],
            ["pumpkin", 6, 6],
            ["melon", 6, 8],
          ],
          [
            ["dustgrain", 4, 5],
            ["gloomgourd", 6, 7],
          ]
        ),
        { config: { spawnCells: "slotsOnly", mutationCreditOrder: order, ...NO_BASE_CROP_DECAY }, seed: 5 }
      );
      const s = start(sc);
      const whole = engine.run(s, 120).state;
      const split = engine.run(engine.run(s, 47).state, 73).state;
      expect(JSON.stringify(split)).toBe(JSON.stringify(whole));
      expect(whole.plots[0].plants.some((p) => p.timesMutated > 0)).toBe(true);
    }
  });
});
