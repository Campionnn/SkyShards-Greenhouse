import { cellCol, cellRow, ringCells } from "../grid/cells";
import type { CycleCtx } from "./context";
import { spend } from "./inventory";
import { buildOccupancy, DEAD_PLANT, insertPlant, newPlant, removePlant } from "./plants";
import type { PlantState, PlotState } from "./state";

export const ZOMBUD = "zombud";

/**
 * Zombud harvest. First fills empty ring cells with dead plants from stock
 * (optional: stops when stock runs out, never records debt). Then each ring
 * cell under a dead_plant becomes a mob giving 1 Zombud (no yield scaling);
 * a multi-cell dead plant counts once per ring cell. Dead plants are consumed
 * with no item back. Returns Zombud items. Consumes no RNG.
 */
export function zombudHarvest(plot: PlotState, p: PlantState, ctx: CycleCtx): number {
  const ring = ringCells(p.row, p.col, p.size);

  let occ = buildOccupancy(plot);
  for (const idx of ring) {
    if (occ[idx]) continue;
    if ((ctx.state.inventory[DEAD_PLANT] ?? 0) < 1) break;
    const row = cellRow(idx);
    const col = cellCol(idx);
    const req = { cycle: ctx.cycle, plotId: plot.id, row, col, action: "fill for Zombud", replacement: false };
    if (!spend(ctx.state, DEAD_PLANT, 1, req, ctx.prices, ctx.emit)) break;
    const d = newPlant(ctx.state, ctx.env.data, ctx.config, DEAD_PLANT, row, col, "placed", ctx.cycle);
    insertPlant(plot, d);
    ctx.emit(plot.id, { kind: "placed", plantId: d.id, kindId: DEAD_PLANT, row, col, origin: "placed", replacement: false });
  }

  occ = buildOccupancy(plot);
  let mobs = 0;
  const consumed: PlantState[] = [];
  for (const idx of ring) {
    const q = occ[idx];
    if (!q || q.kindId !== DEAD_PLANT) continue;
    mobs += 1;
    if (!consumed.includes(q)) consumed.push(q);
  }
  for (const q of consumed) {
    removePlant(plot, q);
    ctx.emit(plot.id, { kind: "removed", plantId: q.id, kindId: q.kindId, row: q.row, col: q.col, reason: "became a Zombud mob" });
  }
  return mobs;
}
