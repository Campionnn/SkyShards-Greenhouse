import type { Policies } from "../flow/types";
import type { CycleCtx } from "./context";
import { harvestPlant, type TickScratch } from "./harvest";
import { initialDecaySeconds, spawnedDecaySeconds, insertPlant, isFullyGrown, isHarvestable, isRoot, newPlant, removePlant } from "./plants";
import { maintainLayout } from "./placement";
import type { PlantState, PlotState } from "./state";

/** Would this plant's timer run out before the player's next session? */
function decaysBeforeNextSession(p: PlantState, ctx: CycleCtx): boolean {
  if (p.decaySecondsRemaining === null) return false;
  const k = ctx.cyclesUntilNextActive();
  if (!Number.isFinite(k)) return true;
  return p.decaySecondsRemaining - k * ctx.stageSeconds <= 1e-6;
}

/**
 * Step 4 - everything the player does while online, in a fixed order. Only
 * runs on active cycles (the activity schedule).
 */
export function stepPlayer(plot: PlotState, ctx: CycleCtx, scratch: TickScratch, policies: Policies): void {
  const { config } = ctx;
  const data = ctx.env.data;
  ctx.emit(plot.id, { kind: "playerSession" });

  // Frozen plants (freezeInsteadOfKill) come back with fresh water and timers.
  for (const p of plot.plants) {
    if (!p.frozen) continue;
    p.frozen = false;
    p.water = config.maxWater;
    const m = data.mutations[p.kindId];
    p.decaySecondsRemaining =
      p.origin === "spawned" && m
        ? spawnedDecaySeconds(m, config, ctx.stageSeconds)
        : initialDecaySeconds(data, config, p.kindId, p.origin, ctx.stageSeconds);
  }

  if (policies.watering === "toMax") {
    for (const p of plot.plants) if (p.kindId !== "soggybud") p.water = config.maxWater;
  }

  const g = policies.gateInteractions;
  for (const p of plot.plants) {
    if (g.wakeSnoozling && p.gate.asleep) p.gate.asleep = false;
    if (g.vacuumRat && p.gate.ratAlive) p.gate.ratAlive = false;
    if (g.feedFleshtrap && p.kindId === "fleshtrap" && p.origin === "spawned") {
      p.gate.hunger = (p.gate.hunger ?? 0) + config.fleshtrapFeedHunger;
    }
  }

  // Devourer roots: the player breaks them (they drop nothing).
  if (g.clearRoots) {
    for (const p of [...plot.plants]) {
      if (!isRoot(p)) continue;
      removePlant(plot, p);
      ctx.emit(plot.id, { kind: "removed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, reason: "cleared root" });
    }
  }

  // Natural spawns. All-in Aloe could be taken at any stage; the player takes it at its target stage.
  if (policies.spawnedHarvest !== "never") {
    for (const p of [...plot.plants]) {
      if (p.origin !== "spawned" || !plot.plants.includes(p)) continue;
      if (p.kindId === "all_in_aloe") {
        if (!isFullyGrown(p) || p.frozen) continue;
      } else {
        if (!isHarvestable(p)) continue;
        if (policies.spawnedHarvest === "beforeDecay" && !decaysBeforeNextSession(p, ctx)) continue;
      }
      harvestPlant(plot, p, ctx, scratch);
    }
  }

  // Base-crop upkeep: harvest and replant in the same step, so the ring never breaks.
  if (policies.baseCropUpkeep !== "leaveUntilDecay") {
    for (const p of [...plot.plants]) {
      if (p.origin !== "planted" || !isHarvestable(p) || !plot.plants.includes(p)) continue;
      if (policies.baseCropUpkeep === "harvestBeforeDecay" && !decaysBeforeNextSession(p, ctx)) continue;
      const { kindId, row, col } = p;
      if (harvestPlant(plot, p, ctx, scratch) !== "harvested") continue;
      const replant = newPlant(ctx.state, data, config, kindId, row, col, "planted", ctx.cycle, ctx.stageSeconds);
      insertPlant(plot, replant);
      ctx.emit(plot.id, { kind: "placed", plantId: replant.id, kindId, row, col, origin: "planted", replacement: false });
    }
  }

  // A stage change that fired while the player was away happens now.
  ctx.onPlayerSession(plot, scratch);

  if (ctx.policiesFor(plot.id).replaceDecayed) {
    maintainLayout(plot, ctx.layoutFor(plot.id), ctx, scratch);
  }
}
