import { endStageOrHold } from "../flow/runner";
import { cellKey, footprint, footprintFits, GRID_SIZE } from "../grid/cells";
import type { CycleCtx, SubStep, TickScratch } from "./context";
import { harvestPlant } from "./harvest";
import { buildOccupancy, insertPlant, isFullyGrown, isHarvestable, isRoot, newPlant, removePlant } from "./plants";
import { layoutInputAt, maintainLayout } from "./placement";
import type { PlantState, PlotState } from "./state";

/** Would this plant's timer run out before the player's next session? */
function decaysBeforeNextSession(p: PlantState, ctx: CycleCtx): boolean {
  if (p.decaySecondsRemaining === null) return false;
  const k = ctx.cyclesUntilNextActive();
  if (!Number.isFinite(k)) return true;
  return p.decaySecondsRemaining - k * ctx.stageSeconds <= 1e-6;
}

function water(plot: PlotState, ctx: CycleCtx): void {
  if (ctx.policiesFor(plot.id).watering !== "toMax") return;
  for (const p of plot.plants) if (p.kindId !== "soggybud") p.water = ctx.config.maxWater; // Soggybud can't be watered
}

/** Special-mutation interactions: wake Snoozling, vacuum the Cheesebite rat, feed Fleshtrap. */
function tendGates(plot: PlotState, ctx: CycleCtx): void {
  const g = ctx.policiesFor(plot.id).gateInteractions;
  for (const p of plot.plants) {
    if (g.wakeSnoozling && p.gate.asleep) p.gate.asleep = false;
    if (g.vacuumRat && p.gate.ratAlive) p.gate.ratAlive = false;
    if (g.feedFleshtrap && p.kindId === "fleshtrap" && p.origin === "spawned") {
      p.gate.hunger = (p.gate.hunger ?? 0) + ctx.config.fleshtrapFeedHunger;
    }
  }
}

/** Devourer roots: the player breaks them (they drop nothing). */
function clearRoots(plot: PlotState, ctx: CycleCtx): void {
  if (!ctx.policiesFor(plot.id).gateInteractions.clearRoots) return;
  for (const p of [...plot.plants]) {
    if (!isRoot(p)) continue;
    removePlant(plot, p);
    ctx.emit(plot.id, { kind: "removed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, reason: "cleared root" });
  }
}

/**
 * Natural spawns. All-in Aloe could be taken at any stage; the player takes
 * it at its target stage. A spawn the current layout uses as an input
 * (hybrid rotations) is left standing under `layoutInputSpawns: "keep"`
 * unless it would decay before the next session.
 */
function harvestSpawns(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const policies = ctx.policiesFor(plot.id);
  if (policies.spawnedHarvest === "never") return;
  const layout = ctx.layoutFor(plot.id);
  for (const p of [...plot.plants]) {
    if (p.origin !== "spawned" || !plot.plants.includes(p)) continue;
    if (policies.layoutInputSpawns === "keep" && layoutInputAt(p, layout, ctx.config)) {
      if (isHarvestable(p) && isFullyGrown(p) && decaysBeforeNextSession(p, ctx)) harvestPlant(plot, p, ctx, scratch);
      continue;
    }
    if (p.kindId === "all_in_aloe") {
      if (!isFullyGrown(p)) continue;
    } else {
      if (!isHarvestable(p)) continue;
      if (policies.spawnedHarvest === "beforeDecay" && !decaysBeforeNextSession(p, ctx)) continue;
    }
    harvestPlant(plot, p, ctx, scratch);
  }
}

/** Base-crop upkeep: harvest and replant in the same step, so the ring never breaks. */
function tendBaseCrops(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const upkeep = ctx.policiesFor(plot.id).baseCropUpkeep;
  if (upkeep === "leaveUntilDecay") return;
  for (const p of [...plot.plants]) {
    if (p.origin !== "planted" || !isHarvestable(p) || !plot.plants.includes(p)) continue;
    if (upkeep === "harvestBeforeDecay" && !decaysBeforeNextSession(p, ctx)) continue;
    const { kindId, row, col } = p;
    if (harvestPlant(plot, p, ctx, scratch) !== "harvested") continue;
    const replant = newPlant(ctx.state, ctx.env.data, ctx.config, kindId, row, col, "planted", ctx.cycle, ctx.stageSeconds);
    insertPlant(plot, replant);
    ctx.emit(plot.id, { kind: "placed", plantId: replant.id, kindId, row, col, origin: "planted", replacement: false });
  }
}

/**
 * The rotation: a stage change that became due while the player was away
 * happens now; otherwise the current stage's exit triggers are checked and,
 * if they all hold, the plot moves on (the new layout is laid out).
 */
function stageChange(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { def, runner } = ctx.flowFor(plot.id);
  scratch.stageChanged = endStageOrHold(plot, def, runner, ctx, scratch, true);
}

/** Clear Dead Plants, take spawns off layout cells and re-place what the layout is missing. */
function maintain(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  if (scratch.stageChanged) return; // entering the stage just laid the whole layout out
  if (!ctx.policiesFor(plot.id).replaceDecayed) return;
  maintainLayout(plot, ctx.layoutFor(plot.id), ctx, scratch);
}

/**
 * Ground upkeep: every target slot's footprint must stand on its mutation's
 * ground. Where the ground has been changed in play (Chorus Fruit leaves End
 * Stone), the player swaps the block back. Only free cells can be fixed - a
 * plant standing on a wrong block has to go first (harvest / maintain run
 * before this step). Ground blocks are not tracked in the inventory, so this
 * costs nothing.
 */
function fixGround(plot: PlotState, ctx: CycleCtx): void {
  if (ctx.policiesFor(plot.id).fixGround === false) return;
  const { data } = ctx.env;
  const occ = buildOccupancy(plot);
  for (const slot of plot.slots) {
    const m = data.mutations[slot.mutationId];
    if (!m || !footprintFits(slot.row, slot.col, slot.size)) continue;
    for (const idx of footprint(slot.row, slot.col, slot.size)) {
      if (occ[idx]) continue;
      const row = Math.floor(idx / GRID_SIZE);
      const col = idx % GRID_SIZE;
      const key = cellKey(row, col);
      const current = plot.groundOverrides[key] ?? plot.groundTiles[key] ?? null;
      if (current === m.ground) continue;
      if (plot.groundTiles[key] === m.ground) delete plot.groundOverrides[key];
      else plot.groundOverrides[key] = m.ground;
      ctx.emit(plot.id, { kind: "groundFixed", row, col, from: current, to: m.ground, mutationId: m.id });
    }
  }
}

/**
 * The player session: everything the player does while online, in order.
 * It runs only on active cycles (the activity schedule), AFTER the game tick
 * of every plot - the player acts at some point during the cycle, not at the
 * tick itself. Plots take their sessions in plotOrder and share the
 * inventory in that order.
 *
 * To change what the player does or when, edit this list. Policies are read
 * per sub-step, so a stage change mid-session applies the new stage's
 * policies to the sub-steps after it.
 */
export const PLAYER_STEPS: readonly SubStep[] = [
  {
    id: "session",
    summary: "Mark the session in the event log.",
    run: (plot, ctx) => ctx.emit(plot.id, { kind: "playerSession" }),
  },
  { id: "water", summary: "Water every plant to max (watering: toMax). Soggybud can't be watered.", run: water },
  { id: "gates", summary: "Wake Snoozling, vacuum the Cheesebite rat, feed Fleshtrap (gateInteractions).", run: tendGates },
  { id: "roots", summary: "Break Devourer roots (clearRoots).", run: clearRoots },
  { id: "harvest", summary: "Harvest natural spawns (spawnedHarvest, layoutInputSpawns).", run: harvestSpawns },
  { id: "baseCrops", summary: "Harvest and replant base crops (baseCropUpkeep).", run: tendBaseCrops },
  { id: "stageChange", summary: "Apply a pending stage change, or check exit triggers and move on.", run: stageChange },
  {
    id: "harvestAfterStageChange",
    summary: "After a stage change, harvest spawns the new layout no longer uses as inputs.",
    run: (plot, ctx, scratch) => {
      if (scratch.stageChanged) harvestSpawns(plot, ctx, scratch);
    },
  },
  { id: "maintain", summary: "Clear Dead Plants and re-place missing layout plants (replaceDecayed).", run: maintain },
  { id: "fixGround", summary: "Swap wrong ground blocks under empty target cells back to what the target needs (fixGround).", run: fixGround },
];

/** One plot's player session. INTERNAL - only sim/run.ts calls it, on active cycles. */
export function runPlayerSession(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  for (const step of PLAYER_STEPS) step.run(plot, ctx, scratch);
}
