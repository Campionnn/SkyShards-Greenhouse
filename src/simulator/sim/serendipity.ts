import { chance } from "../rng";
import { ensureEffects } from "../effects/adapter";
import type { CycleCtx, TickScratch } from "./context";
import { buildOccupancy, insertPlant, isFootprintFree, newPlant } from "./plants";
import { bump, perPlot } from "./summary";
import { latchIfReady } from "./tick";
import type { PlantState, PlotState } from "./state";

/** Mutation Serendipity (Zombuddy Shard attribute): +0.1% re-mutate chance per level, levels 0-10 (wiki, Aug 20 2026 values). */
export const SERENDIPITY_PER_LEVEL = 0.001;
export const SERENDIPITY_MAX_LEVEL = 10;

/** The re-mutate chance of a Mutation Serendipity level (missing = 0). */
export function serendipityChance(level: number | undefined): number {
  const l = Math.max(0, Math.min(SERENDIPITY_MAX_LEVEL, Number.isFinite(level) ? Math.floor(level as number) : 0));
  return l * SERENDIPITY_PER_LEVEL;
}

/**
 * Mutation Serendipity: a harvested natural-spawn mutation has a chance to instantly re-mutate in
 * its own cell at its first growth stage (stage 1, or fully grown at once for 0-stage kinds). The
 * new plant is a fresh natural spawn (new decay timer and minimum-mutation counters, water 0) of
 * the same kind; it is not the result of a spawn roll, so it ignores requirements and credits no
 * neighbour toward their minimum mutations. Rolls only when the chance is above 0, so a scenario
 * without the attribute keeps its RNG sequence. Called by `harvestPlant` after the plant is removed.
 */
export function rollRemutation(plot: PlotState, p: PlantState, ctx: CycleCtx, scratch: TickScratch): PlantState | null {
  const data = ctx.env.data;
  if (p.origin !== "spawned" || p.isDeadPlant || !data.mutations[p.kindId]) return null;
  const q = serendipityChance(ctx.stats.mutationSerendipity);
  if (q <= 0 || !chance(ctx.state.rng, q)) return null;
  // A primed Blastberry's blast leaves its own cell free; anything else standing there blocks it.
  if (!isFootprintFree(buildOccupancy(plot), p.row, p.col, p.size)) return null;
  const plant = newPlant(ctx.state, data, ctx.config, p.kindId, p.row, p.col, "spawned", ctx.cycle);
  plant.isRival = p.isRival;
  insertPlant(plot, plant);
  bump(ctx.state.summary.spawned, plant.kindId);
  perPlot(ctx.state.summary, plot.id).spawned += 1;
  if (plant.isRival) ctx.state.summary.rivals.spawned += 1;
  const slot = plot.slots.find((s) => s.row === p.row && s.col === p.col);
  ctx.emit(plot.id, {
    kind: "spawned",
    plantId: plant.id,
    mutationId: plant.kindId,
    row: plant.row,
    col: plant.col,
    rival: plant.isRival,
    slotTarget: slot?.mutationId ?? null,
    remutated: true,
  });
  if (plant.stage >= plant.readyStage) {
    ensureEffects(plot, scratch);
    latchIfReady(plant, plot, ctx);
  }
  return plant;
}
