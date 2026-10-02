import type { SimConfig } from "../config";
import { cellIndex, footprint } from "../grid/cells";
import type { CycleCtx, ResolvedLayout, TickScratch } from "./context";
import { destroyPlant } from "./explosion";
import { harvestPlant } from "./harvest";
import { closePlotDebts, credit, spend } from "./inventory";
import { buildOccupancy, DEAD_PLANT, insertPlant, isFootprintFree, isHarvestable, newPlant, removePlant } from "./plants";
import type { PlantState, PlotState } from "./state";

/** Player removal: harvest if harvestable, clear a Dead Plant (item back to inventory), else break it as a loss. */
export function removeByPlayer(plot: PlotState, p: PlantState, ctx: CycleCtx, scratch: TickScratch, why: string): void {
  if (isHarvestable(p)) {
    harvestPlant(plot, p, ctx, scratch);
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
 * - setup: starting layouts; free, never drawn from inventory.
 * - step: a later flow step laying out.
 * - replace: re-placing what decayed or was destroyed (counted as replacements).
 */
export type PlacementMode = "setup" | "step" | "replace";

/**
 * Place missing layout plants on free cells. Base crops are free; outside
 * setup, placed items are a required spend and a shortfall records debt
 * (cell stays empty, retried next session).
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
    const p = newPlant(ctx.state, ctx.env.data, ctx.config, d.kindId, d.row, d.col, d.origin, ctx.cycle);
    insertPlant(plot, p);
    for (const idx of footprint(d.row, d.col, d.size)) occ[idx] = p;
    ctx.emit(plot.id, { kind: "placed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, origin: p.origin, replacement });
  }
}

const matches = (p: PlantState, d: ResolvedLayout["plants"][number]) =>
  p.kindId === d.kindId && p.row === d.row && p.col === d.col && p.size === d.size && p.origin === d.origin;

/**
 * Hybrid flows (`spawnsFillLayoutInputs`): a spawn standing exactly where the
 * layout places the same mutation serves as that input, at any stage.
 */
export function layoutInputAt(p: PlantState, layout: ResolvedLayout, config: SimConfig): boolean {
  if (!config.spawnsFillLayoutInputs || p.origin !== "spawned" || p.isDeadPlant) return false;
  return layout.plants.some((d) => d.kindId === p.kindId && d.row === p.row && d.col === p.col && d.size === p.size);
}

/**
 * Enter a step. Unless `fullClear`, keep: plants identical to the layout's
 * (kind, anchor, origin) with their timers, spawns serving as layout inputs,
 * and spawns entirely outside the layout's plant cells. Remove the rest, then place.
 */
export function applyStepLayout(
  plot: PlotState,
  layout: ResolvedLayout,
  ctx: CycleCtx,
  scratch: TickScratch,
  fullClear: boolean,
  mode: "setup" | "step" = "step"
): void {
  const keepIdentical = ctx.config.keepIdenticalOnStepChange && !fullClear;
  const desiredAt = new Map(layout.plants.map((d) => [cellIndex(d.row, d.col), d]));
  const desiredCells = new Set(layout.plants.flatMap((d) => footprint(d.row, d.col, d.size)));

  for (const p of [...plot.plants]) {
    if (!plot.plants.includes(p)) continue;
    const d = desiredAt.get(cellIndex(p.row, p.col));
    if (keepIdentical && d && matches(p, d)) continue;
    if (!fullClear && layoutInputAt(p, layout, ctx.config)) continue;
    const growingOutsideLayout = p.origin === "spawned" && !footprint(p.row, p.col, p.size).some((c) => desiredCells.has(c));
    if (!fullClear && growingOutsideLayout) continue;
    removeByPlayer(plot, p, ctx, scratch, "step change");
  }

  plot.slots = layout.slots.map((s) => ({ ...s }));
  plot.groundTiles = { ...layout.groundTiles };
  plot.groundOverrides = {}; // Chorus ground changes last only within a step
  plot.slotIneligibleCycles = {};
  plot.watchStatus = {};
  closePlotDebts(ctx.state, plot.id);
  placeLayoutPlants(plot, layout, ctx, mode);
}

/** Clear unwanted Dead Plants, remove spawns blocking layout cells (not layout inputs), re-place what's missing. */
export function maintainLayout(plot: PlotState, layout: ResolvedLayout, ctx: CycleCtx, scratch: TickScratch): void {
  const desiredAt = new Map(layout.plants.map((d) => [cellIndex(d.row, d.col), d]));
  for (const p of [...plot.plants]) {
    if (!p.isDeadPlant) continue;
    const d = desiredAt.get(cellIndex(p.row, p.col));
    if (d && matches(p, d)) continue; // layout places a dead plant here
    removeByPlayer(plot, p, ctx, scratch, "cleared");
  }

  const occ = buildOccupancy(plot);
  for (const d of layout.plants) {
    for (const idx of footprint(d.row, d.col, d.size)) {
      const q = occ[idx];
      if (!q || matches(q, d) || q.origin !== "spawned" || !plot.plants.includes(q)) continue;
      if (layoutInputAt(q, layout, ctx.config)) continue;
      removeByPlayer(plot, q, ctx, scratch, "blocking layout");
    }
  }
  placeLayoutPlants(plot, layout, ctx, "replace");
}
