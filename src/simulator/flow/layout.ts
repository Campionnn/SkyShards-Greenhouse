import { isHarvestableCrop, kindDef } from "../data/load";
import type { GameData, Size } from "../data/types";
import { cellKey, footprint, footprintFits, GRID_SIZE } from "../grid/cells";
import { layoutFromShareCode } from "../share/layoutFromShare";
import type { ResolvedLayout } from "../sim/context";
import type { LayoutSpec, StepLayout } from "./types";

export class LayoutError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid layout:\n- ${issues.join("\n- ")}`);
    this.name = "LayoutError";
    this.issues = issues;
  }
}

export function layoutSpecOf(layout: StepLayout, data: GameData): { layout: LayoutSpec; issues: string[] } {
  if ("code" in layout) {
    try {
      return layoutFromShareCode(layout.code, data);
    } catch (err) {
      return { layout: { plants: [], slots: [] }, issues: [err instanceof Error ? err.message : String(err)] };
    }
  }
  return { layout, issues: [] };
}

/**
 * Resolves a step layout. Base crops are `planted` (free, grow); everything else
 * is `placed` from inventory (costs 1, fully grown).
 */
export function resolveLayout(layout: StepLayout, data: GameData): { resolved: ResolvedLayout; issues: string[] } {
  const { layout: spec, issues } = layoutSpecOf(layout, data);
  const resolved: ResolvedLayout = { plants: [], slots: [], groundTiles: {} };
  for (const p of spec.plants) {
    const def = kindDef(data, p.kindId);
    if (!def) {
      issues.push(`unknown plant "${p.kindId}"`);
      continue;
    }
    resolved.plants.push({
      kindId: p.kindId,
      row: p.row,
      col: p.col,
      size: (p.size ?? def.size) as Size,
      origin: isHarvestableCrop(data, p.kindId) ? "planted" : "placed",
    });
  }
  for (const s of spec.slots) {
    const m = data.mutations[s.mutationId];
    if (!m) {
      issues.push(`slot target "${s.mutationId}" is not a mutation`);
      continue;
    }
    resolved.slots.push({ mutationId: s.mutationId, row: s.row, col: s.col, size: (s.size ?? m.size) as Size });
  }
  // Unpainted cells are air, except target and plant footprints, which imply
  // ground (also for share codes without paint). That ground persists until
  // the next step's layout replaces it.
  const knownGround = new Set(["farmland", "sand", "soul_sand", "mycelium", "netherrack", "end_stone"]);
  for (const t of spec.groundTiles ?? []) {
    if (!Number.isInteger(t.row) || !Number.isInteger(t.col) || !footprintFits(t.row, t.col, 1)) {
      issues.push(`ground tile at (${t.row},${t.col}) does not fit on the plot`);
    } else if (!knownGround.has(t.ground)) {
      issues.push(`unknown ground "${t.ground}" at (${t.row},${t.col})`);
    } else {
      resolved.groundTiles[cellKey(t.row, t.col)] = t.ground;
    }
  }
  for (const s of resolved.slots) {
    const ground = data.mutations[s.mutationId].ground;
    if (!footprintFits(s.row, s.col, s.size)) continue;
    for (const idx of footprint(s.row, s.col, s.size)) {
      resolved.groundTiles[cellKey(Math.floor(idx / GRID_SIZE), idx % GRID_SIZE)] = ground;
    }
  }
  for (const p of resolved.plants) {
    if (!footprintFits(p.row, p.col, p.size)) continue;
    const ground = kindDef(data, p.kindId)?.ground;
    if (!ground || !knownGround.has(ground)) continue;
    for (const idx of footprint(p.row, p.col, p.size)) {
      resolved.groundTiles[cellKey(Math.floor(idx / GRID_SIZE), idx % GRID_SIZE)] = ground;
    }
  }
  const byAnchor = (a: { row: number; col: number }, b: { row: number; col: number }) => a.row - b.row || a.col - b.col;
  resolved.plants.sort(byAnchor);
  resolved.slots.sort(byAnchor);
  if (!("code" in layout)) issues.push(...geometryIssues(resolved)); // share codes are checked on decode
  return { resolved, issues };
}

function geometryIssues(layout: ResolvedLayout): string[] {
  const issues: string[] = [];
  const taken = new Map<number, string>();
  const entries = [
    ...layout.plants.map((p) => ({ id: p.kindId, row: p.row, col: p.col, size: p.size })),
    ...layout.slots.map((s) => ({ id: `${s.mutationId} slot`, row: s.row, col: s.col, size: s.size })),
  ];
  for (const e of entries) {
    if (!footprintFits(e.row, e.col, e.size)) {
      issues.push(`${e.id} at (${e.row},${e.col}) does not fit on the plot`);
      continue;
    }
    for (const c of footprint(e.row, e.col, e.size)) {
      const other = taken.get(c);
      if (other) {
        issues.push(`${e.id} at (${e.row},${e.col}) overlaps ${other}`);
        break;
      }
      taken.set(c, `${e.id} at (${e.row},${e.col})`);
    }
  }
  return issues;
}

/** Memoising resolver for one engine (layouts are immutable inputs). */
export function createLayoutResolver(data: GameData): (layout: StepLayout) => ResolvedLayout {
  const cache = new Map<string, ResolvedLayout>();
  return (layout) => {
    const key = "code" in layout ? `c:${layout.code}` : `s:${JSON.stringify(layout)}`;
    let hit = cache.get(key);
    if (!hit) {
      const { resolved, issues } = resolveLayout(layout, data);
      if (issues.length) throw new LayoutError(issues);
      hit = resolved;
      cache.set(key, hit);
    }
    return hit;
  };
}
