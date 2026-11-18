import { describe, expect, it } from "vitest";
import { engine, flow, inject, layout, scenario, step, start } from "../testHelpers";

// Game rule: the ground under a standing plant can't change, and a plant only goes on its own ground.
const online = { kind: "everyN" as const, n: 1, offset: 0 };
const g = (s: ReturnType<typeof start>, k: string) => s.plots[0].groundOverrides[k] ?? s.plots[0].groundTiles[k];
const two = (first: ReturnType<typeof layout>, second: ReturnType<typeof layout>, policies = {}) =>
  start(scenario([flow([step("one", first, [{ kind: "cycles", n: 1 }]), step("two", second)])], { activity: online, policies }));

describe("ground under standing plants", () => {
  it("a step change keeps the farmland under a growing PlantBoy Advance the new step doesn't paint", () => {
    const first = { ...layout([["wheat", 0, 0]]), groundTiles: [4, 5].flatMap((r) => [4, 5].map((c) => ({ ground: "farmland", row: r, col: c }))) };
    const s = two(first, layout([["wheat", 0, 0]]));
    inject(s, 1, "plantboy_advance", 4, 4, "spawned", { stage: 1 });
    const r = engine.run(s, 1);
    expect(r.events).toContainEqual(expect.objectContaining({ kind: "stepChanged", toStep: "two" }));
    expect(r.state.plots[0].plants.some((p) => p.kindId === "plantboy_advance")).toBe(true);
    for (const k of ["4,4", "4,5", "5,4", "5,5"]) expect(g(r.state, k)).toBe("farmland");
    // It keeps growing on the next cycles (ground still fits).
    expect(engine.run(r.state, 3).state.plots[0].plants.find((p) => p.kindId === "plantboy_advance")!.stage).toBeGreaterThan(1);
  });

  it("a step change keeps the End Stone under a Chorus Fruit that stays", () => {
    const s = two(layout([["wheat", 0, 0]]), layout([["wheat", 0, 0]]), { spawnedHarvest: "never" });
    inject(s, 1, "chorus_fruit", 6, 6, "spawned", { stage: 12 });
    s.plots[0].groundOverrides["6,6"] = "end_stone";
    s.plots[0].groundOverrides["7,7"] = "end_stone"; // free cell: reset by the new step
    const r = engine.run(s, 1);
    expect(g(r.state, "6,6")).toBe("end_stone");
    expect(g(r.state, "7,7")).toBeUndefined();
  });

  it("the step's own ground wins only on free cells", () => {
    const first = { ...layout([["wheat", 0, 0]]), groundTiles: [{ ground: "farmland", row: 3, col: 3 }] };
    const second = { ...layout([["wheat", 0, 0]]), groundTiles: [{ ground: "sand", row: 3, col: 3 }] };
    const s = two(first, second, { spawnedHarvest: "never" });
    inject(s, 1, "lonelily", 3, 3, "spawned", { stage: 0 });
    const r = engine.run(s, 1);
    expect(g(r.state, "3,3")).toBe("farmland");
  });

  it("re-placing a layout plant on Chorus End Stone swaps the block back first", () => {
    const s = start(scenario([flow([step("one", layout([["wheat", 2, 2]]))])], { activity: online }));
    s.plots[0].plants = [];
    s.plots[0].groundOverrides["2,2"] = "end_stone";
    const r = engine.run(s, 1);
    expect(r.state.plots[0].plants.map((p) => p.kindId)).toEqual(["wheat"]);
    expect(g(r.state, "2,2")).toBe("farmland");
    expect(r.state.plots[0].groundOverrides["2,2"]).toBeUndefined();
  });
});
