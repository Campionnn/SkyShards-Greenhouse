import { ringCells } from "../grid/cells";
import type { CycleCtx } from "./context";
import { effectiveList } from "../effects/adapter";
import { buildOccupancy, minimumMutationsOf, removePlant, spawnedDecaySeconds, spawnStageOf } from "./plants";
import { bump, perPlot } from "./summary";
import type { PlantState, PlotState } from "./state";

// Blastberry: breaking a primed one by any means destroys the 8 surrounding
// cells. Primed Blastberries hit chain-explode. Turtlellini survives a hit;
// the second hit turns it into a Shellfruit.
// Priming: a spawn primes once fully grown; a placed one primes at the next tick.

export const isPrimedBlastberry = (p: PlantState): boolean => p.kindId === "blastberry" && p.gate.primed === true;

/** Remove as destroyed (a loss) without triggering explosions; see destroyPlant. */
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

/** Blow up the 8 neighbours of a primed Blastberry that just broke, chaining breadth-first. */
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
  q.stage = spawnStageOf(m.growthStages);
  q.growthStages = m.growthStages;
  q.readyStage = m.growthStages;
  q.fullyGrownAtCycle = null;
  // Fresh natural spawn (timer and counters reset); not from a spawn roll, so it credits nobody.
  q.decaySecondsRemaining = spawnedDecaySeconds(m, ctx.config, ctx.cycleSeconds);
  q.timesMutated = 0;
  q.mutatesRemaining = minimumMutationsOf("shellfruit", ctx.env.data, ctx.config);
  q.water = 0;
  // 0-stage: fully grown on appearing, so latch effects now.
  q.lockedEffects = q.stage >= q.readyStage ? effectiveList(q.held) : null;
  if (q.lockedEffects) q.fullyGrownAtCycle = ctx.cycle;
  q.isRival = false;
  q.gate = {};
  bump(ctx.state.summary.spawned, "shellfruit");
  perPlot(ctx.state.summary, plot.id).spawned += 1;
  ctx.emit(plot.id, { kind: "spawned", plantId: q.id, mutationId: "shellfruit", row: q.row, col: q.col, rival: false, slotTarget: null });
  if (q.lockedEffects) ctx.emit(plot.id, { kind: "fullyGrown", plantId: q.id, kindId: q.kindId, row: q.row, col: q.col });
}
