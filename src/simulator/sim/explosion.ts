import { ringCells } from "../grid/cells";
import type { CycleCtx } from "./context";
import { buildOccupancy, removePlant, spawnedDecaySeconds } from "./plants";
import { bump, perPlot } from "./summary";
import type { PlantState, PlotState } from "./state";

// Blastberry. Breaking a PRIMED Blastberry - harvesting it, clearing it,
// decay, thirst, or anything destroying it - explodes the 8 surrounding
// cells. Everything there is destroyed; a primed Blastberry caught in the
// blast explodes too (chain reaction). A Turtlellini survives and counts the
// hit; its second hit turns it into a Shellfruit.
//
// Priming: a natural spawn is primed once fully grown; a placed one starts
// unprimed (it went in mid-stage) and primes at the next tick.

export const isPrimedBlastberry = (p: PlantState): boolean => p.kindId === "blastberry" && p.gate.primed === true;

/** Take a plant off the plot as destroyed (a loss). Does not trigger explosions - see destroyPlant. */
export function removeAsDestroyed(plot: PlotState, p: PlantState, ctx: CycleCtx, by: string): void {
  removePlant(plot, p);
  bump(ctx.state.summary.destroyed, p.kindId);
  perPlot(ctx.state.summary, plot.id).destroyed += 1;
  if (p.isRival) ctx.state.summary.rivals.cleared += 1;
  ctx.emit(plot.id, { kind: "destroyed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, by });
}

/** Destroy a plant; a primed Blastberry explodes as it breaks. */
export function destroyPlant(plot: PlotState, p: PlantState, ctx: CycleCtx, by: string): void {
  const primed = isPrimedBlastberry(p);
  removeAsDestroyed(plot, p, ctx, by);
  if (primed) explode(plot, p, ctx);
}

/** A Blastberry at `origin` just broke while primed: blow up its 8 neighbours, chaining through primed Blastberries. */
export function explode(plot: PlotState, origin: { id: number; row: number; col: number }, ctx: CycleCtx): void {
  const queue = [{ id: origin.id, row: origin.row, col: origin.col }];
  while (queue.length) {
    const blast = queue.shift()!;
    ctx.emit(plot.id, { kind: "exploded", plantId: blast.id, row: blast.row, col: blast.col });
    const occ = buildOccupancy(plot);
    const hit = new Set<PlantState>();
    for (const idx of ringCells(blast.row, blast.col, 1)) {
      const q = occ[idx];
      if (q && plot.plants.includes(q)) hit.add(q);
    }
    for (const q of hit) {
      if (q.kindId === "turtlellini") {
        q.gate.exploded = (q.gate.exploded ?? 0) + 1;
        if (q.gate.exploded >= 2) turnIntoShellfruit(plot, q, ctx);
        continue;
      }
      const chain = isPrimedBlastberry(q);
      removeAsDestroyed(plot, q, ctx, "blastberry explosion");
      if (chain) queue.push({ id: q.id, row: q.row, col: q.col });
    }
  }
}

function turnIntoShellfruit(plot: PlotState, q: PlantState, ctx: CycleCtx): void {
  const m = ctx.env.data.mutations.shellfruit;
  if (!m) return;
  ctx.emit(plot.id, { kind: "destroyed", plantId: q.id, kindId: q.kindId, row: q.row, col: q.col, by: "blastberry (became shellfruit)" });
  q.id = ctx.state.nextPlantId++;
  q.kindId = "shellfruit";
  q.origin = "spawned";
  q.stage = 0;
  q.growthStages = m.growthStages;
  q.readyStage = m.growthStages;
  q.fullyGrownAtCycle = null;
  // It is a fresh natural spawn: its decay timer runs from now.
  q.decaySecondsRemaining = spawnedDecaySeconds(m, ctx.config, ctx.stageSeconds);
  q.lockedEffects = null;
  q.isRival = false;
  q.gate = {};
  bump(ctx.state.summary.spawned, "shellfruit");
  perPlot(ctx.state.summary, plot.id).spawned += 1;
  ctx.emit(plot.id, { kind: "spawned", plantId: q.id, mutationId: "shellfruit", row: q.row, col: q.col, rival: false, slotTarget: null });
}
