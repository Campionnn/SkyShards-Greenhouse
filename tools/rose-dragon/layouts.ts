/**
 * Layout helpers for the Rose Dragon flow tooling: share-code <-> placements,
 * ASCII rendering, input counting and solver-result conversion.
 */
import { decodeDesign, encodeDesign, type GroundTile } from "../../src/utilities/designEncoding";
import { defaultGameData } from "../../src/simulator/data/default";
import type { SolveResult } from "./solver";

export interface Placement {
  cropId: string;
  position: [number, number];
}

export interface Layout {
  inputs: Placement[];
  targets: Placement[];
  ground?: GroundTile[];
}

const data = defaultGameData();
export const sizeOf = (id: string): number => (data.crops[id]?.size ?? data.mutations[id]?.size ?? 1);
export const isBaseCrop = (id: string): boolean => !!data.crops[id] && data.crops[id].growthStages !== null;
/** Items the layout spends from inventory: every non-base-crop input except fire. */
export const isSpent = (id: string): boolean => !isBaseCrop(id) && id !== "fire";

export function encode(l: Layout): string {
  return encodeDesign(l.inputs, l.targets, l.ground ?? []);
}

export function decode(code: string): Layout {
  const d = decodeDesign(code);
  return { inputs: d.inputs, targets: d.targets, ground: d.groundTiles };
}

export function fromSolve(r: SolveResult): Layout {
  return {
    inputs: r.placements.map((p) => ({ cropId: p.crop, position: [p.position[0], p.position[1]] })),
    targets: r.mutations.map((m) => ({ cropId: m.mutation, position: [m.position[0], m.position[1]] })),
  };
}

/** Items placed from inventory (mutations, fermento, dead plants). */
export function inputCost(l: Layout): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of l.inputs) if (isSpent(p.cropId)) out[p.cropId] = (out[p.cropId] ?? 0) + 1;
  return out;
}

export function targetCounts(l: Layout): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of l.targets) out[t.cropId] = (out[t.cropId] ?? 0) + 1;
  return out;
}

/** Translate every entry by (dr, dc). */
export function shift(l: Layout, dr: number, dc: number): Layout {
  const mv = (p: Placement): Placement => ({ cropId: p.cropId, position: [p.position[0] + dr, p.position[1] + dc] });
  return {
    inputs: l.inputs.map(mv),
    targets: l.targets.map(mv),
    ground: (l.ground ?? []).map((g) => ({ ground: g.ground, position: [g.position[0] + dr, g.position[1] + dc] })),
  };
}

/** Union of several layouts (no overlap check beyond the encoder's). */
export function merge(...ls: Layout[]): Layout {
  return { inputs: ls.flatMap((l) => l.inputs), targets: ls.flatMap((l) => l.targets), ground: ls.flatMap((l) => l.ground ?? []) };
}

/** Bounding box of every footprint. */
export function bounds(l: Layout): { r0: number; c0: number; r1: number; c1: number } {
  let r0 = 99, c0 = 99, r1 = -1, c1 = -1;
  for (const p of [...l.inputs, ...l.targets]) {
    const s = sizeOf(p.cropId);
    r0 = Math.min(r0, p.position[0]);
    c0 = Math.min(c0, p.position[1]);
    r1 = Math.max(r1, p.position[0] + s - 1);
    c1 = Math.max(c1, p.position[1] + s - 1);
  }
  return { r0, c0, r1, c1 };
}

/** Move the layout to the top-left corner (or to (r, c)). */
export function normalize(l: Layout, r = 0, c = 0): Layout {
  const b = bounds(l);
  return shift(l, r - b.r0, c - b.c0);
}

/**
 * Hand-drawn layout. `rows`: up to 10 strings of 10 chars ('.' = empty/air).
 * `legend`: char -> id. A legend id starting with "!" is a TARGET slot ("!glasscorn").
 * A ground tile is "~sand" etc. Multi-cell kinds repeat their char over the footprint;
 * the top-left occurrence is the anchor.
 */
export function fromAscii(rows: string[], legend: Record<string, string>): Layout {
  const l: Layout = { inputs: [], targets: [], ground: [] };
  const covered = new Set<string>();
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === "." || ch === " " || covered.has(`${r},${c}`)) return;
      const id = legend[ch];
      if (!id) throw new Error(`fromAscii: no legend for '${ch}' at ${r},${c}`);
      if (id.startsWith("~")) {
        l.ground!.push({ ground: id.slice(1) as GroundTile["ground"], position: [r, c] });
        return;
      }
      const target = id.startsWith("!");
      const kind = target ? id.slice(1) : id;
      const s = sizeOf(kind);
      for (let dr = 0; dr < s; dr++) for (let dc = 0; dc < s; dc++) covered.add(`${r + dr},${c + dc}`);
      (target ? l.targets : l.inputs).push({ cropId: kind, position: [r, c] });
    });
  });
  return l;
}

const ABBR: Record<string, string> = {};
function abbr(id: string): string {
  if (ABBR[id]) return ABBR[id];
  const parts = id.split("_");
  let a = parts.length > 1 ? parts[0][0] + parts[1][0] : id.slice(0, 2);
  const used = new Set(Object.values(ABBR));
  let i = 2;
  while (used.has(a)) a = id[0] + id[i++];
  ABBR[id] = a;
  return a;
}

/** ASCII grid: lowercase = input, UPPERCASE = target slot. */
export function render(l: Layout): string {
  const grid: string[][] = Array.from({ length: 10 }, () => Array(10).fill(" ."));
  const legend = new Set<string>();
  const put = (p: Placement, upper: boolean) => {
    const s = sizeOf(p.cropId);
    const a = abbr(p.cropId);
    legend.add(`${a}=${p.cropId}`);
    for (let dr = 0; dr < s; dr++)
      for (let dc = 0; dc < s; dc++) {
        const r = p.position[0] + dr, c = p.position[1] + dc;
        if (r < 10 && c < 10) grid[r][c] = (upper ? a.toUpperCase() : a.toLowerCase()).padStart(2);
      }
  };
  for (const p of l.inputs) put(p, false);
  for (const t of l.targets) put(t, true);
  return grid.map((row) => row.join(" ")).join("\n") + "\n" + [...legend].sort().join("  ");
}
