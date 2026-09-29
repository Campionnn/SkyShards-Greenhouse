import { cellIndex, footprint } from "../grid/cells";
import type { CycleCtx, ResolvedLayout } from "./context";
import { destroyPlant } from "./explosion";
import { harvestPlant, type TickScratch } from "./harvest";
import { closePlotDebts, credit, spend } from "./inventory";
import { buildOccupancy, DEAD_PLANT, insertPlant, isFootprintFree, isHarvestable, newPlant, removePlant } from "./plants";
import type { PlantState, PlotState } from "./state";

/**
 * Take a plant off the plot as the player would: harvest it if it is fully
 * grown and harvestable, clear a Dead Plant (the dead_plant item goes to
 * inventory), otherwise break it - a loss. Placed items drop nothing.
 */
export function removeByPlayer(plot: PlotState, p: PlantState, ctx: CycleCtx, scratch: TickScratch, why: string): void {
  if (isHarvestable(p)) {
    harvestPlant(plot, p, ctx, scratch);
    if (plot.plants.includes(p)) destroyPlant(plot, p, ctx, why); // minigame setback left it standing
    return;
  }
  if (p.isDeadPlant) {
    removePlant(plot, p);
    credit(ctx.state, DEAD_PLANT, p.size * p.size);
    ctx.emit(plot.id, { kind: "removed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, reason: "cleared dead plant" });
    return;
  }
  destroyPlant(plot, p, ctx, why);
}


/**
 * Why plants are being placed:
 * - setup:   the scenario's starting layouts. Always placed, free - the run
 *            starts from the layout as entered, not from the starting inventory.
 * - stage:   a later stage of a rotation laying its layout out.
 * - replace: re-placing what decayed or was destroyed (a recurring cost).
 */
export type PlacementMode = "setup" | "stage" | "replace";

/**
 * Place every layout plant that is missing and whose cells are free. Base
 * crops are free; outside setup, anything placed from inventory is a REQUIRED
 * spend, and a shortfall is recorded as debt (the cell stays empty; retried
 * next session).
 */
export function placeLayoutPlants(plot: PlotState, layout: ResolvedLayout, ctx: CycleCtx, mode: PlacementMode): void {
  const replacement = mode === "replace";
  const occ = buildOccupancy(plot);
  for (const d of layout.plants) {
    const at = occ[cellIndex(d.row, d.col)];
    if (at && at.kindId === d.kindId && at.row === d.row && at.col === d.col && at.origin === d.origin) continue;
    if (!isFootprintFree(occ, d.row, d.col, d.size)) continue;
    if (d.origin === "placed" && mode !== "setup") {
      const req = { cycle: ctx.cycle, plotId: plot.id, row: d.row, col: d.col, action: `place ${d.kindId}`, replacement };
      if (!spend(ctx.state, d.kindId, 1, req, ctx.prices, ctx.emit)) continue;
    } else if (replacement) {
      ctx.state.summary.replacements += 1;
    }
    const p = newPlant(ctx.state, ctx.env.data, ctx.config, d.kindId, d.row, d.col, d.origin, ctx.cycle, ctx.stageSeconds);
    insertPlant(plot, p);
    for (const idx of footprint(d.row, d.col, d.size)) occ[idx] = p;
    ctx.emit(plot.id, { kind: "placed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, origin: p.origin, replacement });
  }
}

const matches = (p: PlantState, d: ResolvedLayout["plants"][number]) =>
  p.kindId === d.kindId && p.row === d.row && p.col === d.col && p.size === d.size && p.origin === d.origin;

/**
 * Enter a stage: diff the plot against the new layout. Unless it is a full
 * clear, a plant identical to the layout's (kind, anchor, origin) is kept with
 * its timers, and a natural spawn growing outside the new layout's cells is
 * left alone. Everything else is removed by the player; then the new plants
 * are placed.
 */
export function applyStageLayout(
  plot: PlotState,
  layout: ResolvedLayout,
  ctx: CycleCtx,
  scratch: TickScratch,
  fullClear: boolean,
  mode: "setup" | "stage" = "stage"
): void {
  const keepIdentical = ctx.config.keepIdenticalOnStageChange && !fullClear;
  const desiredAt = new Map(layout.plants.map((d) => [cellIndex(d.row, d.col), d]));
  const desiredCells = new Set(layout.plants.flatMap((d) => footprint(d.row, d.col, d.size)));

  for (const p of [...plot.plants]) {
    if (!plot.plants.includes(p)) continue;
    const d = desiredAt.get(cellIndex(p.row, p.col));
    if (keepIdentical && d && matches(p, d)) continue;
    const growingOutsideLayout = p.origin === "spawned" && !footprint(p.row, p.col, p.size).some((c) => desiredCells.has(c));
    if (!fullClear && growingOutsideLayout) continue;
    removeByPlayer(plot, p, ctx, scratch, "stage change");
  }

  plot.slots = layout.slots.map((s) => ({ ...s }));
  plot.groundTiles = { ...layout.groundTiles };
  plot.groundOverrides = {}; // Chorus changes persist only within the stage being exited.
  plot.slotIneligibleCycles = {};
  closePlotDebts(ctx.state, plot.id);
  placeLayoutPlants(plot, layout, ctx, mode);
}

/**
 * Player upkeep during a session: clear Dead Plants the layout does not call
 * for, take natural spawns off layout cells they are blocking, and re-place
 * whatever the layout is missing.
 */
export function maintainLayout(plot: PlotState, layout: ResolvedLayout, ctx: CycleCtx, scratch: TickScratch): void {
  const desiredAt = new Map(layout.plants.map((d) => [cellIndex(d.row, d.col), d]));
  for (const p of [...plot.plants]) {
    if (!p.isDeadPlant) continue;
    const d = desiredAt.get(cellIndex(p.row, p.col));
    if (d && matches(p, d)) continue; // the layout itself places a dead plant here
    removeByPlayer(plot, p, ctx, scratch, "cleared");
  }

  const occ = buildOccupancy(plot);
  for (const d of layout.plants) {
    for (const idx of footprint(d.row, d.col, d.size)) {
      const q = occ[idx];
      if (!q || matches(q, d) || q.origin !== "spawned" || !plot.plants.includes(q)) continue;
      removeByPlayer(plot, q, ctx, scratch, "blocking layout");
    }
  }
  placeLayoutPlants(plot, layout, ctx, "replace");
}
