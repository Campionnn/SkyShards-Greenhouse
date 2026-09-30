import { describe, expect, it } from "vitest";
import { decodeDesign } from "../../utilities/designEncoding";
import { layoutCode, layoutToPlacements, placementsToCode, transformWatch } from "./scenarioEdit";

const tiles = [
  { ground: "soul_sand" as const, position: [2, 3] as [number, number] },
  { ground: "end_stone" as const, position: [7, 8] as [number, number] },
];

describe("simulator stage layout editor ground roundtrip", () => {
  it("keeps bare ground through an embedded editor edit", () => {
    const code = placementsToCode([], [], tiles);
    const initial = layoutToPlacements({ code });
    expect(initial.groundTiles).toEqual(tiles);
    const edited = placementsToCode(initial.inputs, initial.targets, initial.groundTiles);
    expect(decodeDesign(edited).groundTiles).toEqual(tiles);
  });

  it("keeps structured layout ground when converted to an editor code", () => {
    const spec = {
      plants: [], slots: [],
      groundTiles: [{ ground: "sand", row: 4, col: 5 }],
    };
    expect(layoutToPlacements(spec).groundTiles).toEqual([{ ground: "sand", position: [4, 5] }]);
    expect(decodeDesign(layoutCode(spec)).groundTiles).toEqual([{ ground: "sand", position: [4, 5] }]);
  });
});

describe("watched targets follow a layout transform", () => {
  it("moves watch keys with the rotated / mirrored targets", () => {
    const code = placementsToCode([], [
      { id: "a", cropId: "chloronite", cropName: "", size: 1, position: [0, 0], isMutation: true },
      { id: "b", cropId: "chloronite", cropName: "", size: 1, position: [3, 4], isMutation: true },
    ]);
    const stage = { id: "s", layout: { code }, exit: [], watch: ["3,4"] };
    expect(transformWatch(stage, { kind: "rotate", direction: "cw" }).watch).toEqual(["4,6"]);
    expect(transformWatch(stage, { kind: "mirror", axis: "horizontal" }).watch).toEqual(["3,5"]);
    expect(transformWatch(stage, { kind: "nudge", dRow: 1, dCol: 0 }).watch).toEqual(["4,4"]);
    const all = { id: "s", layout: { code }, exit: [] };
    expect(transformWatch(all, { kind: "rotate", direction: "cw" })).toBe(all);
  });
});
