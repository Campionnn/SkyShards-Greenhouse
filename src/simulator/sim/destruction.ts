import { cellIndex, cellKey, GRID_SIZE, ringCells, TOTAL_CELLS } from "../grid/cells";
import { chance, intInclusive } from "../rng";
import type { CycleCtx } from "./context";
import { destroyPlant } from "./explosion";
import { buildOccupancy, DEVOURER_ROOT, insertPlant, isRoot, newRoot, sortPlants } from "./plants";
import type { PlantState, PlotState } from "./state";

/**
 * A plant that is still growing as the tick starts. Destruction runs first
 * in the tick, before growth, so "still growing" is judged on the stage the
 * plant starts the tick with.
 */
function willGrow(p: PlantState): boolean {
  return !p.isDeadPlant && p.origin !== "placed" && p.stage < p.growthStages;
}

/**
 * Game-tick phase "destruction" - gate side effects that reshape the plot,
 * applied FIRST in the tick (before effects and growth):
 * - Devourer: while growing, 40% per tick to grow a root into one of its 8
 *   neighbouring cells (destroying what is there). Every root then has its own
 *   40% per tick to spread another. Roots are separate entities the player
 *   breaks while online; a fully grown Devourer makes no new roots.
 * - Chorus Fruit: teleports every tick it starts still growing to any other
 *   cell (AIR included), turning the landing cell into End Stone, then advances in the growth phase. So a stage-11 Chorus Fruit (of
 *   12) teleports one last time on the tick it becomes fully grown, and a
 *   fully grown one never teleports.
 * Blastberry explosions happen the moment one breaks (sim/explosion.ts).
 */
export function phaseDestruction(plot: PlotState, ctx: CycleCtx): void {
  const { config } = ctx;
  const rng = ctx.state.rng;

  // Roots that exist now may spread; roots grown this tick start next tick.
  const sources = plot.plants.filter(
    (p) => (p.kindId === "devourer" && !p.isDeadPlant && p.stage < p.growthStages) || isRoot(p)
  );
  for (const src of sources) {
    if (!plot.plants.includes(src)) continue;
    const p = src.kindId === "devourer" ? config.devourerRootChance : config.rootSpreadChance;
    if (!chance(rng, p)) continue;
    growRoot(plot, src, ctx);
  }

  // Chorus Fruit teleports as it grows, converting its landing cell to End Stone.
  let occ = buildOccupancy(plot);
  let moved = false;
  for (const p of [...plot.plants]) {
    if (p.kindId !== "chorus_fruit" || !willGrow(p) || !plot.plants.includes(p)) continue;
    const own = cellIndex(p.row, p.col);
    const targets: number[] = [];
    for (let idx = 0; idx < TOTAL_CELLS; idx++) {
      if (idx === own) continue;
      // Any cell is a target, AIR included: the landing cell becomes End Stone either way.
      if (config.chorusTeleportTargets === "emptyOnly" && occ[idx]) continue;
      targets.push(idx);
    }
    if (targets.length === 0) continue;
    const t = targets[intInclusive(rng, 0, targets.length - 1)];
    const occupant = occ[t];
    if (occupant) {
      // Two Chorus Fruit on one spot: the higher growth stage survives.
      if (occupant.kindId === "chorus_fruit" && occupant.stage > p.stage) {
        destroyPlant(plot, p, ctx, "chorus collision");
        occ = buildOccupancy(plot);
        continue;
      }
      destroyPlant(plot, occupant, ctx, occupant.kindId === "chorus_fruit" ? "chorus collision" : "chorus teleport");
    }
    const fromRow = p.row;
    const fromCol = p.col;
    p.row = Math.floor(t / GRID_SIZE);
    p.col = t % GRID_SIZE;
    plot.groundOverrides[cellKey(p.row, p.col)] = "end_stone";
    ctx.emit(plot.id, { kind: "teleported", plantId: p.id, kindId: p.kindId, fromRow, fromCol, row: p.row, col: p.col });
    moved = true;
    occ = buildOccupancy(plot);
  }
  if (moved) sortPlants(plot);
}

/** Grow a root into a random neighbouring cell of `src` that is not already a root or a Devourer. */
function growRoot(plot: PlotState, src: PlantState, ctx: CycleCtx): void {
  const occ = buildOccupancy(plot);
  const cells = ringCells(src.row, src.col, src.size).filter((idx) => {
    const q = occ[idx];
    return !q || (q.kindId !== DEVOURER_ROOT && q.kindId !== "devourer");
  });
  if (cells.length === 0) return;
  const idx = cells[intInclusive(ctx.state.rng, 0, cells.length - 1)];
  const victim = occ[idx];
  if (victim && plot.plants.includes(victim)) destroyPlant(plot, victim, ctx, "devourer root");
  const row = Math.floor(idx / GRID_SIZE);
  const col = idx % GRID_SIZE;
  if (buildOccupancy(plot)[idx]) return; // an explosion's aftermath can't refill it, but stay safe
  insertPlant(plot, newRoot(ctx.state, row, col, ctx.cycle));
  ctx.emit(plot.id, { kind: "rootSpread", row, col, fromRow: src.row, fromCol: src.col });
}
