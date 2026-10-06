import { describe, expect, it } from "vitest";
import { ALWAYS_SPAWN, engine, flow, inject, layout, NEVER_ACTIVE, scenario, singlePlot, step, start } from "../testHelpers";
// clearTargetBlockers tests live here too: both are per-session target-cell upkeep.
import type { LayoutSpec } from "../flow/types";

const painted = (spec: LayoutSpec, ground: string, row: number, col: number): LayoutSpec => ({
  ...spec,
  groundTiles: [{ ground, row, col }],
});

/** Ashwreath needs soul sand and two nether wart + two fire in its ring. */
const ashwreathReady = (spec: LayoutSpec) => {
  const s = start(singlePlot(spec, { activity: NEVER_ACTIVE }));
  for (const [kind, row, col] of [["nether_wart", 3, 4], ["nether_wart", 3, 5], ["fire", 4, 3], ["fire", 4, 5]] as const) {
    inject(s, 1, kind, row, col, kind === "nether_wart" ? "planted" : "placed");
  }
  return s;
};

describe("mutation ground eligibility", () => {
  it("an old target automatically paints its mutation's required ground", () => {
    const s = ashwreathReady(layout([], [["ashwreath", 4, 4]]));
    expect(s.plots[0].groundTiles["4,4"]).toBe("soul_sand");
    expect(engine.run(s, 1).state.plots[0].slotIneligibleCycles["4,4"]).toBe(0);
  });

  it("unpainted cells remain AIR, while explicit farmland can support a spawn", () => {
    const opts = { stats: ALWAYS_SPAWN, activity: NEVER_ACTIVE };
    const bare = start(singlePlot(layout(), opts));
    expect(bare.plots[0].groundTiles["0,0"]).toBeUndefined();
    expect(engine.run(bare, 1).state.plots[0].plants).toHaveLength(0);
    const explicit = start(singlePlot(painted(layout(), "farmland", 0, 0), opts));
    expect(explicit.plots[0].groundTiles["0,0"]).toBe("farmland");
    expect(engine.run(explicit, 1).state.plots[0].plants).toMatchObject([{ kindId: "lonelily", row: 0, col: 0 }]);
  });

  it("a painted bare cell supports a mutation without any slot label", () => {
    const spec = painted(layout([ ["nether_wart", 0, 0], ["nether_wart", 0, 2], ["fire", 1, 0], ["fire", 1, 1] ]), "soul_sand", 0, 1);
    const opts = { stats: ALWAYS_SPAWN, activity: NEVER_ACTIVE };
    const paintedState = engine.run(start(singlePlot(spec, opts)), 1).state;
    expect(paintedState.plots[0].plants.some((p) => p.row === 0 && p.col === 1 && p.kindId === "ashwreath")).toBe(true);
    const bareState = engine.run(start(singlePlot({ ...spec, groundTiles: [] }, opts)), 1).state;
    expect(bareState.plots[0].plants.some((p) => p.row === 0 && p.col === 1 && p.kindId === "ashwreath")).toBe(false);
  });

  it("painted ground controls every candidate, not only the slot's target", () => {
    const s = ashwreathReady(painted(layout([], [["ashwreath", 4, 4]]), "farmland", 4, 4));
    // Target ground always wins over an explicit tile at the same position.
    expect(s.plots[0].groundTiles["4,4"]).toBe("soul_sand");
    const inPlay = structuredClone(s);
    inPlay.plots[0].groundOverrides["4,4"] = "farmland";
    expect(engine.run(inPlay, 1).state.plots[0].slotIneligibleCycles["4,4"]).toBe(1);
  });

  it("a painted 2x2 tile is checked across the whole footprint, not just at its anchor", () => {
    // Glasscorn has a 2x2 sand footprint and needs six Startlevine + six Chloronite ring cells.
    const ring: [string, number, number][] = [];
    let i = 0;
    for (let r = 3; r <= 6; r++) for (let c = 3; c <= 6; c++) {
      if (r >= 4 && r <= 5 && c >= 4 && c <= 5) continue;
      ring.push([i++ < 6 ? "startlevine" : "chloronite", r, c]);
    }
    const s = start(singlePlot(layout(ring, [["glasscorn", 4, 4]]), { activity: NEVER_ACTIVE }));
    for (const key of ["4,4", "4,5", "5,4", "5,5"]) expect(s.plots[0].groundTiles[key]).toBe("sand");
    const broken = structuredClone(s);
    broken.plots[0].groundOverrides["5,5"] = "farmland";
    expect(engine.run(broken, 1).state.plots[0].slotIneligibleCycles["4,4"]).toBe(1);
    expect(engine.run(s, 1).state.plots[0].slotIneligibleCycles["4,4"]).toBe(0);
  });

  it("layout plants infer ground that remains after removal; spawning does not erase ground", () => {
    const planted = start(singlePlot(painted(layout([["wheat", 4, 4]]), "sand", 4, 4), {}));
    expect(planted.plots[0].groundTiles["4,4"]).toBe("farmland");
    planted.plots[0].plants = [];
    expect(planted.plots[0].groundTiles["4,4"]).toBe("farmland");
    const placed = start(singlePlot(layout([["chloronite", 2, 2]]), {}));
    expect(placed.plots[0].groundTiles["2,2"]).toBe(engine.data.mutations.chloronite.ground);
    const s = ashwreathReady(layout([], [["ashwreath", 4, 4]]));
    const before = structuredClone(s.plots[0].groundTiles);
    const spawned = engine.run(s, 1).state;
    expect(spawned.plots[0].groundTiles).toEqual(before);
    expect(s.plots[0].groundTiles).toEqual(before); // run never mutates its input
  });

  it("a step transition replaces paint and clears Chorus ground without erasing identical plants", () => {
    const first = painted(layout([["wheat", 1, 1]]), "sand", 5, 5);
    const second = painted(layout([["wheat", 1, 1]]), "mycelium", 6, 6);
    const sc = scenario([flow([step("one", first, [{ kind: "cycles", n: 1 }]), step("two", second)], false)], {});
    const s = start(sc);
    const plantId = s.plots[0].plants[0].id;
    s.plots[0].groundOverrides["0,0"] = "end_stone";
    const r = engine.run(s, 1);
    expect(r.state.plots[0].groundTiles).toEqual({ "1,1": "farmland", "6,6": "mycelium" });
    expect(r.state.plots[0].groundOverrides).toEqual({});
    expect(r.state.plots[0].plants[0].id).toBe(plantId);
  });

  it("the online player swaps wrong ground under an empty target back (fixGround)", () => {
    const online = { kind: "everyN" as const, n: 1, offset: 0 };
    const s = start(singlePlot(layout([], [["ashwreath", 4, 4]]), { activity: online }));
    s.plots[0].groundOverrides["4,4"] = "end_stone";
    const r = engine.run(s, 1);
    expect(r.state.plots[0].groundOverrides["4,4"]).toBeUndefined();
    expect(r.events.filter((e) => e.kind === "groundFixed")).toMatchObject([{ row: 4, col: 4, from: "end_stone", to: "soul_sand", mutationId: "ashwreath" }]);
    // Already right: nothing to do.
    expect(engine.run(r.state, 1).events.some((e) => e.kind === "groundFixed")).toBe(false);
  });

  it("fixGround skips occupied cells, respects the policy and needs the player online", () => {
    const online = { kind: "everyN" as const, n: 1, offset: 0 };
    const occupied = start(singlePlot(layout([], [["ashwreath", 4, 4]]), { activity: online, policies: { spawnedHarvest: "never", clearTargetBlockers: false } }));
    occupied.plots[0].groundOverrides["4,4"] = "end_stone";
    inject(occupied, 1, "chorus_fruit", 4, 4, "spawned", { stage: 12 });
    expect(engine.run(occupied, 1).state.plots[0].groundOverrides["4,4"]).toBe("end_stone");

    const off = start(singlePlot(layout([], [["ashwreath", 4, 4]]), { activity: online, policies: { fixGround: false } }));
    off.plots[0].groundOverrides["4,4"] = "end_stone";
    expect(engine.run(off, 1).state.plots[0].groundOverrides["4,4"]).toBe("end_stone");

    const away = start(singlePlot(layout([], [["ashwreath", 4, 4]]), { activity: NEVER_ACTIVE }));
    away.plots[0].groundOverrides["4,4"] = "end_stone";
    expect(engine.run(away, 1).state.plots[0].groundOverrides["4,4"]).toBe("end_stone");
  });

  describe("clearTargetBlockers", () => {
    const online = { kind: "everyN" as const, n: 1, offset: 0 };
    // Soggybud never finishes without wet neighbours: a growing one is a permanent blocker.
    // spawnedHarvest "never" keeps the same-kind target from being harvested normally.
    const blocked = (opts: { policies?: object; activity?: typeof NEVER_ACTIVE } = {}) => {
      const s = start(singlePlot(layout([], [["ashwreath", 4, 4], ["ashwreath", 6, 6]]), { activity: online, ...opts, policies: { spawnedHarvest: "never", ...opts.policies } }));
      const sog = inject(s, 1, "soggybud", 4, 4, "spawned", { stage: 3 });
      const same = inject(s, 1, "ashwreath", 6, 6, "spawned", { stage: 1 });
      const outside = inject(s, 1, "soggybud", 0, 0, "spawned", { stage: 3 });
      return { s, sog, same, outside };
    };

    it("breaks a foreign growing spawn on a target cell, keeps same-kind targets and off-target spawns", () => {
      const { s, sog, same, outside } = blocked();
      const r = engine.run(s, 1);
      const ids = r.state.plots[0].plants.map((p) => p.id);
      expect(ids).not.toContain(sog.id);
      expect(ids).toContain(same.id);
      expect(ids).toContain(outside.id);
      expect(r.events).toContainEqual(expect.objectContaining({ kind: "destroyed", plantId: sog.id, by: "blocking target" }));
    });

    it("harvests a fully grown blocker instead of breaking it", () => {
      const s = start(singlePlot(layout([], [["ashwreath", 4, 4]]), { activity: online, policies: { spawnedHarvest: "never" } }));
      const grown = inject(s, 1, "chorus_fruit", 4, 4, "spawned");
      grown.stage = grown.readyStage;
      grown.lockedEffects = [];
      const r = engine.run(s, 1);
      expect(r.events).toContainEqual(expect.objectContaining({ kind: "harvested", plantId: grown.id }));
    });

    it("respects the policy (off) and needs the player online", () => {
      const off = blocked({ policies: { clearTargetBlockers: false } });
      expect(engine.run(off.s, 1).state.plots[0].plants.map((p) => p.id)).toContain(off.sog.id);
      const away = blocked({ activity: NEVER_ACTIVE });
      expect(engine.run(away.s, 1).state.plots[0].plants.map((p) => p.id)).toContain(away.sog.id);
    });

    it("clears a leftover on the next step's target cells right at the step change", () => {
      const first = layout([["melon", 4, 5]]);
      const second = layout([], [["ashwreath", 4, 4]]);
      const s = start(scenario([flow([step("one", first, [{ kind: "cycles", n: 1 }]), step("two", second)])], { activity: online }));
      const sog = inject(s, 1, "soggybud", 4, 4, "spawned", { stage: 3 });
      const r = engine.run(s, 1);
      expect(r.events).toContainEqual(expect.objectContaining({ kind: "stepChanged", toStep: "two" }));
      expect(r.state.plots[0].plants.map((p) => p.id)).not.toContain(sog.id);
    });
  });

  it("rejects unknown or out-of-bounds explicitly painted ground", () => {
    expect(engine.validate(singlePlot(painted(layout(), "lava", 1, 1))).some((i) => i.level === "error" && i.message.includes("unknown ground"))).toBe(true);
    expect(engine.validate(singlePlot(painted(layout(), "sand", 10, 0))).some((i) => i.level === "error" && i.message.includes("ground tile"))).toBe(true);
  });
});
