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
// Read back as property names, so V8 hands them out internalized: a lookup like
// `plot.groundTiles[cellKey(r, c)]` then needs no string-table lookup or hashing.
const ON_GRID_KEYS: readonly string[] = Object.keys(
  Object.fromEntries(Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => [`${Math.floor(i / GRID_SIZE)},${i % GRID_SIZE}`, i]))
);
/** `cellKey` string -> cell index, for on-grid keys. */
export const KEY_INDEX: ReadonlyMap<string, number> = new Map(ON_GRID_KEYS.map((k, i) => [k, i]));

/** "row,col" (interned for on-grid cells, so hot loops don't build strings). */
export const cellKey = (row: number, col: number): string =>
  row >= 0 && col >= 0 && row < GRID_SIZE && col < GRID_SIZE && Number.isInteger(row) && Number.isInteger(col) ? ON_GRID_KEYS[row * GRID_SIZE + col] : `${row},${col}`;

/** `cellKey` of a cell index. */
export const indexKey = (index: number): string => ON_GRID_KEYS[index];

export const inBounds = (row: number, col: number): boolean =>
  row >= 0 && col >= 0 && row < GRID_SIZE && col < GRID_SIZE;

/** Does a size x size footprint anchored (top-left) at row,col fit on the plot? */
export function footprintFits(row: number, col: number, size: number): boolean {
  return inBounds(row, col) && inBounds(row + size - 1, col + size - 1);
}

const footprintCache = new Map<number, number[]>();
/** Footprints and rings of on-grid anchors with sizes 0-3, by `cellIndex * 4 + size` (no hashing). */
const footprintFast: (number[] | undefined)[] = [];
const ringFast: (number[] | undefined)[] = [];
const fastKey = (row: number, col: number, size: number): number =>
  row >= 0 && col >= 0 && row < GRID_SIZE && col < GRID_SIZE && size >= 0 && size <= 3 && (row | 0) === row && (col | 0) === col && (size | 0) === size
    ? (row * GRID_SIZE + col) * 4 + size
    : -1;

/** Cell indices of a footprint anchored at its top-left. Caller checks it fits. */
export function footprint(row: number, col: number, size: number): number[] {
  const fast = fastKey(row, col, size);
  if (fast >= 0) {
    const hit = footprintFast[fast];
    if (hit) return hit;
  }
  const k = cellIndex(row, col) * 4 + size;
  let out = footprintCache.get(k);
  if (!out) {
    out = [];
    for (let dr = 0; dr < size; dr++) {
      for (let dc = 0; dc < size; dc++) out.push(cellIndex(row + dr, col + dc));
    }
    footprintCache.set(k, out);
  }
  if (fast >= 0) footprintFast[fast] = out;
  return out;
}

const ringCache = new Map<number, number[]>();

/** On-plot cells 8-way adjacent to a footprint. Requirements count cells here, not entities. */
export function ringCells(row: number, col: number, size: number): number[] {
  const fast = fastKey(row, col, size);
  if (fast >= 0) {
    const hit = ringFast[fast];
    if (hit) return hit;
  }
  const k = cellIndex(row, col) * 4 + size;
  let out = ringCache.get(k);
  if (out && fast >= 0) ringFast[fast] = out;
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
    if (fast >= 0) ringFast[fast] = out;
  }
  return out;
}
