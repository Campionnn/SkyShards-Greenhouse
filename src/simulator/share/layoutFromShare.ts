import { decodeDesign } from "../../utilities/designEncoding";
import { kindDef } from "../data/load";
import type { GameData, Size } from "../data/types";
import type { LayoutSpec } from "../flow/types";
import { footprint, footprintFits } from "../grid/cells";

type Placement = { cropId: string; position: [number, number] };

/**
 * Decoded share code as a layout: lowercase inputs are plants, UPPERCASE
 * targets are empty labelled slots. Entries anchored top-left, sizes from game
 * data. Problems are reported, not fixed.
 */
export function layoutFromDecoded(
  decoded: { inputs: Placement[]; targets: Placement[]; groundTiles?: { ground: string; position: [number, number] }[] },
  data: GameData
): { layout: LayoutSpec; issues: string[] } {
  const issues: string[] = [];
  const layout: LayoutSpec = { plants: [], slots: [] };
  const taken = new Map<number, string>();

  const claim = (id: string, row: number, col: number, size: number, what: string): boolean => {
    if (!footprintFits(row, col, size)) {
      issues.push(`${what} ${id} at (${row},${col}) does not fit on the plot`);
      return false;
    }
    const cells = footprint(row, col, size);
    const clash = cells.find((c) => taken.has(c));
    if (clash !== undefined) {
      issues.push(`${what} ${id} at (${row},${col}) overlaps ${taken.get(clash)}`);
      return false;
    }
    for (const c of cells) taken.set(c, `${id} at (${row},${col})`);
    return true;
  };

  for (const p of decoded.inputs) {
    const def = kindDef(data, p.cropId);
    if (!def) {
      issues.push(`unknown plant "${p.cropId}"`);
      continue;
    }
    const [row, col] = p.position;
    if (claim(p.cropId, row, col, def.size, "plant")) layout.plants.push({ kindId: p.cropId, row, col, size: def.size as Size });
  }
  for (const t of decoded.targets) {
    const m = data.mutations[t.cropId];
    if (!m) {
      issues.push(`target "${t.cropId}" is not a mutation`);
      continue;
    }
    const [row, col] = t.position;
    if (claim(t.cropId, row, col, m.size, "target")) layout.slots.push({ mutationId: t.cropId, row, col, size: m.size as Size });
  }

  const byAnchor = (a: { row: number; col: number }, b: { row: number; col: number }) => a.row - b.row || a.col - b.col;
  layout.plants.sort(byAnchor);
  layout.slots.sort(byAnchor);
  layout.groundTiles = (decoded.groundTiles ?? []).map(({ ground, position: [row, col] }) => ({ ground, row, col }));
  layout.groundTiles.sort(byAnchor);
  return { layout, issues };
}

export function layoutFromShareCode(code: string, data: GameData): { layout: LayoutSpec; issues: string[] } {
  return layoutFromDecoded(decodeDesign(code), data);
}
