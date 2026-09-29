import { describe, expect, it } from "vitest";
import { getPaintableGroundPreviewPosition } from "./useDesignerGridPlacement";
import type { DesignerPlacement } from "../context";

const crop: DesignerPlacement = {
  id: "crop-1",
  cropId: "berry",
  cropName: "Berry",
  size: 2,
  position: [2, 3],
  isMutation: false,
};
const target: DesignerPlacement = {
  id: "target-1",
  cropId: "mutation",
  cropName: "Mutation",
  size: 1,
  position: [6, 7],
  isMutation: true,
};

const getPlacementAt = (row: number, col: number) =>
  [crop, target].find(({ position: [r, c], size }) =>
    row >= r && row < r + size && col >= c && col < c + size
  );

describe("ground hover preview", () => {
  it("shows on a bare cell when ground is selected (including repaintable ground)", () => {
    expect(getPaintableGroundPreviewPosition([0, 0], true, false, getPlacementAt)).toEqual([0, 0]);
    expect(getPaintableGroundPreviewPosition([9, 9], true, false, getPlacementAt)).toEqual([9, 9]);
  });

  it("does not show over any cell of a crop or target footprint", () => {
    expect(getPaintableGroundPreviewPosition([3, 4], true, false, getPlacementAt)).toBeNull();
    expect(getPaintableGroundPreviewPosition([6, 7], true, false, getPlacementAt)).toBeNull();
  });

  it("hides without ground selection or hover, and while painting or dragging", () => {
    expect(getPaintableGroundPreviewPosition([0, 0], false, false, getPlacementAt)).toBeNull();
    expect(getPaintableGroundPreviewPosition(null, true, false, getPlacementAt)).toBeNull();
    expect(getPaintableGroundPreviewPosition([0, 0], true, true, getPlacementAt)).toBeNull();
  });
});
