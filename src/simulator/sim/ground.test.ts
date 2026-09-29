import { describe, expect, it } from "vitest";
import { engine, flow, inject, layout, NEVER_ACTIVE, scenario, singlePlot, stage, start } from "../testHelpers";
import type { LayoutSpec } from "../flow/types";

const slotsOnly = { spawnCells: "slotsOnly" as const };

const painted = (spec: LayoutSpec, ground: string, row: number, col: number): LayoutSpec => ({
  ...spec,
  groundTiles: [{ ground, row, col }],
});

/** Ashwreath needs soul sand and two nether wart + two fire in its ring. */
const ashwreathReady = (spec: LayoutSpec) => {
  const s = start(singlePlot(spec, { config: slotsOnly, activity: NEVER_ACTIVE }));
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
    const opts = { config: { spawnCells: "allEmpty" as const, blankFillTo: 1 }, activity: NEVER_ACTIVE };
    const bare = start(singlePlot(layout(), opts));
    expect(bare.plots[0].groundTiles["0,0"]).toBeUndefined();
    expect(engine.run(bare, 1).state.plots[0].plants).toHaveLength(0);
    const explicit = start(singlePlot(painted(layout(), "farmland", 0, 0), opts));
    expect(explicit.plots[0].groundTiles["0,0"]).toBe("farmland");
    expect(engine.run(explicit, 1).state.plots[0].plants).toMatchObject([{ kindId: "lonelily", row: 0, col: 0 }]);
  });

  it("a painted bare cell supports a mutation without any slot label", () => {
    const spec = painted(layout([ ["nether_wart", 0, 0], ["nether_wart", 0, 2], ["fire", 1, 0], ["fire", 1, 1] ]), "soul_sand", 0, 1);
    const opts = { config: { spawnCells: "allEmpty" as const, blankFillTo: 1 }, activity: NEVER_ACTIVE };
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
    const s = start(singlePlot(layout(ring, [["glasscorn", 4, 4]]), { config: slotsOnly, activity: NEVER_ACTIVE }));
    for (const key of ["4,4", "4,5", "5,4", "5,5"]) expect(s.plots[0].groundTiles[key]).toBe("sand");
    const broken = structuredClone(s);
    broken.plots[0].groundOverrides["5,5"] = "farmland";
    expect(engine.run(broken, 1).state.plots[0].slotIneligibleCycles["4,4"]).toBe(1);
    expect(engine.run(s, 1).state.plots[0].slotIneligibleCycles["4,4"]).toBe(0);
  });

  it("layout plants infer ground that remains after removal; spawning does not erase ground", () => {
    const planted = start(singlePlot(painted(layout([["wheat", 4, 4]]), "sand", 4, 4), { config: slotsOnly }));
    expect(planted.plots[0].groundTiles["4,4"]).toBe("farmland");
    planted.plots[0].plants = [];
    expect(planted.plots[0].groundTiles["4,4"]).toBe("farmland");
    const placed = start(singlePlot(layout([["chloronite", 2, 2]]), { config: slotsOnly }));
    expect(placed.plots[0].groundTiles["2,2"]).toBe(engine.data.mutations.chloronite.ground);
    const s = ashwreathReady(layout([], [["ashwreath", 4, 4]]));
    const before = structuredClone(s.plots[0].groundTiles);
    const spawned = engine.run(s, 1).state;
    expect(spawned.plots[0].groundTiles).toEqual(before);
    expect(s.plots[0].groundTiles).toEqual(before); // run never mutates its input
  });

  it("a stage transition replaces paint and clears Chorus ground without erasing identical plants", () => {
    const first = painted(layout([["wheat", 1, 1]]), "sand", 5, 5);
    const second = painted(layout([["wheat", 1, 1]]), "mycelium", 6, 6);
    const sc = scenario([flow([stage("one", first, [{ kind: "cycles", n: 1 }]), stage("two", second)], false)], { config: slotsOnly });
    const s = start(sc);
    const plantId = s.plots[0].plants[0].id;
    s.plots[0].groundOverrides["0,0"] = "end_stone";
    const r = engine.run(s, 1);
    expect(r.state.plots[0].groundTiles).toEqual({ "1,1": "farmland", "6,6": "mycelium" });
    expect(r.state.plots[0].groundOverrides).toEqual({});
    expect(r.state.plots[0].plants[0].id).toBe(plantId);
  });

  it("rejects unknown or out-of-bounds explicitly painted ground", () => {
    expect(engine.validate(singlePlot(painted(layout(), "lava", 1, 1))).some((i) => i.level === "error" && i.message.includes("unknown ground"))).toBe(true);
    expect(engine.validate(singlePlot(painted(layout(), "sand", 10, 0))).some((i) => i.level === "error" && i.message.includes("ground tile"))).toBe(true);
  });
});
