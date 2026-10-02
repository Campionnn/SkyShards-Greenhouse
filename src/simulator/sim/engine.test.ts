import { describe, expect, it } from "vitest";
import {
  engine,
  inject,
  layout,
  NEVER_ACTIVE,
  plantAt,
  singlePlot,
  start,
  runCycles,
  TIMER_ONLY,
} from "../testHelpers";
import { cycleSeconds } from "../growth/clock";
import { CONFIG_META, DEFAULT_CONFIG } from "../config";
import type { SimulationState, TimedEvent } from "./state";

// #N labels number the engine test vectors. Rules checked here: placed
// mutation items go in fully grown, are never harvested and drop nothing;
// player actions happen only on active cycles; every empty cell rolls.

const json = (s: SimulationState) => JSON.stringify(s);
const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);

/** Pumpkin + melon either side of an empty Gloomgourd target; only the target rolls. */
const gloomLayout = () => layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]);
const slotsOnly = { spawnCells: "slotsOnly" as const };
/** Cycle length with default stats and `unique` unique crop groups standing. */
const cycleLen = (unique: number) => cycleSeconds({ cropGrowth: 0, speedAttribute: 0, growthUpgradeTier: 0 }, unique, DEFAULT_CONFIG);
/** Yield with default stats: only the unique-crop bonus (+2.5% per group) applies. */
const yieldOf = (base: number, unique: number) => Math.floor(base * (1 + 0.025 * unique) + 1e-9);

describe("death and decay have no freezing mode", () => {
  it("has no freeze setting or toggle and creates plants without frozen state", () => {
    expect(DEFAULT_CONFIG).not.toHaveProperty("freezeInsteadOfKill");
    expect(CONFIG_META.some((entry) => /freeze/i.test(entry.key))).toBe(false);
    const s = start(singlePlot(layout([["wheat", 4, 4]]), { config: slotsOnly }));
    expect(s.plots[0].plants[0]).not.toHaveProperty("frozen");
  });

  it("decay kills a plant while the player is away", () => {
    const s = start(singlePlot(layout([["wheat", 4, 4]]), {
      activity: NEVER_ACTIVE,
      // Timer-only: the wheat never helped a mutation, so its minimum would otherwise extend it.
      config: { ...slotsOnly, ...TIMER_ONLY, waterLossMin: 3, waterLossMax: 3 },
    }));
    s.plots[0].plants[0].decaySecondsRemaining = 1;
    const result = engine.run(s, 1);
    expect(result.events.some((e) => e.kind === "decayed")).toBe(true);
    expect(plantAt(result.state, 1, 4, 4)).toMatchObject({ kindId: "dead_plant", isDeadPlant: true });
    expect(plantAt(result.state, 1, 4, 4)).not.toHaveProperty("frozen");
  });

  it("thirst halts a plant while the player is away: it stays standing, dried out, and doesn't grow", () => {
    const s = start(singlePlot(layout([["wheat", 4, 4]]), {
      activity: NEVER_ACTIVE,
      config: { ...slotsOnly, waterLossMin: 3, waterLossMax: 3 },
    }));
    const p = s.plots[0].plants[0];
    p.water = s.scenario.settings.config.haltWater;
    const result = engine.run(s, 3);
    expect(result.events.some((e) => e.kind === "growthBlocked" && e.gate === "dry")).toBe(true);
    expect(result.summary.decayed.wheat).toBeUndefined();
    expect(plantAt(result.state, 1, 4, 4)).toMatchObject({ kindId: "wheat", isDeadPlant: false, stage: p.stage, water: p.water });
    expect(plantAt(result.state, 1, 4, 4)).not.toHaveProperty("frozen");
  });
});

describe("vertical slice: one plot, one mutation, spawned and harvested", () => {
  it("a pumpkin+melon ring spawns a Gloomgourd, fully grown at once and harvested the same cycle into the shared inventory", () => {
    let s = start(singlePlot(gloomLayout(), { config: slotsOnly }));
    let found: ReturnType<typeof engine.run> | null = null;
    for (let i = 0; i < 100 && !found; i++) {
      const r = engine.run(s, 1);
      s = r.state;
      if (ofKind(r.events, "spawned").length) found = r;
    }
    if (!found) throw new Error("no Gloomgourd spawned");
    const next = found;
    const spawned = ofKind(next.events, "spawned")[0];
    // A 0-stage mutation is fully grown the tick it spawns: it latches then, and the
    // player's session in that same cycle harvests it.
    const grown = ofKind(next.events, "fullyGrown");
    expect(grown.map((e) => e.plantId)).toEqual([spawned.plantId]);
    expect(grown[0].cycle).toBe(spawned.cycle);
    const harvested = ofKind(next.events, "harvested");
    expect(harvested).toHaveLength(1);
    expect(harvested[0].cycle).toBe(spawned.cycle);
    expect(plantAt(s, 1, 4, 5)).toBeUndefined();
    // The item plus its base-crop bundle reach the inventory; the bundle is revenue.
    // Pumpkin + melon standing = 2 unique crop groups = +5% yield.
    const pumpkin = yieldOf(34, 2);
    const melon = yieldOf(160, 2);
    // Item count = 1 x yield sum 1.05: one guaranteed, 5% chance of a second.
    expect([1, 2]).toContain(next.state.inventory.gloomgourd);
    expect(next.state.inventory.pumpkin).toBe(pumpkin);
    expect(next.state.inventory.melon).toBe(melon);
    expect(next.summary.revenue.crops).toBe(pumpkin * 10 + melon * 2);
    expect(next.summary.harvested.gloomgourd).toBe(1);
  });

  it("#1 the player acts after the game tick: a harvested cell re-rolls only on the next cycle", () => {
    let s = start(singlePlot(gloomLayout(), { config: slotsOnly, seed: 3 }));
    let harvests = 0;
    for (let i = 0; i < 300; i++) {
      const r = engine.run(s, 1);
      s = r.state;
      const h = ofKind(r.events, "harvested");
      const sp = ofKind(r.events, "spawned");
      if (h.length) harvests += 1;
      // Spawn rolls in the game tick, harvest in the later player session.
      if (h.length && sp.length) expect(r.events.indexOf(sp[0])).toBeLessThan(r.events.indexOf(h[0]));
      if (h.length) expect(plantAt(s, 1, 4, 5)).toBeUndefined();
    }
    expect(harvests).toBeGreaterThan(0);
  });

  it("the player's session comes after the game tick of every plot", () => {
    const sc = singlePlot(gloomLayout(), { config: slotsOnly });
    sc.plots.push({ id: 2, flow: structuredClone(sc.plots[0].flow) });
    const r = engine.run(start(sc), 1);
    const kinds = r.events.map((e) => `${e.plotId}:${e.kind}`);
    const firstSession = kinds.findIndex((k) => k.endsWith(":playerSession"));
    expect(kinds[firstSession]).toBe("1:playerSession");
    // Nothing from either plot's game tick happens after the first session starts.
    const tickKinds = new Set(["advanced", "fullyGrown", "spawned", "decayed", "driedOut", "teleported", "rootSpread"]);
    expect(r.events.slice(firstSession).some((e) => tickKinds.has(e.kind))).toBe(false);
  });
});

describe("run: batched and stepped are one path", () => {
  const busy = () =>
    singlePlot(layout([["pumpkin", 4, 4], ["melon", 4, 6], ["wheat", 2, 2], ["wheat", 2, 3], ["cocoa_beans", 7, 7]]), { seed: 42 });

  it("#21 run(s,100) equals run(s,50) then run(result,50), byte for byte", () => {
    const s = start(busy());
    const whole = engine.run(s, 100);
    const half = engine.run(engine.run(s, 50).state, 50);
    expect(json(half.state)).toBe(json(whole.state));
  });

  it("#22 run(s,100) equals 100 successive run(_,1) calls", () => {
    const s = start(busy());
    expect(json(runCycles(s, 100).state)).toBe(json(engine.run(s, 100).state));
  });

  it("#23 a stepped result feeds straight back in; events carry cycle and plot", () => {
    const s = start(busy());
    const r = engine.run(s, 1);
    expect(r.state.cycle).toBe(1);
    expect(engine.run(r.state, 1).state.cycle).toBe(2);
    for (const e of r.events) expect(e).toMatchObject({ cycle: 0, plotId: 1 });
  });

  it("#24 summary is cumulative across calls and equals the sum of per-step deltas", () => {
    const s = start(busy());
    const { state, results } = runCycles(s, 30);
    const batch = engine.run(s, 30);
    expect(state.summary.profit).toBe(batch.summary.profit);
    let prev = 0;
    let sum = 0;
    for (const r of results) {
      sum += r.summary.profit - prev;
      prev = r.summary.profit;
    }
    expect(sum).toBe(batch.summary.profit);
    expect(batch.summary.cyclesRun).toBe(30);
  });

  it("#25 revenue categories and costs reconcile to profit exactly", () => {
    const { summary } = engine.run(start(busy()), 200);
    const revenue = summary.revenue.crops + summary.revenue.rareDrops + summary.revenue.rareCrops + summary.revenue.mutationItems;
    expect(summary.profit).toBe(revenue - summary.costs.replacements - summary.costs.supplies);
    expect(summary.coinsRealised).toBe(revenue);
  });

  it("#27 run(s,0) is a no-op", () => {
    const s = start(busy());
    const r = engine.run(s, 0);
    expect(json(r.state)).toBe(json(s));
    expect(r.cyclesRun).toBe(0);
  });

  it("#18/#19 deterministic, and never mutates its input", () => {
    const s = start(busy());
    const before = json(s);
    const a = engine.run(s, 60);
    const b = engine.run(s, 60);
    expect(json(s)).toBe(before);
    expect(json(a.state)).toBe(json(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it("#28 an aborted run returns a consistent state that continues like an uninterrupted one", () => {
    const s = start(busy());
    const controller = new AbortController();
    let calls = 0;
    const partial = engine.run(s, 100, {
      progressIntervalMs: 0,
      signal: controller.signal,
      onProgress: () => {
        if (++calls === 37) controller.abort();
      },
    });
    expect(partial.truncated).toBe(true);
    expect(partial.cyclesRun).toBe(37);
    const rest = engine.run(partial.state, 100 - partial.cyclesRun);
    expect(json(rest.state)).toBe(json(engine.run(s, 100).state));
  });

  it("#29 progress is throttled and its last call reports the final cycle", () => {
    const seen: number[] = [];
    engine.run(start(busy()), 50, { progressIntervalMs: 1e9, onProgress: (p) => seen.push(p.cycle) });
    expect(seen).toEqual([50]);
  });

  it("#30 retainEvents changes only event detail, never money or the ledger", () => {
    const s = start(busy());
    const all = engine.run(s, 80, { retainEvents: "all" });
    const summary = engine.run(s, 80, { retainEvents: "summary" });
    const none = engine.run(s, 80, { retainEvents: "none" });
    expect(json(summary.state)).toBe(json(all.state));
    expect(json(none.state)).toBe(json(all.state));
    expect(none.events).toEqual([]);
    expect(summary.events.every((e) => e.cycle === 79)).toBe(true);
    expect(summary.eventCounts).toEqual(all.eventCounts);
  });

  it("#31 different seeds differ; the same seed reproduces", () => {
    const a = engine.run(start(singlePlot(gloomLayout(), { seed: 1, config: slotsOnly })), 200);
    const b = engine.run(start(singlePlot(gloomLayout(), { seed: 2, config: slotsOnly })), 200);
    const a2 = engine.run(start(singlePlot(gloomLayout(), { seed: 1, config: slotsOnly })), 200);
    expect(JSON.stringify(a.state.rng)).not.toBe(JSON.stringify(b.state.rng));
    expect(json(a2.state)).toBe(json(a.state));
  });
});

describe("growth", () => {
  // Water loss pinned to 0: with the player away, unwatered plants would dry out and halt mid-test.
  const noWaterLoss = { waterLossMin: 0, waterLossMax: 0 };
  const empty = () => start(singlePlot(layout(), { config: { ...slotsOnly, ...noWaterLoss }, activity: NEVER_ACTIVE }));

  it("#2 a 12-stage mutation spawns at stage 1 and needs 11 growth steps; effects latch at stage 12", () => {
    const s = empty();
    inject(s, 1, "startlevine", 5, 5, "spawned");
    expect(plantAt(s, 1, 5, 5)?.stage).toBe(1);
    const after10 = engine.run(s, 10).state;
    expect(plantAt(after10, 1, 5, 5)).toMatchObject({ stage: 11, lockedEffects: null });
    const after12 = engine.run(after10, 1);
    expect(plantAt(after12.state, 1, 5, 5)?.stage).toBe(12);
    expect(plantAt(after12.state, 1, 5, 5)?.lockedEffects).not.toBeNull();
    expect(ofKind(after12.events, "fullyGrown")).toHaveLength(1);
  });

  it("a 0-stage spawn is fully grown as it appears and latches the effects its neighbours give it", () => {
    // The Cindershade below the target gives improved_harvest_boost to its cardinal neighbours.
    const sc = singlePlot(layout([["pumpkin", 4, 4], ["melon", 4, 6], ["cindershade", 5, 5]], [["gloomgourd", 4, 5]]), {
      config: { ...slotsOnly, ...noWaterLoss },
      inventory: { cindershade: 1 },
      activity: NEVER_ACTIVE,
    });
    let s = start(sc);
    for (let i = 0; i < 200; i++) {
      const r = engine.run(s, 1);
      s = r.state;
      const spawned = ofKind(r.events, "spawned").find((e) => e.mutationId === "gloomgourd");
      if (!spawned) continue;
      const g = plantAt(s, 1, 4, 5)!;
      expect(g).toMatchObject({ kindId: "gloomgourd", stage: 0, fullyGrownAtCycle: spawned.cycle });
      expect(g.lockedEffects).toContain("improved_harvest_boost");
      return;
    }
    throw new Error("no Gloomgourd spawned");
  });

  it("#3 latched effects do not change when a neighbour is removed later", () => {
    const s = empty();
    inject(s, 1, "wheat", 5, 5, "planted");
    inject(s, 1, "nether_wart", 5, 6, "planted");
    const grown = engine.run(s, 8).state;
    expect(plantAt(grown, 1, 5, 5)?.lockedEffects).toContain("improved_harvest_boost");
    const plot = grown.plots[0];
    plot.plants = plot.plants.filter((p) => p.kindId !== "nether_wart");
    const later = engine.run(grown, 3).state;
    expect(plantAt(later, 1, 5, 5)?.lockedEffects).toContain("improved_harvest_boost");
    expect(plantAt(later, 1, 5, 5)?.held).not.toContain("improved_harvest_boost");
  });

  it("#4 a gated plant takes no growth step and emits growthBlocked until the player acts", () => {
    const s = empty();
    inject(s, 1, "snoozling", 3, 3, "spawned", { stage: 4 });
    const r = engine.run(s, 3);
    expect(plantAt(r.state, 1, 3, 3)?.stage).toBe(5); // fell asleep at 5
    expect(ofKind(r.events, "growthBlocked").length).toBe(2);
    expect(ofKind(r.events, "advanced").length).toBe(1);
  });

  it("an online player wakes a sleeping Snoozling; it then grows on", () => {
    const s = start(singlePlot(layout(), { config: slotsOnly }));
    // A stage-4 Snoozling the online player has been watering (a fresh spawn's 0 water could roll a below-0 skip).
    inject(s, 1, "snoozling", 3, 3, "spawned", { stage: 4, water: 100 });
    const r = engine.run(s, 3);
    expect(plantAt(r.state, 1, 3, 3)?.stage).toBe(7);
  });

  it("Cheesebite halts on its rat until vacuumed", () => {
    const s = empty();
    inject(s, 1, "cheesebite", 5, 5, "spawned", { stage: 3 });
    const r = engine.run(s, 4);
    expect(plantAt(r.state, 1, 5, 5)?.stage).toBe(4);
    expect(plantAt(r.state, 1, 5, 5)?.gate.ratAlive).toBe(true);
  });

  it("Glasscorn is harvestable at stage 7 and resets from 8 to 1 if left", () => {
    const s = empty();
    inject(s, 1, "glasscorn", 4, 4, "spawned", { stage: 6 });
    const at7 = engine.run(s, 1).state;
    expect(plantAt(at7, 1, 4, 4)?.lockedEffects).not.toBeNull();
    const reset = engine.run(at7, 2).state;
    expect(plantAt(reset, 1, 4, 4)?.stage).toBe(1);
    expect(plantAt(reset, 1, 4, 4)?.lockedEffects).toBeNull();
  });
});

describe("water", () => {
  const dry = (patch: object = {}) =>
    start(singlePlot(layout(), { config: { ...slotsOnly, waterLossMin: 3, waterLossMax: 3, negativeWaterSkipChance: 0, ...patch }, activity: NEVER_ACTIVE }));

  it("#5 retain +X% divides loss by 1+X (retain /1.5, improved supersedes it /2), drain adds 30%", async () => {
    const { retainFactor } = await import("./tick");
    expect(retainFactor([])).toBe(1);
    expect(retainFactor(["water_retain"])).toBeCloseTo(1 / 1.5);
    expect(retainFactor(["improved_water_retain"])).toBe(0.5);
    expect(retainFactor(["water_retain", "improved_water_retain"])).toBe(0.5);
    expect(retainFactor(["water_drain"])).toBeCloseTo(1.3);
    expect(retainFactor(["improved_water_retain", "water_drain"])).toBeCloseTo(0.65);
  });

  it("a Godseed (which always holds improved retain from its own neighbourhood) still drinks", () => {
    const s = dry({ waterLossMin: 20, waterLossMax: 20 });
    inject(s, 1, "godseed", 4, 4, "spawned");
    inject(s, 1, "cactus", 3, 5, "planted", { stage: 8 }); // gives improved_water_retain
    const r = engine.run(s, 3);
    expect(plantAt(r.state, 1, 4, 4)!.held).toContain("improved_water_retain");
    expect(plantAt(r.state, 1, 4, 4)!.water).toBe(-30); // 3 cycles x 20 / 2
  });

  it("#6 water reaching -100 dries the plant out (it halts, still standing); -99 does not", () => {
    const a = dry();
    inject(a, 1, "wheat", 5, 5, "planted", { water: -96 });
    const wet = engine.run(a, 1);
    expect(plantAt(wet.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", water: -99, stage: 1 });
    expect(ofKind(wet.events, "driedOut")).toHaveLength(0);
    // -99 still grows on, and its next stage takes it over the line.
    const crossed = engine.run(wet.state, 1);
    expect(ofKind(crossed.events, "driedOut")).toHaveLength(1);
    expect(plantAt(crossed.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", water: -102, stage: 2 });

    const b = dry();
    inject(b, 1, "wheat", 5, 5, "planted", { water: -97 });
    const dried = engine.run(b, 1);
    expect(ofKind(dried.events, "driedOut")).toHaveLength(1);
    expect(ofKind(dried.events, "driedOut")[0]).toMatchObject({ kindId: "wheat", row: 5, col: 5 });
    expect(dried.summary.driedOut.wheat).toBe(1);
    expect(plantAt(dried.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", isDeadPlant: false, water: -100, stage: 1 });
    // Halted from then on: no growth, no more water lost, reported once.
    const later = engine.run(dried.state, 5);
    expect(plantAt(later.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", water: -100, stage: 1 });
    expect(ofKind(later.events, "driedOut")).toHaveLength(0);
    expect(ofKind(later.events, "growthBlocked").filter((e) => e.gate === "dry")).toHaveLength(5);
    expect(later.summary.driedOut.wheat).toBe(1);
  });

  it("#7 a requires_watering:false mutation never loses water", () => {
    const s = dry();
    inject(s, 1, "thunderling", 5, 5, "spawned");
    const r = engine.run(s, 5);
    // Spawns start at 0 water; this one never drinks, so it stays at 0.
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ stage: 6, water: 0 });
  });

  it("an online player keeps plants watered", () => {
    const s = start(singlePlot(layout(), { config: slotsOnly }));
    inject(s, 1, "wheat", 5, 5, "planted");
    expect(plantAt(engine.run(s, 6).state, 1, 5, 5)?.water).toBe(100);
  });
});

describe("decay and placed items", () => {
  it("#8 a placed item's timer starts at placement and it goes in fully grown", () => {
    const s = start(singlePlot(layout([["chloronite", 5, 5]]), { inventory: { chloronite: 1 }, config: slotsOnly }));
    const p = plantAt(s, 1, 5, 5)!;
    expect(p).toMatchObject({ origin: "placed", stage: 10, decaySecondsRemaining: 3 * 86400 });
    const next = engine.run(s, 1).state;
    expect(plantAt(next, 1, 5, 5)!.decaySecondsRemaining).toBeCloseTo(3 * 86400 - 14400);
  });

  it("a placed item is never harvested (it never returns to the inventory)", () => {
    const sc = singlePlot(layout([["chloronite", 5, 5]]), { inventory: { chloronite: 1 }, config: slotsOnly });
    const r = engine.run(start(sc), 10);
    expect(ofKind(r.events, "harvested")).toHaveLength(0);
    expect(r.state.inventory.chloronite).toBe(1); // setup was free; nothing harvested it back
    expect(r.state.ledger.chloronite.produced).toBe(0);
  });

  it("#9 a spawned mutation's timer starts when it spawns, not when it becomes fully grown", () => {
    // Water loss pinned to 0 so the unwatered Startlevine doesn't halt mid-growth.
    const s = start(singlePlot(layout(), { config: { ...slotsOnly, waterLossMin: 0, waterLossMax: 0 }, activity: NEVER_ACTIVE }));
    inject(s, 1, "startlevine", 5, 5, "spawned");
    expect(plantAt(s, 1, 5, 5)?.decaySecondsRemaining).toBe(5 * 86400);
    const mid = engine.run(s, 10).state;
    const p = plantAt(mid, 1, 5, 5)!;
    expect(p).toMatchObject({ stage: 11, lockedEffects: null }); // spawned at 1, still growing
    expect(p.decaySecondsRemaining).toBeCloseTo(5 * 86400 - 10 * cycleLen(0));
  });

  it("a spawn whose timer is shorter than its growth decays before it is ever harvestable", () => {
    const s = start(
      singlePlot(layout(), { config: { ...slotsOnly, ...TIMER_ONLY, harvestWindowCycles: 5 }, activity: NEVER_ACTIVE })
    );
    inject(s, 1, "startlevine", 5, 5, "spawned");
    const r = engine.run(s, 6);
    expect(r.summary.decayed.startlevine).toBe(1);
    expect(ofKind(r.events, "fullyGrown")).toHaveLength(0);
  });

  it("#10 a decay:0 mutation never decays", () => {
    const sc = singlePlot(layout([["magic_jellybean", 5, 5]]), { inventory: { magic_jellybean: 1 }, config: slotsOnly });
    const r = engine.run(start(sc), 1000, { retainEvents: "none" });
    expect(r.summary.decayed.magic_jellybean).toBeUndefined();
    expect(plantAt(r.state, 1, 5, 5)?.kindId).toBe("magic_jellybean");
  });

  it("#11 decay leaves a Dead Plant; the player clears it (a dead_plant item) and re-places from stock", () => {
    // Timer-only: a placed Chloronite that never helps would otherwise be held by its minimum (8).
    const sc = singlePlot(layout([["chloronite", 5, 5]]), { inventory: { chloronite: 2 }, config: { ...slotsOnly, ...TIMER_ONLY } });
    const r = engine.run(start(sc), 18); // 3 days at 4 h cycles
    expect(r.summary.decayed.chloronite).toBe(1);
    expect(r.state.inventory.dead_plant).toBe(1);
    expect(r.state.inventory.chloronite).toBe(1); // setup was free; the re-placement cost one
    expect(plantAt(r.state, 1, 5, 5)?.kindId).toBe("chloronite");
    expect(r.summary.replacements).toBe(1);
  });

  it("with the player away, the Dead Plant stands in the cell", () => {
    const sc = singlePlot(layout([["chloronite", 5, 5]]), { inventory: { chloronite: 2 }, config: { ...slotsOnly, ...TIMER_ONLY }, activity: NEVER_ACTIVE });
    const r = engine.run(start(sc), 20);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "dead_plant", isDeadPlant: true });
  });
});

describe("debt: would it ever need something it does not have?", () => {
  it("the starting layout is always placed, free, even with an empty inventory", () => {
    const s = start(singlePlot(layout([["chloronite", 5, 5], ["fire", 0, 0], ["wheat", 1, 1]])));
    expect(s.debts).toEqual([]);
    expect(plantAt(s, 1, 5, 5)?.kindId).toBe("chloronite");
    expect(plantAt(s, 1, 0, 0)?.kindId).toBe("fire");
    expect(s.summary.placedItems).toEqual({});
    expect(engine.analyse(s).sustainable).toBe(true);
  });

  it("re-placing what decayed needs stock: the debt names the cycle and the item", () => {
    const r = engine.run(start(singlePlot(layout([["chloronite", 5, 5]]), { config: { ...slotsOnly, ...TIMER_ONLY } })), 18);
    expect(r.state.debts[0]).toMatchObject({ cycle: 17, plotId: 1, item: "chloronite", needed: 1, available: 0 });
    const report = engine.analyse(r.state);
    expect(report.firstDebt?.item).toBe("chloronite");
    // Sustainability is uptime of watched target cells; this layout has none.
    expect(report.totals.watched).toBe(0);
    expect(report.sustainable).toBe(true);
  });

  it("a shortfall is one debt event per episode, retried every session, filled once stock exists", () => {
    const s = start(singlePlot(layout([["chloronite", 5, 5]]), { config: { ...slotsOnly, ...TIMER_ONLY } }));
    const r = engine.run(s, 22); // decays at cycle 17, then 5 failed sessions (17-21)
    expect(r.summary.debtEvents).toBe(1);
    expect(r.summary.unfilledCellCycles).toBe(5);
    const stocked = structuredClone(r.state);
    stocked.inventory.chloronite = 1;
    const later = engine.run(stocked, 1);
    expect(plantAt(later.state, 1, 5, 5)?.kindId).toBe("chloronite");
  });

  it("inventory never goes negative", () => {
    const r = engine.run(start(singlePlot(layout([["chloronite", 5, 5], ["fire", 0, 0]]))), 50);
    for (const qty of Object.values(r.state.inventory)) expect(qty).toBeGreaterThanOrEqual(0);
  });
});

describe("spawning", () => {
  it("#13 one roll per location: two eligible mutations never both spawn in one cell-cycle", () => {
    // Slot ring holds pumpkin, melon and 2 wheat: Gloomgourd and Dustgrain compete.
    const spec = layout([["pumpkin", 4, 4], ["melon", 4, 6], ["wheat", 3, 5], ["wheat", 5, 5]], [["gloomgourd", 4, 5]]);
    const r = engine.run(start(singlePlot(spec, { config: slotsOnly, seed: 9 })), 400);
    const perCycle = new Map<number, number>();
    for (const e of ofKind(r.events, "spawned")) perCycle.set(e.cycle, (perCycle.get(e.cycle) ?? 0) + 1);
    expect(Math.max(...perCycle.values())).toBe(1);
    expect(r.summary.spawned.gloomgourd).toBeGreaterThan(0);
    expect(r.summary.spawned.dustgrain).toBeGreaterThan(0);
    // #26: every Dustgrain is a rival that won the Gloomgourd slot.
    expect(r.summary.rivals.spawned).toBe(r.summary.spawned.dustgrain);
  });

  it("#26 a clean layout reports no rivals", () => {
    const r = engine.run(start(singlePlot(gloomLayout(), { config: slotsOnly })), 200);
    expect(r.summary.rivals.spawned).toBe(0);
  });

  it("#16 a ring holding only 6 of 8 required cells never spawns the mutation", () => {
    const ring = (n: number) => {
      const cells: [string, number, number][] = [[4, 4], [4, 5], [4, 6], [5, 4], [5, 6], [6, 4], [6, 5], [6, 6]].map(
        ([r, c], i) => [i < 6 ? "choconut" : "gloomgourd", r, c]
      );
      return layout(cells.slice(0, n), [["chocoberry", 5, 5]]);
    };
    const inv = { choconut: 100, gloomgourd: 100 };
    const partial = engine.run(start(singlePlot(ring(6), { config: slotsOnly, inventory: inv })), 300, { retainEvents: "none" });
    expect(partial.summary.spawned.chocoberry).toBeUndefined();
    const full = engine.run(start(singlePlot(ring(8), { config: slotsOnly, inventory: inv })), 300, { retainEvents: "none" });
    expect(full.summary.spawned.chocoberry).toBeGreaterThan(0);
  });

  it("#15 a 3x3 mutation never spawns when a cell of its footprint is occupied", () => {
    // Snoozling's full 16-cell ring around (3,3)-(5,5).
    const ring: [string, number, number][] = [];
    const kinds = ["creambloom", "creambloom", "creambloom", "creambloom", "dustgrain", "dustgrain", "dustgrain",
      "witherbloom", "witherbloom", "witherbloom", "duskbloom", "duskbloom", "duskbloom", "thornshade", "thornshade", "thornshade"];
    let k = 0;
    for (let r = 2; r <= 6; r++) for (let c = 2; c <= 6; c++) if (r === 2 || r === 6 || c === 2 || c === 6) ring.push([kinds[k++], r, c]);
    const inv = { creambloom: 500, dustgrain: 500, witherbloom: 500, duskbloom: 500, thornshade: 500 };
    const groundTiles = Array.from({ length: 9 }, (_, i) => ({ ground: engine.data.mutations.snoozling.ground, row: 3 + Math.floor(i / 3), col: 3 + i % 3 }));
    const free = engine.run(start(singlePlot({ ...layout(ring), groundTiles }, { inventory: inv })), 200, { retainEvents: "none" });
    expect(free.summary.spawned.snoozling).toBeGreaterThan(0);
    const blocked = engine.run(start(singlePlot({ ...layout([...ring, ["pumpkin", 5, 5]]), groundTiles }, { inventory: inv })), 200, { retainEvents: "none" });
    expect(blocked.summary.spawned.snoozling).toBeUndefined();
  });

  it("#17 Godseed never spawns unless its spot holds all six positive effects", () => {
    const r = engine.run(start(singlePlot(layout([["wheat", 0, 0]], [["godseed", 4, 4]]), { config: slotsOnly })), 500, {
      retainEvents: "none",
    });
    expect(r.summary.spawned.godseed).toBeUndefined();
  });

  it("every empty cell with actual ground rolls: Lonelily appears on painted open ground, not AIR", () => {
    const spec = { ...layout([["wheat", 0, 0]]), groundTiles: [{ ground: "farmland", row: 9, col: 9 }] };
    const r = engine.run(start(singlePlot(spec, { config: { blankFillTo: 1 } })), 1, { retainEvents: "none" });
    expect(r.summary.spawned.lonelily).toBeGreaterThan(0);
    expect(engine.run(start(singlePlot(layout([["wheat", 0, 0]]), { config: { blankFillTo: 1 } })), 1).summary.spawned.lonelily).toBeUndefined();
  });
});

describe("player activity", () => {
  it("nothing is harvested on inactive cycles; a fully grown spawn waits for the session", () => {
    const sc = singlePlot(gloomLayout(), { config: slotsOnly, activity: { kind: "everyN", n: 5, offset: 0 } });
    const r = engine.run(start(sc), 200);
    for (const e of ofKind(r.events, "harvested")) expect(e.cycle % 5).toBe(0);
    expect(ofKind(r.events, "harvested").length).toBeGreaterThan(0);
  });

  it("playerActions off: the player never comes online, whatever the schedule says", () => {
    const sc = singlePlot(gloomLayout(), { config: slotsOnly });
    expect(sc.settings.playerActions).toBe(true); // default on
    sc.settings.playerActions = false;
    const r = engine.run(start(sc), 200);
    expect(ofKind(r.events, "playerSession")).toHaveLength(0);
    expect(ofKind(r.events, "harvested")).toHaveLength(0);
    expect(r.state.lastCycleActive).toBe(false);
  });

  it("time windows: the player is online only while the cycle fires inside a window", () => {
    // No crops standing, so cycles are exactly 4 h long from midnight: cycles fire at 04:00, 08:00, ... 20:00, 24:00.
    const sc = singlePlot(layout(), { config: slotsOnly, activity: { kind: "windows", windows: [{ from: 18, to: 22 }] } });
    const r = engine.run(start(sc), 60);
    const sessions = ofKind(r.events, "playerSession").map((e) => e.cycle);
    expect(sessions.slice(0, 3)).toEqual([4, 10, 16]); // the 20:00 cycles
  });

  it("'before decay' harvests at the last session before the harvest window closes", () => {
    const sc = singlePlot(gloomLayout(), {
      config: { ...slotsOnly, ...TIMER_ONLY, harvestWindowCycles: 7 },
      activity: { kind: "everyN", n: 3, offset: 0 },
      policies: { spawnedHarvest: "beforeDecay" },
    });
    const r = engine.run(start(sc), 300);
    expect(r.summary.decayed.gloomgourd ?? 0).toBe(0);
    expect(r.summary.harvested.gloomgourd).toBeGreaterThan(0);
    for (const e of ofKind(r.events, "harvested")) {
      const grown = ofKind(r.events, "fullyGrown").filter((g) => g.kindId === "gloomgourd" && g.cycle <= e.cycle).pop()!;
      // A 0-stage Gloomgourd is fully grown on its spawn tick and decays 6 cycles later. With
      // sessions every 3 cycles, the last session before that falls 3-5 cycles after it grew.
      expect(e.cycle - grown.cycle).toBeGreaterThanOrEqual(3);
      expect(e.cycle - grown.cycle).toBeLessThanOrEqual(5);
    }
  });

  it("base-crop upkeep 'harvestWhenGrown' harvests and replants in the same step", () => {
    const sc = singlePlot(layout([["wheat", 5, 5]]), { config: slotsOnly, policies: { baseCropUpkeep: "harvestWhenGrown" } });
    const r = engine.run(start(sc), 17);
    expect(r.summary.harvested.wheat).toBe(2);
    expect(plantAt(r.state, 1, 5, 5)?.kindId).toBe("wheat");
    expect(r.state.inventory.wheat).toBe(2 * yieldOf(72, 1));
  });

  it("default upkeep leaves base crops until decay (72 h of cycles), then replants for free", () => {
    const cycles = Math.ceil((72 * 3600) / cycleLen(1));
    const r = engine.run(start(singlePlot(layout([["wheat", 5, 5]]), { config: { ...slotsOnly, ...TIMER_ONLY } })), cycles);
    expect(r.summary.harvested.wheat).toBeUndefined();
    expect(r.summary.decayed.wheat).toBe(1);
    expect(plantAt(r.state, 1, 5, 5)).toMatchObject({ kindId: "wheat", stage: 0 });
    expect(r.state.inventory.dead_plant).toBe(1);
  });
});
