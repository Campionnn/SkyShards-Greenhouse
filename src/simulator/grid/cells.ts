/**
 * Plot geometry: a fully unlocked 10x10 grid (Q1), cell index `row * 10 + col`.
 * Two adjacency rules, never mixed: CARDINAL (4-way) for crop effects, RING8
 * (8-way) for mutation spawn requirements.
 */

export const GRID_SIZE = 10;
export const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;

export const CARDINAL: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export const RING8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export const cellIndex = (row: number, col: number): number => row * GRID_SIZE + col;
export const cellRow = (index: number): number => Math.floor(index / GRID_SIZE);
export const cellCol = (index: number): number => index % GRID_SIZE;
export const cellKey = (row: number, col: number): string => `${row},${col}`;

export const inBounds = (row: number, col: number): boolean =>
  row >= 0 && col >= 0 && row < GRID_SIZE && col < GRID_SIZE;

/** Does a size x size footprint anchored (top-left) at row,col fit on the plot? */
export function footprintFits(row: number, col: number, size: number): boolean {
  return inBounds(row, col) && inBounds(row + size - 1, col + size - 1);
}

const footprintCache = new Map<number, number[]>();

/** Cell indices of a footprint anchored at its top-left. Caller checks it fits. */
export function footprint(row: number, col: number, size: number): number[] {
  const k = cellIndex(row, col) * 4 + size;
  let out = footprintCache.get(k);
  if (!out) {
    out = [];
    for (let dr = 0; dr < size; dr++) {
      for (let dc = 0; dc < size; dc++) out.push(cellIndex(row + dr, col + dc));
    }
    footprintCache.set(k, out);
  }
  return out;
}

const ringCache = new Map<number, number[]>();

/** On-plot cells 8-way adjacent to a footprint. Requirements count cells here, not entities. */
export function ringCells(row: number, col: number, size: number): number[] {
  const k = cellIndex(row, col) * 4 + size;
  let out = ringCache.get(k);
  if (!out) {
    const own = new Set(footprint(row, col, size));
    const seen = new Set<number>();
    out = [];
    for (const idx of footprint(row, col, size)) {
      const r = cellRow(idx);
      const c = cellCol(idx);
      for (const [dr, dc] of RING8) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const n = cellIndex(nr, nc);
        if (own.has(n) || seen.has(n)) continue;
        seen.add(n);
        out.push(n);
      }
    }
    out.sort((a, b) => a - b);
    ringCache.set(k, out);
  }
  return out;
}
