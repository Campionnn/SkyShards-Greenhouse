import { cellCol, cellRow, ringCells } from "../grid/cells";
import type { CycleCtx } from "./context";
import { spend } from "./inventory";
import { buildOccupancy, DEAD_PLANT, insertPlant, newPlant, removePlant } from "./plants";
import type { PlantState, PlotState } from "./state";

export const ZOMBUD = "zombud";

/**
 * Zombud harvest (user rule): every Dead Plant in the 8-way ring turns into a
 * Zombud mob; the fight is assumed won and each one gives exactly 1 Zombud
 * (no yield scaling). The Dead Plants are consumed - no dead_plant item back.
 *
 * Before harvesting, the player fills every EMPTY ring cell with a dead plant
 * from inventory to get the most Zombuds. This is an optimisation, not a
 * required spend: it only uses what the stock covers and never records debt.
 * Occupied cells are never touched. Dead plants counted: decay leftovers and
 * layout-placed dead_plant alike (any kind "dead_plant"). A multi-cell dead
 * plant counts once per ring cell it covers.
 *
 * Returns the number of Zombud items the harvest yields. Consumes no RNG.
 */
export function zombudHarvest(plot: PlotState, p: PlantState, ctx: CycleCtx): number {
  const ring = ringCells(p.row, p.col, p.size);

  // 1. Fill empty ring cells from stock (no debt).
  let occ = buildOccupancy(plot);
  for (const idx of ring) {
    if (occ[idx]) continue;
    if ((ctx.state.inventory[DEAD_PLANT] ?? 0) < 1) break;
    const row = cellRow(idx);
    const col = cellCol(idx);
    const req = { cycle: ctx.cycle, plotId: plot.id, row, col, action: "fill for Zombud", replacement: false };
    if (!spend(ctx.state, DEAD_PLANT, 1, req, ctx.prices, ctx.emit)) break;
    const d = newPlant(ctx.state, ctx.env.data, ctx.config, DEAD_PLANT, row, col, "placed", ctx.cycle, ctx.stageSeconds);
    insertPlant(plot, d);
    ctx.emit(plot.id, { kind: "placed", plantId: d.id, kindId: DEAD_PLANT, row, col, origin: "placed", replacement: false });
  }

  // 2. Every ring cell under a dead plant becomes a mob; the dead plants are consumed.
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
