// The requirement picture's geometry, shared by the wiki (the picture and its counts), the Calculator's
// mutation pickers and the simulator's tooltip. A recipe count in data.json is RING CELLS (the game, and the
// simulator's ring count): a 3×3 Snoozling whose edge lies along one side fills 3 of them, so PlantBoy
// Advance's 6 Snoozling cells take 2 Snoozlings. requirementPlants turns cells into plants.

/** One recipe ingredient: how many of the cells around the target it must fill (null: not placed). */
export interface LayoutNeed {
  id: string;
  cells: number | null;
}
export interface RingCell {
  row: number;
  col: number;
  id: string | null;
}

/** The (size+2)² ring around a size×size target, clockwise from the top-left. */
export function ringCells(size: number): { row: number; col: number }[] {
  const n = size + 2;
  const cells: { row: number; col: number }[] = [];
  for (let c = 0; c < n; c++) cells.push({ row: 0, col: c });
  for (let r = 1; r < n; r++) cells.push({ row: r, col: n - 1 });
  for (let c = n - 2; c >= 0; c--) cells.push({ row: n - 1, col: c });
  for (let r = n - 2; r >= 1; r--) cells.push({ row: r, col: 0 });
  return cells;
}

/** A multi-cell ingredient in the picture: its whole footprint, and how many ring cells it covers. */
export interface BigPiece {
  row: number;
  col: number;
  size: number;
  id: string;
  ringCells: number;
}

/** The requirement picture, in its own box (0-based rows/cols): the target, the ring, the big ingredients. */
export interface RequirementLayout {
  rows: number;
  cols: number;
  target: { row: number; col: number; size: number };
  /** The ring cells no big ingredient covers: a 1×1 ingredient, or empty. */
  ring: RingCell[];
  /** Multi-cell ingredients, each drawn once at its full size. */
  bigs: BigPiece[];
  /** How many plants of each ingredient the picture uses (a 3×3 covering 3 ring cells counts once). */
  plants: Record<string, number>;
}

/** Ring cell indexes, side middles before corners (Ashwreath's 2 + 2 read as left/right + top/bottom, like the Hypixel wiki). */
function spreadOrder(size: number): number[] {
  const n = size + 2;
  const mid = (n - 1) / 2;
  return ringCells(size)
    .map((c, i) => ({ i, d: Math.min(Math.abs(c.row - mid), Math.abs(c.col - mid)), side: c.col === 0 ? 0 : c.col === n - 1 ? 1 : c.row === 0 ? 2 : 3 }))
    .sort((a, b) => a.d - b.d || a.side - b.side || a.i - b.i)
    .map((x) => x.i);
}

/** One plant of a multi-cell ingredient: its top-left, its cells, how many ring cells it covers. */
interface Spot {
  row: number;
  col: number;
  cells: string[];
  ring: number;
}

const cellKey = (r: number, c: number) => `${r},${c}`;
const overlaps = (a: Spot, used: Set<string>) => a.cells.some((k) => used.has(k));

/**
 * The sets of s×s plants (not overlapping each other or the target) that cover exactly `count` ring cells,
 * with the fewest plants and one more (so two big needs can still fit together). Coordinates: the ring is
 * rows/cols 0..n-1 with the target inside; plants may stick out of it.
 */
function spotSets(targetSize: number, s: number, count: number): Spot[][] {
  const n = targetSize + 2;
  const ring = new Set(ringCells(targetSize).map((c) => cellKey(c.row, c.col)));
  const spots: Spot[] = [];
  for (let r = 1 - s; r <= n - 1; r++)
    for (let c = 1 - s; c <= n - 1; c++) {
      const cells: string[] = [];
      let hit = 0;
      let inTarget = false;
      for (let dr = 0; dr < s; dr++)
        for (let dc = 0; dc < s; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 1 && rr <= targetSize && cc >= 1 && cc <= targetSize) inTarget = true;
          cells.push(cellKey(rr, cc));
          if (ring.has(cellKey(rr, cc))) hit++;
        }
      if (!inTarget && hit > 0 && hit <= count) spots.push({ row: r, col: c, cells, ring: hit });
    }
  const out: Spot[][] = [];
  let fewest = Infinity;
  for (let k = 1; k <= count && k <= fewest + 1; k++) {
    const walk = (from: number, left: number, chosen: Spot[], used: Set<string>) => {
      if (chosen.length === k) {
        if (left === 0) out.push([...chosen]);
        return;
      }
      for (let i = from; i < spots.length; i++) {
        const p = spots[i];
        if (p.ring > left || overlaps(p, used)) continue;
        chosen.push(p);
        walk(i + 1, left - p.ring, chosen, new Set([...used, ...p.cells]));
        chosen.pop();
      }
    };
    const before = out.length;
    walk(0, count, [], new Set());
    if (out.length > before && fewest === Infinity) fewest = k;
  }
  return out;
}

const layoutCache = new Map<string, RequirementLayout>();

/**
 * The requirement picture. A recipe count is ring CELLS (the game, and the simulator's ring count): a 3×3
 * Snoozling whose edge lies along one side fills 3 of them. So a 1×1 need takes one ring cell each (a full
 * ring fills clockwise, a part-full one spreads out), and a bigger need is drawn at its real size, sticking
 * out of the ring, with as few plants as cover its count: Plantboy Advance's 6 Snoozling cells are two
 * Snoozlings. Ties go to the more compact, squarer, more centred picture (within the 10×10 greenhouse).
 */
export function requirementLayout(sizeOf: (id: string) => number, targetSize: number, needs: LayoutNeed[]): RequirementLayout {
  const cellsOf = (x: LayoutNeed) => x.cells ?? 0;
  const cacheKey = `${targetSize}|${needs.map((x) => `${x.id}:${x.cells}`).join(",")}`;
  const cached = layoutCache.get(cacheKey);
  if (cached) return cached;
  const counted = needs.filter((x) => cellsOf(x) > 0);
  const big = counted.filter((x) => sizeOf(x.id) > 1);
  const small = counted.filter((x) => sizeOf(x.id) === 1);
  const cells = ringCells(targetSize);
  const n = targetSize + 2;
  const smallTotal = small.reduce((s, x) => s + cellsOf(x), 0);

  const options = big.map((x) => spotSets(targetSize, sizeOf(x.id), cellsOf(x)));
  let best: { score: number[]; sets: Spot[][] } | null = null;
  const better = (a: number[], b: number[]) => {
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
    return false;
  };
  const search = (i: number, chosen: Spot[][], used: Set<string>) => {
    if (i === big.length) {
      const free = cells.filter((c) => !used.has(cellKey(c.row, c.col))).length;
      if (free < smallTotal) return;
      let r0 = 0, c0 = 0, r1 = n - 1, c1 = n - 1;
      chosen.forEach((set, j) =>
        set.forEach((p) => {
          const s = sizeOf(big[j].id);
          r0 = Math.min(r0, p.row);
          c0 = Math.min(c0, p.col);
          r1 = Math.max(r1, p.row + s - 1);
          c1 = Math.max(c1, p.col + s - 1);
        }),
      );
      const h = r1 - r0 + 1;
      const w = c1 - c0 + 1;
      if (h > 10 || w > 10) return;
      const off = Math.abs((r0 + r1) / 2 - (n - 1) / 2) + Math.abs((c0 + c1) / 2 - (n - 1) / 2);
      const score = [chosen.reduce((s, set) => s + set.length, 0), h * w, Math.abs(h - w), off];
      if (!best || better(score, best.score)) best = { score, sets: chosen.map((set) => [...set]) };
      return;
    }
    for (const set of options[i]) {
      if (set.some((p) => overlaps(p, used))) continue;
      chosen.push(set);
      search(i + 1, chosen, new Set([...used, ...set.flatMap((p) => p.cells)]));
      chosen.pop();
    }
  };
  search(0, [], new Set());
  const sets: Spot[][] = (best as { sets: Spot[][] } | null)?.sets ?? big.map(() => []);

  const covered = new Set(sets.flatMap((set) => set.flatMap((p) => p.cells)));
  const free = cells.map((_, i) => i).filter((i) => !covered.has(cellKey(cells[i].row, cells[i].col)));
  const ids: string[] = [];
  for (const x of small) for (let k = 0; k < cellsOf(x); k++) ids.push(x.id);
  const order = ids.length >= free.length ? free : spreadOrder(targetSize).filter((i) => free.includes(i));
  const at = new Map<number, string>();
  ids.forEach((id, k) => order[k] !== undefined && at.set(order[k], id));

  let r0 = 0, c0 = 0, r1 = n - 1, c1 = n - 1;
  const bigs: BigPiece[] = [];
  sets.forEach((set, j) =>
    set.forEach((p) => {
      const s = sizeOf(big[j].id);
      r0 = Math.min(r0, p.row);
      c0 = Math.min(c0, p.col);
      r1 = Math.max(r1, p.row + s - 1);
      c1 = Math.max(c1, p.col + s - 1);
      bigs.push({ row: p.row, col: p.col, size: s, id: big[j].id, ringCells: p.ring });
    }),
  );
  const plants: Record<string, number> = {};
  for (const x of small) plants[x.id] = cellsOf(x);
  sets.forEach((set, j) => (plants[big[j].id] = set.length || cellsOf(big[j])));
  const layout: RequirementLayout = {
    rows: r1 - r0 + 1,
    cols: c1 - c0 + 1,
    target: { row: 1 - r0, col: 1 - c0, size: targetSize },
    ring: free.map((i) => ({ row: cells[i].row - r0, col: cells[i].col - c0, id: at.get(i) ?? null })),
    bigs: bigs.map((b) => ({ ...b, row: b.row - r0, col: b.col - c0 })),
    plants,
  };
  layoutCache.set(cacheKey, layout);
  return layout;
}

/**
 * How many plants of each ingredient a recipe takes: the cell count for a 1×1 crop, the fewest plants that
 * cover that many ring cells for a bigger one (`sizeOf`: an item's footprint, 1 for unknown ids).
 */
export function requirementPlants(sizeOf: (id: string) => number, targetSize: number, requirements: { crop: string; count: number }[]): Record<string, number> {
  if (!requirements.length) return {};
  return requirementLayout(sizeOf, targetSize, requirements.map((r) => ({ id: r.crop, cells: r.count }))).plants;
}
