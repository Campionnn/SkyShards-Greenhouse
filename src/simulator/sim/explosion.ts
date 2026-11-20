import { ringCells } from "../grid/cells";
import type { CycleCtx } from "./context";
import { effectiveListShared } from "../effects/adapter";
import { buildOccupancy, initialDecaySeconds, minimumMutationsOf, removePlant, spawnStageOf } from "./plants";
import { bump, perPlot } from "./summary";
import type { PlantState, PlotState } from "./state";

// Blastberry: breaking a primed one by any means destroys the 8 surrounding cells. Other
// Blastberries in range are immune (wiki "Blastberry": "If there is another Blastberry in range,
// it is ignored and not destroyed"; user-confirmed 2026-11-19), so blasts never chain. Turtlellini
// survives a hit; the second hit turns it into a Shellfruit.
// Priming: a spawn primes once fully grown; a placed one primes at the next tick.

const BLASTBERRY = "blastberry";

/**
 * A Shellfruit a blast just made, before its first tick: only these effects work on it yet, taken
 * live from its current neighbours. Everything else (Harvest Bounty, XP, water) waits a tick.
 */
export const SETTLING_EFFECTS: ReadonlySet<string> = new Set(["harvest_boost", "improved_harvest_boost", "harvest_loss", "immunity"]);

export const isSettling = (p: PlantState): boolean => p.gate.settling !== undefined;

export const isPrimedBlastberry = (p: PlantState): boolean => p.kindId === BLASTBERRY && p.gate.primed === true;

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

/**
 * Blow up the 8 neighbours of a primed Blastberry that just broke. Other Blastberries (primed or not,
 * placed or spawned) are ignored and stay, so there is never a chain; Turtlellini counts the hit.
 */
export function explode(plot: PlotState, origin: { id: number; row: number; col: number }, ctx: CycleCtx): void {
  ctx.emit(plot.id, { kind: "exploded", plantId: origin.id, row: origin.row, col: origin.col });
  const occ = buildOccupancy(plot);
  const hit = new Set<PlantState>();
  for (const idx of ringCells(origin.row, origin.col, 1)) {
    const q = occ[idx];
    if (q && plot.plants.includes(q)) hit.add(q);
  }
  for (const q of hit) {
    if (q.kindId === BLASTBERRY) continue;
    if (q.kindId === "turtlellini") {
      q.gate.exploded = (q.gate.exploded ?? 0) + 1;
      if (q.gate.exploded >= 2) turnIntoShellfruit(plot, q, ctx);
      continue;
    }
    removeAsDestroyed(plot, q, ctx, "blastberry explosion");
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
  q.decaySecondsRemaining = initialDecaySeconds(ctx.env.data, "shellfruit");
  q.timesMutated = 0;
  q.mutatesRemaining = minimumMutationsOf("shellfruit", ctx.env.data);
  q.water = 0;
  q.isRival = false;
  q.gate = {};
  // 0-stage: fully grown (harvestable) on appearing. It appears between two ticks, so until a tick
  // has passed only its yield effects work, live from its current neighbours (`isSettling`); the
  // next tick's growth phase latches everything (sim/tick.ts `settleShellfruit`).
  q.lockedEffects = q.stage >= q.readyStage ? (effectiveListShared([]) as string[]) : null;
  if (q.lockedEffects) {
    q.fullyGrownAtCycle = ctx.cycle;
    q.gate.settling = ctx.cycle;
  }
  bump(ctx.state.summary.spawned, "shellfruit");
  perPlot(ctx.state.summary, plot.id).spawned += 1;
  ctx.emit(plot.id, { kind: "spawned", plantId: q.id, mutationId: "shellfruit", row: q.row, col: q.col, rival: false, slotTarget: null });
  if (q.lockedEffects) ctx.emit(plot.id, { kind: "fullyGrown", plantId: q.id, kindId: q.kindId, row: q.row, col: q.col });
}
