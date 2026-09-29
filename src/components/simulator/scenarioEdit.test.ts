import { describe, expect, it } from "vitest";
import { decodeDesign } from "../../utilities/designEncoding";
import { layoutCode, layoutToPlacements, placementsToCode } from "./scenarioEdit";

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
