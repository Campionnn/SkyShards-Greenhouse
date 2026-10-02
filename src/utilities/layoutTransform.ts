// Whole-layout nudge, rotate and mirror for the 10x10 designer grid. Pure
// functions over top-left anchors and square footprints, so a 2x2 or 3x3
// piece covers the same transformed cells.

import type { GroundTile } from "./designEncoding";

export const LAYOUT_GRID_SIZE = 10;

export type LayoutTransform =
  | { kind: "nudge"; dRow: number; dCol: number }
  | { kind: "rotate"; direction: "cw" | "ccw" }
  | { kind: "mirror"; axis: "horizontal" | "vertical" };

/** Anything placed on the grid: an anchor and a square footprint. */
export interface TransformablePiece {
  position: [number, number];
  size: number;
}

/**
 * New anchor of a size x size piece. Rotations and mirrors stay in bounds; a
 * nudge may not (see `fitsGrid`).
 *
 * - rotate cw: cell (r, c) -> (c, N-1-r)
 * - rotate ccw: cell (r, c) -> (N-1-c, r)
 * - mirror horizontal (left <-> right): (r, c) -> (r, N-1-c)
 * - mirror vertical (top <-> bottom): (r, c) -> (N-1-r, c)
 */
export function transformAnchor(position: [number, number], size: number, t: LayoutTransform, n = LAYOUT_GRID_SIZE): [number, number] {
  const [r, c] = position;
  switch (t.kind) {
    case "nudge":
      return [r + t.dRow, c + t.dCol];
    case "rotate":
      return t.direction === "cw" ? [c, n - size - r] : [n - size - c, r];
    case "mirror":
      return t.axis === "horizontal" ? [r, n - size - c] : [n - size - r, c];
  }
}

export function fitsGrid(position: [number, number], size: number, n = LAYOUT_GRID_SIZE): boolean {
  const [r, c] = position;
  return r >= 0 && c >= 0 && r + size <= n && c + size <= n;
}

export interface TransformedLayout<P extends TransformablePiece> {
  inputs: P[];
  targets: P[];
  groundTiles: GroundTile[];
  /** Ground tiles pushed off the grid by a nudge (they are dropped). */
  droppedGround: number;
}

/**
 * Transforms a whole layout. Returns null when a nudge would push a crop or
 * target off the grid; ground tiles that fall off are dropped so a fully
 * painted floor never blocks a nudge.
 */
export function transformLayout<P extends TransformablePiece>(
  layout: { inputs: P[]; targets: P[]; groundTiles: GroundTile[] },
  t: LayoutTransform,
  n = LAYOUT_GRID_SIZE
): TransformedLayout<P> | null {
  const move = (p: P): P | null => {
    const position = transformAnchor(p.position, p.size, t, n);
    return fitsGrid(position, p.size, n) ? { ...p, position } : null;
  };
  const inputs = layout.inputs.map(move);
  const targets = layout.targets.map(move);
  if (inputs.includes(null) || targets.includes(null)) return null;

  const groundTiles: GroundTile[] = [];
  for (const tile of layout.groundTiles) {
    const position = transformAnchor(tile.position, 1, t, n);
    if (fitsGrid(position, 1, n)) groundTiles.push({ ground: tile.ground, position });
  }
  return {
    inputs: inputs as P[],
    targets: targets as P[],
    groundTiles,
    droppedGround: layout.groundTiles.length - groundTiles.length,
  };
}

/** Whether a nudge keeps every crop and target on the grid. */
export function canNudge(pieces: TransformablePiece[], dRow: number, dCol: number, n = LAYOUT_GRID_SIZE): boolean {
  if (pieces.length === 0) return false;
  return pieces.every((p) => fitsGrid([p.position[0] + dRow, p.position[1] + dCol], p.size, n));
}

/** Human label, e.g. for toasts. */
export function describeTransform(t: LayoutTransform): string {
  switch (t.kind) {
    case "nudge": {
      const dir = t.dRow < 0 ? "up" : t.dRow > 0 ? "down" : t.dCol < 0 ? "left" : "right";
      return `Nudged ${dir}`;
    }
    case "rotate":
      return t.direction === "cw" ? "Rotated clockwise" : "Rotated counter-clockwise";
    case "mirror":
      return t.axis === "horizontal" ? "Mirrored left to right" : "Mirrored top to bottom";
  }
}
