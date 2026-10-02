import { endStepOrHold } from "../flow/runner";
import { cellKey, footprint, footprintFits, GRID_SIZE } from "../grid/cells";
import type { CycleCtx, Phase, TickScratch } from "./context";
import { wouldDecayWithin } from "./decay";
import { harvestPlant } from "./harvest";
import { buildOccupancy, insertPlant, isFullyGrown, isHarvestable, isRoot, JELLYBEAN, newPlant, removePlant } from "./plants";
import { layoutInputAt, maintainLayout } from "./placement";
import type { PlantState, PlotState } from "./state";

/** Timer runs out before the next session and its minimum is met (`wouldDecayWithin`). Never online again: any timer counts. */
function decaysBeforeNextSession(plot: PlotState, p: PlantState, ctx: CycleCtx): boolean {
  const k = ctx.cyclesUntilNextActive();
  return wouldDecayWithin(plot, p, Number.isFinite(k) ? k * ctx.cycleSeconds : Infinity);
}

function water(plot: PlotState, ctx: CycleCtx): void {
  if (ctx.policiesFor(plot.id).watering !== "toMax") return;
  for (const p of plot.plants) if (p.kindId !== "soggybud") p.water = ctx.config.maxWater; // Soggybud can't be watered
}

/** Wake Snoozling, vacuum the Cheesebite rat, discharge Thunderling, feed Fleshtrap. */
function tendGates(plot: PlotState, ctx: CycleCtx): void {
  const g = ctx.policiesFor(plot.id).gateInteractions;
  for (const p of plot.plants) {
    if (g.wakeSnoozling && p.gate.asleep) p.gate.asleep = false;
    if (g.vacuumRat && p.gate.ratAlive) p.gate.ratAlive = false;
    if (g.dischargeThunderling && p.gate.charge) p.gate.charge = 0;
    if (g.feedFleshtrap && p.kindId === "fleshtrap" && p.origin === "spawned") {
      p.gate.hunger = (p.gate.hunger ?? 0) + ctx.config.fleshtrapFeedHunger;
    }
  }
}

/** Break Devourer roots (no drops). */
function clearRoots(plot: PlotState, ctx: CycleCtx): void {
  if (!ctx.policiesFor(plot.id).gateInteractions.clearRoots) return;
  for (const p of [...plot.plants]) {
    if (!isRoot(p)) continue;
    removePlant(plot, p);
    ctx.emit(plot.id, { kind: "removed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, reason: "cleared root" });
  }
}

/**
 * Harvest natural spawns. Aloe and Jellybean wait for their target stage
 * (aloeHarvestStage, 120). Under `layoutInputSpawns: "keep"` a spawn used as a
 * layout input stays unless it would decay before the next session.
 */
function harvestSpawns(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const policies = ctx.policiesFor(plot.id);
  if (policies.spawnedHarvest === "never") return;
  const layout = ctx.layoutFor(plot.id);
  for (const p of [...plot.plants]) {
    if (p.origin !== "spawned" || !plot.plants.includes(p)) continue;
    if (policies.layoutInputSpawns === "keep" && layoutInputAt(p, layout, ctx.config)) {
      if (isHarvestable(p) && isFullyGrown(p) && decaysBeforeNextSession(plot, p, ctx)) harvestPlant(plot, p, ctx, scratch);
      continue;
    }
    if (p.kindId === "all_in_aloe") {
      if (!isFullyGrown(p)) continue;
    } else {
      if (!isHarvestable(p)) continue;
      if (p.kindId === JELLYBEAN && !isFullyGrown(p)) continue; // only ever harvested at stage 120
      if (policies.spawnedHarvest === "beforeDecay" && !decaysBeforeNextSession(plot, p, ctx)) continue;
    }
    harvestPlant(plot, p, ctx, scratch);
  }
}

/** Harvest and replant base crops in one phase so the ring never breaks. */
function tendBaseCrops(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const upkeep = ctx.policiesFor(plot.id).baseCropUpkeep;
  if (upkeep === "leaveUntilDecay") return;
  for (const p of [...plot.plants]) {
    if (p.origin !== "planted" || !isHarvestable(p) || !plot.plants.includes(p)) continue;
    if (upkeep === "harvestBeforeDecay" && !decaysBeforeNextSession(plot, p, ctx)) continue;
    const { kindId, row, col } = p;
    if (harvestPlant(plot, p, ctx, scratch) !== "harvested") continue;
    const replant = newPlant(ctx.state, ctx.env.data, ctx.config, kindId, row, col, "planted", ctx.cycle, ctx.cycleSeconds);
    insertPlant(plot, replant);
    ctx.emit(plot.id, { kind: "placed", plantId: replant.id, kindId, row, col, origin: "planted", replacement: false });
  }
}

/** Apply a step change that came due while offline, or check exit triggers and move on. */
function stepChange(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { def, runner } = ctx.flowFor(plot.id);
  scratch.stepChanged = endStepOrHold(plot, def, runner, ctx, scratch, true);
}

/** Clear Dead Plants, take spawns off layout cells and re-place what the layout is missing. */
function maintain(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  if (scratch.stepChanged) return; // the step change already laid the layout out
  if (!ctx.policiesFor(plot.id).replaceDecayed) return;
  maintainLayout(plot, ctx.layoutFor(plot.id), ctx, scratch);
}

/**
 * Restore each target slot's required ground on free footprint cells (e.g.
 * after Chorus Fruit End Stone). Occupied cells are skipped. Free: ground
 * blocks aren't tracked in inventory.
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
 * Player session phases, in order. Runs only on active cycles, after every
 * plot's game tick; plots go in plotOrder and draw on the shared inventory in
 * that order. Policies are read per phase, so after a mid-session step change
 * later phases use the new step's policies.
 */
export const PLAYER_PHASES: readonly Phase[] = [
  {
    id: "session",
    summary: "Mark the session in the event log.",
    run: (plot, ctx) => ctx.emit(plot.id, { kind: "playerSession" }),
  },
  { id: "water", summary: "Water every plant to max (watering: toMax). Soggybud can't be watered.", run: water },
  { id: "gates", summary: "Wake Snoozling, vacuum the Cheesebite rat, discharge Thunderling, feed Fleshtrap (gateInteractions).", run: tendGates },
  { id: "roots", summary: "Break Devourer roots (clearRoots).", run: clearRoots },
  { id: "harvest", summary: "Harvest natural spawns (spawnedHarvest, layoutInputSpawns).", run: harvestSpawns },
  { id: "baseCrops", summary: "Harvest and replant base crops (baseCropUpkeep).", run: tendBaseCrops },
  { id: "stepChange", summary: "Apply a pending step change, or check exit triggers and move on.", run: stepChange },
  {
    id: "harvestAfterStepChange",
    summary: "After a step change, harvest spawns the new layout no longer uses as inputs.",
    run: (plot, ctx, scratch) => {
      if (scratch.stepChanged) harvestSpawns(plot, ctx, scratch);
    },
  },
  { id: "maintain", summary: "Clear Dead Plants and re-place missing layout plants (replaceDecayed).", run: maintain },
  { id: "fixGround", summary: "Swap wrong ground blocks under empty target cells back to what the target needs (fixGround).", run: fixGround },
];

/** Internal: only sim/run.ts calls this, on active cycles. */
export function runPlayerSession(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  for (const phase of PLAYER_PHASES) phase.run(plot, ctx, scratch);
}
