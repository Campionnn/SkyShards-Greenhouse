import { describe, expect, it } from "vitest";
import { ScenarioError } from "./validate";
import {
  engine,
  flow,
  inject,
  LAYOUT_A_CODE,
  LAYOUT_B_CODE,
  layout,
  NEVER_ACTIVE,
  plantAt,
  scenario,
  step,
  start,
} from "../testHelpers";
import type { TimedEvent } from "../sim/state";

const slotsOnly = { spawnCells: "slotsOnly" as const };
const ofKind = <K extends TimedEvent["kind"]>(events: TimedEvent[], kind: K) =>
  events.filter((e): e is Extract<TimedEvent, { kind: K }> => e.kind === kind);
const history = (s: ReturnType<typeof start>, plotId: number) =>
  s.flows.find((f) => f.plotId === plotId)!.history.map((h) => [h.stepId, h.startCycle]);

describe("multi-plot: spatially independent, temporally shared", () => {
  it("unique crops aggregate across plots, and one plot's crops speed up another's cycles", () => {
    const crops = ["wheat", "potato", "carrot", "pumpkin", "melon", "cocoa_beans"];
    const others = ["sugar_cane", "cactus", "nether_wart", "wild_rose", "red_mushroom", "sunflower"];
    const alone = start(scenario([flow([step("a", layout(crops.map((k, i) => [k, 0, i])))])], { config: slotsOnly }));
    const together = start(
      scenario(
        [flow([step("a", layout(crops.map((k, i) => [k, 0, i])))]), flow([step("b", layout(others.map((k, i) => [k, 0, i])))])],
        { config: slotsOnly }
      )
    );
    expect(alone.uniqueCropCount).toBe(6);
    expect(together.uniqueCropCount).toBe(12);
    expect(together.lastCycleSeconds).toBeLessThan(alone.lastCycleSeconds);
  });

  it("#20 effects never cross a plot boundary", () => {
    const s = start(
      scenario([flow([step("a", layout([["wild_rose", 0, 9], ["nether_wart", 0, 8]]))]), flow([step("b", layout([["wheat", 0, 0]]))])], {
        config: slotsOnly,
      })
    );
    const r = engine.run(s, 1);
    expect(plantAt(r.state, 2, 0, 0)?.held).toEqual([]);
  });

  it("an item harvested on plot 1 is placed as an ingredient on plot 2", () => {
    // Plot 1 grows Gloomgourds; plot 2 wants a Gloomgourd placed, starting with none.
    const sc = scenario(
      [
        flow([step("grow", layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]))]),
        flow([step("use", layout([["gloomgourd", 2, 2]]))]),
      ],
      { config: slotsOnly, seed: 5 }
    );
    const s = start(sc);
    expect(plantAt(s, 2, 2, 2)?.kindId).toBe("gloomgourd"); // setup is free
    const r = engine.run(s, 60);
    expect(plantAt(r.state, 2, 2, 2)?.kindId).toBe("gloomgourd");
    expect(r.summary.debtEvents).toBe(0);
    // Placed Gloomgourds decay after 3 days and are re-placed from plot 1's harvests.
    expect(r.state.ledger.gloomgourd.consumed).toBeGreaterThanOrEqual(1);
    expect(r.state.ledger.gloomgourd.produced).toBeGreaterThanOrEqual(r.state.ledger.gloomgourd.consumed);
  });

  it("the shared inventory is contended in plotOrder", () => {
    // Both placed Chloronites decay on cycle 17; one spare in stock goes to whichever plot ticks first.
    const two = (order: number[]) =>
      engine.run(
        start(
          scenario([flow([step("a", layout([["chloronite", 1, 1]]))]), flow([step("b", layout([["chloronite", 1, 1]]))])], {
            config: { ...slotsOnly, plotOrder: order },
            inventory: { chloronite: 1 },
          })
        ),
        18
      ).state;
    expect(two([1, 2]).debts[0].plotId).toBe(2);
    expect(two([2, 1]).debts[0].plotId).toBe(1);
  });

  it("profit is one aggregate, with a per-plot breakdown that sums to it", () => {
    const grow = () => flow([step("g", layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]))]);
    const r = engine.run(start(scenario([grow(), grow(), grow()], { config: slotsOnly })), 150, { retainEvents: "none" });
    const perPlot = Object.values(r.summary.perPlot).reduce((a, p) => a + p.revenue, 0);
    expect(perPlot).toBe(r.summary.coinsRealised);
    expect(Object.keys(r.summary.perPlot)).toEqual(["1", "2", "3"]);
  });
});

describe("per-plot flows", () => {
  const twoStep = (n: number) => flow([step("s1", layout([["wheat", 0, 0]]), [{ kind: "cycles", n }]), step("s2", layout([["potato", 0, 0]]), [{ kind: "cycles", n }])], true);

  it("plots desynchronise: each follows its own step list on the shared clock", () => {
    const r = engine.run(start(scenario([twoStep(2), twoStep(5)], { config: slotsOnly })), 12);
    expect(history(r.state, 1).length).toBeGreaterThan(history(r.state, 2).length);
    expect(history(r.state, 1)[1]).toEqual(["s2", 1]);
    expect(history(r.state, 2)[1]).toEqual(["s2", 4]);
  });

  it("startIndex offsets a plot without changing its steps", () => {
    const f = twoStep(3);
    const s = start(scenario([f, { ...f, startIndex: 1 }], { config: slotsOnly }));
    expect(plantAt(s, 1, 0, 0)?.kindId).toBe("wheat");
    expect(plantAt(s, 2, 0, 0)?.kindId).toBe("potato");
  });

  it("a non-looping flow holds its final step while the others keep going", () => {
    const once = flow([step("only", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 2 }])], false);
    const r = engine.run(start(scenario([once, twoStep(2)], { config: slotsOnly })), 10);
    expect(r.state.flows[0].finished).toBe(true);
    expect(history(r.state, 1)).toHaveLength(1);
    expect(history(r.state, 2).length).toBeGreaterThan(3);
  });

  it("AND semantics: one unsatisfied trigger holds the step", () => {
    const f = flow(
      [
        step("s1", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 2 }, { kind: "inventoryAtLeast", item: "chloronite", qty: 1 }]),
        step("s2", layout([["potato", 0, 0]]), []),
      ],
      false
    );
    const held = engine.run(start(scenario([f], { config: slotsOnly })), 10);
    expect(history(held.state, 1)).toHaveLength(1);
    const moved = engine.run(start(scenario([f], { config: slotsOnly, inventory: { chloronite: 1 } })), 10);
    expect(history(moved.state, 1)).toEqual([["s1", 0], ["s2", 1]]);
  });

  it("mutationSpawned fires only on the named mutation", () => {
    const f = flow(
      [
        step("grow", layout([["pumpkin", 4, 4], ["melon", 4, 6]], [["gloomgourd", 4, 5]]), [{ kind: "mutationSpawned", mutationId: "gloomgourd", count: 2 }]),
        step("next", layout(), []),
      ],
      false
    );
    const r = engine.run(start(scenario([f], { config: slotsOnly, seed: 8 })), 100);
    const change = ofKind(r.events, "stepChanged")[0];
    const spawnedBefore = ofKind(r.events, "spawned").filter((e) => e.cycle <= change.cycle && e.mutationId === "gloomgourd");
    expect(spawnedBefore).toHaveLength(2);
  });

  it("decayImminent / plantDecayed drive the 'grow until the inputs decay' tactic", () => {
    const f = flow(
      [step("wheat", layout([["wheat", 0, 0]]), [{ kind: "plantDecayed", kindId: "wheat" }]), step("potato", layout([["potato", 0, 0]]), [])],
      false
    );
    const r = engine.run(start(scenario([f], { config: slotsOnly })), 25);
    const change = ofKind(r.events, "stepChanged")[0];
    const decay = ofKind(r.events, "decayed")[0];
    expect(change.cycle).toBe(decay.cycle);
    expect(plantAt(r.state, 1, 0, 0)?.kindId).toBe("potato");
  });

  it("a trigger that fires while the player is away waits for the next session", () => {
    const f = flow([step("a", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 1 }]), step("b", layout([["potato", 0, 0]]), [])], false);
    // Online on cycles 3, 7, ...: the trigger holds at the end of cycle 0, the change happens at cycle 3.
    const r = engine.run(start(scenario([f], { config: slotsOnly, activity: { kind: "everyN", n: 4, offset: 3 } })), 6);
    expect(r.state.flows[0].history[1]).toMatchObject({ stepId: "b", startCycle: 3 });
    expect(ofKind(r.events, "stepChanged")[0].cycle).toBe(3);
  });

  it("identical plants survive a step change untouched; nothing is spent again", () => {
    const f = flow(
      [
        step("a", layout([["chloronite", 1, 1], ["wheat", 3, 3]]), [{ kind: "cycles", n: 2 }]),
        step("b", layout([["chloronite", 1, 1], ["potato", 3, 3]]), []),
      ],
      false
    );
    const s = start(scenario([f], { config: slotsOnly, inventory: { chloronite: 1 } }));
    const id = plantAt(s, 1, 1, 1)!.id;
    const r = engine.run(s, 4);
    expect(plantAt(r.state, 1, 1, 1)?.id).toBe(id);
    expect(r.summary.debtEvents).toBe(0);
    expect(plantAt(r.state, 1, 3, 3)?.kindId).toBe("potato");
  });

  it("a full-clear step breaks everything; placed items drop nothing", () => {
    const f = flow(
      [
        step("a", layout([["chloronite", 1, 1]]), [{ kind: "cycles", n: 1 }]),
        step("b", layout([["chloronite", 1, 1]]), [], { fullClear: true }),
      ],
      false
    );
    const r = engine.run(start(scenario([f], { config: slotsOnly, inventory: { chloronite: 1 } })), 3);
    expect(r.summary.destroyed.chloronite).toBe(1);
    expect(r.state.inventory.chloronite ?? 0).toBe(0); // the later step spent the spare
    expect(r.summary.debtEvents).toBe(0);
  });

  it("only the starting layout is free: a later step places from inventory", () => {
    const f = flow([step("a", layout([["wheat", 0, 0]]), [{ kind: "cycles", n: 1 }]), step("b", layout([["chloronite", 1, 1]]), [])], false);
    const r = engine.run(start(scenario([f], { config: slotsOnly })), 2);
    expect(r.state.debts[0]).toMatchObject({ cycle: 0, item: "chloronite" });
    expect(plantAt(r.state, 1, 1, 1)).toBeUndefined();
  });

  it("step policies override the plot and scenario defaults", () => {
    const f = flow([step("a", layout([["wheat", 0, 0]]), [], { policies: { baseCropUpkeep: "harvestWhenGrown" } })]);
    const r = engine.run(start(scenario([f], { config: slotsOnly })), 9);
    expect(r.summary.harvested.wheat).toBe(1);
  });
});

describe("validation", () => {
  it("rejects a trigger that can never fire", () => {
    const f = flow([step("a", layout(), [{ kind: "mutationSpawned", mutationId: "jerryflower", count: 1 }]), step("b", layout())]);
    expect(() => start(scenario([f]))).toThrow(ScenarioError);
  });

  it("rejects more than 3 plots and bad layouts", () => {
    const f = flow([step("a", layout())]);
    expect(engine.validate(scenario([f, f, f, f])).some((i) => i.level === "error")).toBe(true);
    const overlap = flow([step("a", layout([["noctilume", 0, 0], ["wheat", 1, 1]]))]);
    expect(() => start(scenario([overlap]))).toThrow(/overlaps/);
  });

  it("warns about a step that can never be left", () => {
    const f = flow([step("a", layout()), step("b", layout())], true);
    expect(engine.validate(scenario([f])).some((i) => i.level === "warning" && /forever/.test(i.message))).toBe(true);
  });
});

describe("the reference scenario: 1 plot of Layout A feeding 2 plots of Layout B", () => {
  const codes = [LAYOUT_A_CODE, LAYOUT_B_CODE, LAYOUT_B_CODE];
  const sc = (inventory: Record<string, number> = {}) =>
    scenario(
      codes.map((code) => flow([step("static", { code })])),
      { inventory }
    );

  it("starts fully laid out from an empty inventory, and goes into debt once placed items decay", () => {
    const s = start(sc());
    expect(engine.analyse(s).sustainable).toBe(true);
    expect(s.plots[1].plants.filter((p) => p.kindId === "chloronite")).toHaveLength(24);
    const report = engine.analyse(engine.run(s, 40, { retainEvents: "none" }).state);
    expect(report.sustainable).toBe(false);
    expect(report.firstDebt!.cycle).toBeGreaterThan(0);
    // Magic Jellybean never decays, so it is never the item that runs out.
    expect(report.debts.some((d) => d.item === "magic_jellybean")).toBe(false);
  });

  it("Layout A's uppercase cells are empty on the plot, its lowercase cells are planted", () => {
    const s = start(sc({ fire: 2, dead_plant: 4, ashwreath: 20, coalroot: 20, thornshade: 20, scourroot: 20, witherbloom: 20, veilshroom: 20, chloronite: 60, magic_jellybean: 40, cindershade: 20 }));
    const plot1 = s.plots[0];
    for (const slot of plot1.slots) expect(plantAt(s, 1, slot.row, slot.col)).toBeUndefined();
    expect(plot1.slots).toHaveLength(18);
    expect(plot1.plants.filter((p) => p.origin === "placed").length + plot1.plants.filter((p) => p.origin === "planted").length).toBe(82);
  });

  it("runs 500 cycles across 3 plots and reports a cumulative ledger", () => {
    const r = engine.run(start(sc({ chloronite: 48, magic_jellybean: 32, cindershade: 10, fire: 2, dead_plant: 4 })), 500, {
      retainEvents: "none",
    });
    expect(r.summary.cyclesRun).toBe(500);
    expect(r.summary.coinsRealised).toBeGreaterThan(0);
    const report = engine.analyse(r.state);
    expect(report.items.find((i) => i.item === "magic_jellybean")?.permanent).toBe(true);
  });
});

describe("destruction", () => {
  const blank = (config: Record<string, unknown> = {}, activity = NEVER_ACTIVE) =>
    start(scenario([flow([step("a", layout())])], { config: { ...slotsOnly, ...config }, activity }));

  it("a growing Devourer grows a root into a neighbouring cell, destroying what was there", () => {
    const s = blank({ devourerRootChance: 1, rootSpreadChance: 0 });
    inject(s, 1, "devourer", 5, 5, "spawned");
    // Fill all 8 neighbours so the root must land on a plant.
    for (const [r, c] of [[4, 4], [4, 5], [4, 6], [5, 4], [5, 6], [6, 4], [6, 5], [6, 6]]) inject(s, 1, "wheat", r, c, "planted");
    const r = engine.run(s, 1);
    expect(r.summary.destroyed.wheat).toBe(1);
    expect(r.state.plots[0].plants.filter((p) => p.kindId === "devourer_root")).toHaveLength(1);
  });

  it("roots spread on their own, and the online player breaks them", () => {
    const s = blank({ devourerRootChance: 0, rootSpreadChance: 1 });
    inject(s, 1, "devourer_root", 0, 0, "placed");
    const offline = engine.run(s, 2).state; // 1 -> 2 -> 4 roots
    expect(offline.plots[0].plants.filter((p) => p.kindId === "devourer_root").length).toBe(4);
    const online = structuredClone(offline);
    online.scenario.settings.activity = { kind: "everyN", n: 1, offset: 0 };
    online.scenario.settings.config.rootSpreadChance = 0;
    const cleared = engine.run(online, 1).state;
    expect(cleared.plots[0].plants.filter((p) => p.kindId === "devourer_root")).toHaveLength(0);
  });

  it("a fully grown Devourer grows no roots", () => {
    const s = blank({ devourerRootChance: 1, rootSpreadChance: 1 });
    inject(s, 1, "devourer", 5, 5, "spawned", { stage: 16 });
    const r = engine.run(s, 5);
    expect(r.state.plots[0].plants.some((p) => p.kindId === "devourer_root")).toBe(false);
  });

  it("Chorus Fruit teleports onto AIR when there is no ground, turning the landing cell into End Stone", () => {
    const s = blank();
    expect(s.plots[0].groundTiles).toEqual({});
    inject(s, 1, "chorus_fruit", 5, 5, "spawned");
    const r = engine.run(s, 1);
    const moved = ofKind(r.events, "teleported");
    expect(moved).toHaveLength(1);
    const { row, col } = moved[0];
    expect([row, col]).not.toEqual([5, 5]);
    expect(r.state.plots[0].groundTiles[`${row},${col}`]).toBeUndefined();
    expect(r.state.plots[0].groundOverrides).toEqual({ [`${row},${col}`]: "end_stone" });
    expect(plantAt(r.state, 1, row, col)?.kindId).toBe("chorus_fruit");
    expect(plantAt(r.state, 1, 5, 5)).toBeUndefined();
  });

  it("emptyOnly never lands on a plant; anyCell can land on one, destroying it", () => {
    const wheat: [string, number, number][] = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (r !== 5 || c !== 5) wheat.push(["wheat", r, c]);
    const full = (mode: "emptyOnly" | "anyCell") => {
      const s = start(scenario([flow([step("a", layout(wheat))])], { config: { ...slotsOnly, chorusTeleportTargets: mode }, activity: NEVER_ACTIVE }));
      inject(s, 1, "chorus_fruit", 5, 5, "spawned");
      return engine.run(s, 1);
    };
    const blocked = full("emptyOnly");
    expect(ofKind(blocked.events, "teleported")).toHaveLength(0);
    expect(plantAt(blocked.state, 1, 5, 5)?.kindId).toBe("chorus_fruit");
    const r = full("anyCell");
    const [moved] = ofKind(r.events, "teleported");
    expect(r.state.plots[0].groundOverrides[`${moved.row},${moved.col}`]).toBe("end_stone");
    expect(plantAt(r.state, 1, moved.row, moved.col)?.kindId).toBe("chorus_fruit");
    expect(r.summary.destroyed.wheat).toBe(1);
  });

  it("a growing Chorus Fruit teleports and converts its landing cell; once grown it stays put", () => {
    const s = blank();
    inject(s, 1, "chorus_fruit", 5, 5, "spawned");
    const r = engine.run(s, 1);
    const moved = ofKind(r.events, "teleported")[0];
    expect(r.state.plots[0].groundOverrides[`${moved.row},${moved.col}`]).toBe("end_stone");
    expect(plantAt(r.state, 1, 5, 5)).toBeUndefined();
    const grown = blank();
    inject(grown, 1, "chorus_fruit", 5, 5, "spawned", { stage: 12 });
    expect(ofKind(engine.run(grown, 3).events, "teleported")).toHaveLength(0);
  });

  it("destruction runs before growth: a Chorus Fruit teleports one last time on the tick it becomes fully grown", () => {
    const s = blank();
    inject(s, 1, "chorus_fruit", 5, 5, "spawned", { stage: 11 });
    const r = engine.run(s, 1);
    const kinds = r.events.map((e) => e.kind);
    expect(kinds.indexOf("teleported")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("teleported")).toBeLessThan(kinds.indexOf("fullyGrown"));
    const moved = ofKind(r.events, "teleported")[0];
    expect(plantAt(r.state, 1, moved.row, moved.col)).toMatchObject({ kindId: "chorus_fruit", stage: 12 });
    // Fully grown now: it never moves again.
    expect(ofKind(engine.run(r.state, 3).events, "teleported")).toHaveLength(0);
  });

  it("destruction is the first tick step, so a new spawn does nothing destructive on its spawn tick", async () => {
    const { TICK_PHASES } = await import("../sim/tick");
    const ids = TICK_PHASES.map((s) => s.id);
    expect(ids[0]).toBe("destruction");
    expect(ids.indexOf("destruction")).toBeLessThan(ids.indexOf("growth"));
    expect(ids.indexOf("destruction")).toBeLessThan(ids.indexOf("spawn"));
    // A spawn enters at stage 1 and makes its first jump on the next tick.
    const s = blank();
    inject(s, 1, "chorus_fruit", 5, 5, "spawned");
    expect(plantAt(s, 1, 5, 5)?.stage).toBe(1);
    expect(ofKind(engine.run(s, 1).events, "teleported")).toHaveLength(1);
  });
});

describe("blastberry", () => {
  const blank = (activity = NEVER_ACTIVE) => start(scenario([flow([step("a", layout())])], { config: slotsOnly, activity }));

  it("a natural Blastberry primes when fully grown; harvesting it drops its items and explodes", () => {
    const s = blank({ kind: "everyN", n: 1, offset: 0 });
    inject(s, 1, "turtlellini", 4, 5, "placed", { gate: { exploded: 1 } });
    inject(s, 1, "wheat", 4, 4, "planted");
    inject(s, 1, "blastberry", 5, 5, "spawned", { stage: 5 });
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "harvested").some((e) => e.kindId === "blastberry")).toBe(true);
    expect(r.state.inventory.blastberry).toBe(1);
    expect(r.summary.destroyed.wheat).toBe(1);
    expect(plantAt(r.state, 1, 4, 5)?.kindId).toBe("shellfruit");
  });

  it("an unprimed (still growing) natural Blastberry does not explode when broken", () => {
    const s = blank();
    inject(s, 1, "wheat", 4, 4, "planted");
    inject(s, 1, "blastberry", 5, 5, "spawned", { stage: 2, decaySecondsRemaining: 1 });
    // Growing spawns have no timer; force one to break it by decay before it primes.
    const r = engine.run(s, 1);
    expect(ofKind(r.events, "exploded")).toHaveLength(0);
    expect(plantAt(r.state, 1, 4, 4)?.kindId).toBe("wheat");
  });

  it("a placed Blastberry starts unprimed and primes at the next tick; primed ones chain-explode", () => {
    const f = flow(
      [
        step("a", layout([["blastberry", 5, 5], ["blastberry", 5, 6]]), [{ kind: "cycles", n: 1 }]),
        step("b", layout(), [], { fullClear: true }),
      ],
      false
    );
    const s = start(scenario([f], { config: slotsOnly }));
    expect(s.plots[0].plants.find((p) => p.kindId === "blastberry")?.gate.primed).toBe(false);
    const r = engine.run(s, 1); // tick 0 primes them; the step change at its end breaks them
    // One broken by the player at the step change, the other set off by the first blast.
    expect(ofKind(r.events, "exploded").map((e) => [e.row, e.col])).toEqual([
      [5, 5],
      [5, 6],
    ]);
  });
});
