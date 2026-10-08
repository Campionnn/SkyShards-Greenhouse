import { MAX_WATER } from "../config";
import { endStepOrHold } from "../flow/runner";
import { aloeHarvestStageFor } from "../growth/aloe";
import { respawnChance } from "../spawn/respawn";
import { cellKey, footprint, footprintFits, GRID_SIZE } from "../grid/cells";
import type { CycleCtx, Phase, TickScratch } from "./context";
import { wouldDecayWithin } from "./decay";
import { harvestPlant } from "./harvest";
import { buildOccupancy, insertPlant, isFullyGrown, isHarvestable, isRoot, JELLYBEAN, newPlant, removePlant } from "./plants";
import { layoutInputAt, maintainLayout, removeByPlayer } from "./placement";
import type { PlantState, PlotState } from "./state";
import { isProtected, phaseDisabled } from "../script/overrides";

/** A script protected this plant from the built-in phases (`plant.protect()`). No scripts: never. */
const guarded = (plot: PlotState, p: PlantState, ctx: CycleCtx): boolean => !!ctx.state.scripts && isProtected(ctx.state, plot.id, p.id);

/** Timer runs out before the next session and its minimum is met (`wouldDecayWithin`). Never online again: any timer counts. */
function decaysBeforeNextSession(plot: PlotState, p: PlantState, ctx: CycleCtx): boolean {
  const k = ctx.cyclesUntilNextActive();
  return wouldDecayWithin(plot, p, Number.isFinite(k) ? k * ctx.cycleSeconds : Infinity);
}

function water(plot: PlotState, ctx: CycleCtx): void {
  if (ctx.policiesFor(plot.id).watering !== "toMax") return;
  for (const p of plot.plants) if (p.kindId !== "soggybud") p.water = MAX_WATER; // Soggybud can't be watered
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
 * Whether the player harvests this All-in Aloe now. Fixed: once fully grown
 * (`aloeHarvestStage`). Auto: at the stage that makes the most aloe per cycle
 * for the cycles until the next session and the chance an aloe respawns in the
 * emptied cell (growth/aloe.ts). The choice is kept on the plant for the tooltip.
 */
function aloeDue(plot: PlotState, p: PlantState, ctx: CycleCtx, scratch: TickScratch): boolean {
  if (!ctx.config.aloeAutoHarvest) return isFullyGrown(p);
  const gapCycles = ctx.cyclesUntilNextActive();
  const q = respawnChance(plot, p, p.kindId, ctx.env.data, scratch.effects, ctx.stats.mutationChanceBonus);
  const stage = aloeHarvestStageFor(gapCycles, q);
  p.gate.aloeHarvest = { stage, gapCycles: Number.isFinite(gapCycles) ? gapCycles : -1, respawnChance: q };
  return p.stage >= stage;
}

/**
 * Harvest natural spawns. Aloe and Jellybean wait for their target stage
 * (aloeDue, 120). Under `layoutInputSpawns: "keep"` a spawn used as a
 * layout input stays unless it would decay before the next session.
 */
function harvestSpawns(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const policies = ctx.policiesFor(plot.id);
  if (policies.spawnedHarvest === "never") return;
  const layout = ctx.layoutFor(plot.id);
  for (const p of [...plot.plants]) {
    if (p.origin !== "spawned" || !plot.plants.includes(p) || guarded(plot, p, ctx)) continue;
    if (policies.layoutInputSpawns === "keep" && layoutInputAt(p, layout, ctx.config)) {
      if (isHarvestable(p) && isFullyGrown(p) && decaysBeforeNextSession(plot, p, ctx)) harvestPlant(plot, p, ctx, scratch);
      continue;
    }
    if (p.kindId === "all_in_aloe") {
      if (!aloeDue(plot, p, ctx, scratch)) continue;
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
    if (p.origin !== "planted" || !isHarvestable(p) || !plot.plants.includes(p) || guarded(plot, p, ctx)) continue;
    if (upkeep === "harvestBeforeDecay" && !decaysBeforeNextSession(plot, p, ctx)) continue;
    const { kindId, row, col } = p;
    harvestPlant(plot, p, ctx, scratch);
    const replant = newPlant(ctx.state, ctx.env.data, ctx.config, kindId, row, col, "planted", ctx.cycle);
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
 * Break natural spawns of another kind standing on the step's target cells: leftovers
 * from earlier steps (e.g. an unwatered Soggybud that can never finish) or off-target
 * spawns. Fully grown ones are harvested (`removeByPlayer`). Same-kind plants, Dead
 * Plants, roots and placed/planted plants are left alone (layout cells never overlap
 * target cells; Dead Plants are `maintain`'s job).
 */
function clearTargetBlockers(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  if (ctx.policiesFor(plot.id).clearTargetBlockers === false || plot.slots.length === 0) return;
  const occ = buildOccupancy(plot);
  for (const slot of plot.slots) {
    if (!footprintFits(slot.row, slot.col, slot.size)) continue;
    for (const idx of footprint(slot.row, slot.col, slot.size)) {
      const q = occ[idx];
      if (!q || q.origin !== "spawned" || q.isDeadPlant || isRoot(q) || q.kindId === slot.mutationId || !plot.plants.includes(q) || guarded(plot, q, ctx)) continue;
      removeByPlayer(plot, q, ctx, scratch, "blocking target");
    }
  }
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
  {
    id: "clearTargets",
    summary: "Break natural spawns of another kind standing on target cells; harvest them if fully grown (clearTargetBlockers).",
    run: clearTargetBlockers,
  },
  { id: "fixGround", summary: "Swap wrong ground blocks under empty target cells back to what the target needs (fixGround).", run: fixGround },
];

/**
 * Internal: only sim/run.ts calls this, on active cycles. With scripts: the plot script's
 * `onSession` runs first and `afterSession` last; phases a script disabled are skipped; queued
 * script events are delivered after each phase.
 */
export function runPlayerSession(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const scripts = ctx.scripts;
  if (!scripts) {
    for (const phase of PLAYER_PHASES) phase.run(plot, ctx, scratch);
    return;
  }
  scripts.callHook("onSession", [], plot.id);
  for (const phase of PLAYER_PHASES) {
    if (phaseDisabled(ctx.state, plot.id, phase.id)) continue;
    phase.run(plot, ctx, scratch);
    scripts.flush();
  }
  scripts.callHook("afterSession", [], plot.id);
}

/** Run one session phase on demand (a script's `plot.runPhase(id)`). Ignores the disabled list. */
export function runSessionPhase(plot: PlotState, ctx: CycleCtx, scratch: TickScratch, phaseId: string): void {
  const phase = PLAYER_PHASES.find((p) => p.id === phaseId);
  if (!phase) throw new Error(`Unknown session phase "${phaseId}"`);
  phase.run(plot, ctx, scratch);
}
