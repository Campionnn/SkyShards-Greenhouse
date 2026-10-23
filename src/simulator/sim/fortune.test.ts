import { describe, expect, it } from "vitest";
import { ALWAYS_SPAWN, engine, flow, layout, scenario, step } from "../testHelpers";
import type { PlayerStats, Scenario, TimedEvent } from "./state";

// Per-crop Farming Fortune and farming tools through a whole run (economy/fortune.ts, sim/harvest.ts).

/**
 * A wheat field with Dustgrain target slots (wheat-only mutation, its bundle is wheat too) in the
 * gaps, harvested whenever fully grown, so wheat, mutation bundles and mutation items all drop.
 */
function wheatField(stats: Partial<PlayerStats>, seed = 7): Scenario {
  const plants: [string, number, number][] = [];
  const slots: [string, number, number][] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) ((r + c) % 3 !== 0 ? plants : slots).push([(r + c) % 3 !== 0 ? "wheat" : "dustgrain", r, c]);
  return scenario([flow([step("a", layout(plants, slots))])], {
    seed,
    stats: { farmingFortune: 200, ...ALWAYS_SPAWN, ...stats },
    policies: { baseCropUpkeep: "harvestWhenGrown" },
  });
}

const run = (sc: Scenario, cycles = 60) => engine.run(engine.initState(sc).state, cycles);

const harvests = (events: TimedEvent[]) => events.filter((e): e is Extract<TimedEvent, { kind: "harvested" }> => e.kind === "harvested");

/** Everything except crop counts and coins: which plants were harvested where, and every non-base-crop drop. */
function shape(events: TimedEvent[]) {
  const data = engine.data;
  return harvests(events).map((h) => ({
    cycle: h.cycle,
    plantId: h.plantId,
    kindId: h.kindId,
    nonCrop: Object.fromEntries(Object.entries(h.drops).filter(([item]) => !data.crops[item] && item !== "seeds" && item !== "red_mushroom" && item !== "brown_mushroom")),
  }));
}

describe("per-crop fortune in a run", () => {
  const plain = run(wheatField({}));

  it("the reference run harvests both wheat and mutations", () => {
    expect(plain.summary.harvested.wheat ?? 0).toBeGreaterThan(0);
    const mutations = Object.keys(plain.summary.spawned).filter((k) => (plain.summary.harvested[k] ?? 0) > 0);
    expect(mutations.length).toBeGreaterThan(0);
  });

  it("cropFortune { wheat: 100 } yields more wheat and seeds but the same harvests and mutation items", () => {
    const boosted = run(wheatField({ cropFortune: { wheat: 100 } }));
    expect(shape(boosted.events)).toEqual(shape(plain.events));
    expect(boosted.summary.spawned).toEqual(plain.summary.spawned);
    expect(boosted.summary.harvested).toEqual(plain.summary.harvested);
    expect(boosted.summary.revenue.mutationItems).toBe(plain.summary.revenue.mutationItems);
    expect(boosted.state.inventory.wheat).toBeGreaterThan(plain.state.inventory.wheat);
    expect(boosted.summary.revenue.crops).toBeGreaterThan(plain.summary.revenue.crops);
    // Every wheat drop is at least as big; non-wheat crop drops (e.g. a mutation bundle's other crops) are untouched.
    const a = harvests(plain.events);
    const b = harvests(boosted.events);
    for (let i = 0; i < a.length; i++) {
      for (const [item, qty] of Object.entries(a[i].drops)) {
        if (item === "wheat" || item === "seeds") expect(b[i].drops[item]).toBeGreaterThanOrEqual(qty);
        else expect(b[i].drops[item]).toBe(qty);
      }
    }
  });

  it("a tool's fortune on wheat adds like crop fortune; on other crops it adds nothing to wheat", () => {
    const viaCrop = run(wheatField({ cropFortune: { wheat: 100 } }));
    const viaTool = run(wheatField({ tools: [{ name: "Hoe", fortune: { wheat: 100 } }] }));
    expect(viaTool.summary.revenue).toEqual(viaCrop.summary.revenue);
    expect(viaTool.state.inventory).toEqual(viaCrop.state.inventory);
    const offCrop = run(wheatField({ tools: [{ name: "Dicer", fortune: { melon: 500 } }] }));
    expect(offCrop.state.inventory.wheat).toBe(plain.state.inventory.wheat);
  });

  it("empty crop fortune / tool list and zero crop values run exactly as without the fields", () => {
    for (const extra of [{ cropFortune: {} }, { tools: [] }, { cropFortune: { wheat: 0, melon: 0 } }] as Partial<PlayerStats>[]) {
      const r = run(wheatField(extra));
      expect(JSON.stringify(r.summary)).toBe(JSON.stringify(plain.summary));
      expect(JSON.stringify(r.events)).toBe(JSON.stringify(plain.events));
      expect(JSON.stringify(r.state.inventory)).toBe(JSON.stringify(plain.state.inventory));
    }
  });

  it("a scenario without the fields keeps them out of the saved state", () => {
    const stats = plain.state.scenario.settings.playerStats;
    expect("cropFortune" in stats).toBe(false);
    expect("tools" in stats).toBe(false);
  });

  it("stays deterministic and splittable with per-crop fortune set", () => {
    const sc = wheatField({ cropFortune: { wheat: 50 }, tools: [{ name: "Hoe", fortune: { wheat: 200 } }, { name: "Dicer", fortune: { melon: 300 } }] });
    const s0 = engine.initState(sc).state;
    const whole = engine.run(s0, 40).state;
    const split = engine.run(engine.run(s0, 15).state, 25).state;
    expect(JSON.stringify(split)).toBe(JSON.stringify(whole));
  });
});
