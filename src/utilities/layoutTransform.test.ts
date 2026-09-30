import { describe, expect, it } from "vitest";
import type { GroundTile } from "./designEncoding";
import { canNudge, transformAnchor, transformLayout, type LayoutTransform } from "./layoutTransform";

const cells = (p: { position: [number, number]; size: number }) => {
  const out: string[] = [];
  for (let dr = 0; dr < p.size; dr++) for (let dc = 0; dc < p.size; dc++) out.push(`${p.position[0] + dr},${p.position[1] + dc}`);
  return out.sort();
};

describe("layout transforms", () => {
  it("rotates a 1x1 clockwise and back", () => {
    expect(transformAnchor([0, 0], 1, { kind: "rotate", direction: "cw" })).toEqual([0, 9]);
    expect(transformAnchor([0, 9], 1, { kind: "rotate", direction: "ccw" })).toEqual([0, 0]);
    expect(transformAnchor([2, 3], 1, { kind: "rotate", direction: "cw" })).toEqual([3, 7]);
  });

  it("keeps multi-cell footprints on the transformed cells", () => {
    const piece = { position: [1, 2] as [number, number], size: 3 };
    const all: LayoutTransform[] = [
      { kind: "rotate", direction: "cw" },
      { kind: "rotate", direction: "ccw" },
      { kind: "mirror", axis: "horizontal" },
      { kind: "mirror", axis: "vertical" },
    ];
    const cellMap: Record<string, (r: number, c: number) => string> = {
      "rotate-cw": (r, c) => `${c},${9 - r}`,
      "rotate-ccw": (r, c) => `${9 - c},${r}`,
      "mirror-horizontal": (r, c) => `${r},${9 - c}`,
      "mirror-vertical": (r, c) => `${9 - r},${c}`,
    };
    for (const t of all) {
      const key = t.kind === "rotate" ? `rotate-${t.direction}` : t.kind === "mirror" ? `mirror-${t.axis}` : "";
      const moved = { ...piece, position: transformAnchor(piece.position, piece.size, t) };
      const expected = cells(piece).map((k) => cellMap[key](...(k.split(",").map(Number) as [number, number]))).sort();
      expect(cells(moved)).toEqual(expected);
    }
  });

  it("four rotations and two mirrors are identities", () => {
    const layout = {
      inputs: [{ id: "a", position: [0, 0] as [number, number], size: 2 }],
      targets: [{ id: "b", position: [4, 7] as [number, number], size: 1 }],
      groundTiles: [{ ground: "sand", position: [9, 3] }] as GroundTile[],
    };
    let cur = layout;
    for (let i = 0; i < 4; i++) cur = transformLayout(cur, { kind: "rotate", direction: "cw" })!;
    expect(cur).toMatchObject(layout);
    let m = transformLayout(layout, { kind: "mirror", axis: "vertical" })!;
    m = transformLayout(m, { kind: "mirror", axis: "vertical" })!;
    expect(m).toMatchObject(layout);
  });

  it("refuses a nudge that pushes a crop off the grid but drops ground", () => {
    const layout = {
      inputs: [{ position: [0, 5] as [number, number], size: 1 }],
      targets: [],
      groundTiles: [{ ground: "sand" as const, position: [9, 0] as [number, number] }],
    };
    expect(transformLayout(layout, { kind: "nudge", dRow: -1, dCol: 0 })).toBeNull();
    const down = transformLayout(layout, { kind: "nudge", dRow: 1, dCol: 0 })!;
    expect(down.inputs[0].position).toEqual([1, 5]);
    expect(down.groundTiles).toEqual([]);
    expect(down.droppedGround).toBe(1);
    expect(canNudge(layout.inputs, -1, 0)).toBe(false);
    expect(canNudge(layout.inputs, 0, 4)).toBe(true);
    expect(canNudge(layout.inputs, 0, 5)).toBe(false);
  });
});
