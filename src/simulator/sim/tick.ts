import type { EffectSimulation } from "../../utilities/effectSimulation";
import { effectiveList, recomputeEffects } from "../effects/adapter";
import { cellIndex, cellKey, footprint, footprintFits, GRID_SIZE, ringCells, TOTAL_CELLS } from "../grid/cells";
import { chance, intInclusive } from "../rng";
import { candidateMutations } from "../spawn/candidates";
import { effectiveWeight } from "../spawn/multiplicity";
import { applyMutationChanceBonus, rollPool, type SpawnPool } from "../spawn/pool";
import { aloeRow } from "../stage/aloe";
import { afterAdvance, growthBlockedBy, type GateEnv } from "../stage/gates";
import type { CycleCtx } from "./context";
import { stepDestruction } from "./destruction";
import { explode, isPrimedBlastberry } from "./explosion";
import type { TickScratch } from "./harvest";
import {
  buildOccupancy,
  convertToDeadPlant,
  insertPlant,
  isFootprintFree,
  isRoot,
  newPlant,
  type Occupancy,
} from "./plants";
import { stepPlayer } from "./player";
import { bump, perPlot } from "./summary";
import type { PlantState, PlotState, SlotLabel } from "./state";

/**
 * The single-tick primitive: one plot, one cycle, in the pinned step order.
 * INTERNAL - only sim/run.ts may call it (the scope-guard test enforces
 * this). It works on run()'s private working copy of the state.
 *
 *   0 effects  1 growth  2 water  3 decay  4 player (active cycles only)
 *   5 spawn    6 destruction
 *
 * Decay runs before the player, so a timer that expires on the cycle the
 * player would have harvested is lost. Spawn runs last, so a new mutation is
 * not grown, watered or decayed on the cycle it appears; it starts with its
 * full decay timer and first ticks down on the next cycle. A cell the player
 * freed this cycle can refill in the same cycle.
 */
export function tickPlot(plot: PlotState, ctx: CycleCtx): void {
  const scratch: TickScratch = { advanced: new Set() };
  const effects = recomputeEffects(plot); // 0
  stepGrowth(plot, ctx, scratch); // 1
  stepSoggybud(plot, ctx, scratch); // 2a
  stepWater(plot, ctx, scratch); // 2b
  stepDecay(plot, ctx); // 3
  if (ctx.active) stepPlayer(plot, ctx, scratch, ctx.policiesFor(plot.id)); // 4
  stepSpawn(plot, ctx, effects); // 5
  stepDestruction(plot, ctx, scratch); // 6
}

/** Latch the effect set the first time a plant is fully grown. Its decay timer is already running. */
function latchIfReady(p: PlantState, plot: PlotState, ctx: CycleCtx): void {
  if (p.lockedEffects !== null || p.isDeadPlant || p.origin === "placed" || p.stage < p.readyStage) return;
  p.lockedEffects = effectiveList(p.held);
  p.fullyGrownAtCycle = ctx.cycle;
  if (p.kindId === "blastberry") p.gate.primed = true; // a natural Blastberry primes once fully grown
  ctx.emit(plot.id, { kind: "fullyGrown", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
}

function stepGrowth(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const env: GateEnv = {
    data: ctx.env.data,
    config: ctx.config,
    occ: buildOccupancy(plot),
    active: ctx.active,
    noctilumeTimeChange: ctx.policiesFor(plot.id).gateInteractions.noctilumeTime,
  };
  for (const p of plot.plants) {
    // A placed Blastberry went in mid-stage; the next tick primes it.
    if (p.kindId === "blastberry" && p.origin === "placed" && !p.isDeadPlant) p.gate.primed = true;
    if (p.isDeadPlant || p.origin === "placed" || p.frozen) continue;
    // Soggybud's stage follows its water level (stepSoggybud), not the tick.
    if (p.kindId === "soggybud") continue;
    // Glasscorn keeps growing past its window and resets from stage 8 to 1.
    const resets = p.kindId === "glasscorn" && p.growthStages > 0 && p.stage >= p.growthStages;
    if (p.stage < p.growthStages || resets) {
      if (p.skipNextGrowth) {
        p.skipNextGrowth = false;
        ctx.emit(plot.id, { kind: "growthSkipped", plantId: p.id, kindId: p.kindId, reason: "water" });
      } else {
        const gate = growthBlockedBy(p, env);
        if (gate) {
          ctx.emit(plot.id, { kind: "growthBlocked", plantId: p.id, kindId: p.kindId, gate });
        } else {
          if (resets) {
            p.stage = 1;
            p.lockedEffects = null;
            p.fullyGrownAtCycle = null;
            // Its spawn timer keeps running: a reset lap is not a fresh spawn.
          } else {
            p.stage += 1;
          }
          scratch.advanced.add(p.id);
          ctx.emit(plot.id, { kind: "advanced", plantId: p.id, kindId: p.kindId, stage: p.stage });
          afterAdvance(p, env);
          // All-in Aloe: reaching a new stage rolls that stage's reset chance (wiki table).
          if (p.kindId === "all_in_aloe" && chance(ctx.state.rng, aloeRow(p.stage).resetChance)) {
            ctx.emit(plot.id, { kind: "reset", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col, fromStage: p.stage });
            p.stage = 1;
            p.lockedEffects = null;
            p.fullyGrownAtCycle = null;
          }
        }
      }
    }
    latchIfReady(p, plot, ctx);
  }
}

function consumesWater(p: PlantState, ctx: CycleCtx): boolean {
  if (p.origin === "planted") return true;
  if (p.origin !== "spawned" || p.kindId === "soggybud") return false; // Soggybud drinks from neighbours
  return !!ctx.env.data.mutations[p.kindId]?.requiresWatering;
}

/** A crop a Soggybud can draw water from: base crops and mutations that need watering, but not other Soggybuds. */
function holdsWater(q: PlantState, ctx: CycleCtx): boolean {
  if (q.isDeadPlant || isRoot(q) || q.kindId === "soggybud") return false;
  if (q.origin === "planted") return true;
  return !!ctx.env.data.mutations[q.kindId]?.requiresWatering;
}

/**
 * Soggybud cannot be watered. Each tick it takes water from every neighbouring
 * crop (8 cells around it, other Soggybuds excluded) that has some, and its
 * growth stage is its water level: stage = floor(water / soggybudWaterPerStage).
 */
function stepSoggybud(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { config } = ctx;
  const occ = buildOccupancy(plot);
  for (const p of plot.plants) {
    if (p.kindId !== "soggybud" || p.origin !== "spawned" || p.isDeadPlant || p.frozen) continue;
    const seen = new Set<PlantState>();
    for (const idx of ringCells(p.row, p.col, p.size)) {
      const q = occ[idx];
      if (!q || q === p || seen.has(q)) continue;
      seen.add(q);
      if (!holdsWater(q, ctx) || q.water <= 0) continue;
      const take = Math.min(config.soggybudWaterPerNeighbour, q.water);
      q.water -= take;
      p.water += take;
    }
    const cap = p.growthStages * config.soggybudWaterPerStage;
    p.water = Math.min(p.water, cap);
    const stage = Math.min(p.growthStages, Math.floor(p.water / config.soggybudWaterPerStage));
    if (stage > p.stage) {
      scratch.advanced.add(p.id);
      ctx.emit(plot.id, { kind: "advanced", plantId: p.id, kindId: p.kindId, stage });
    }
    p.stage = stage;
    latchIfReady(p, plot, ctx);
  }
}

/** Loss multiplier: improved retain supersedes the base one; drain adds 30%. */
export function retainFactor(effective: readonly string[]): number {
  let f = 1;
  if (effective.includes("improved_water_retain")) f -= 1;
  else if (effective.includes("water_retain")) f -= 0.5;
  if (effective.includes("water_drain")) f += 0.3;
  return Math.max(0, f);
}

/** "After each growth stage, a crop loses between 2-3 Water Level." */
function stepWater(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { config } = ctx;
  const rng = ctx.state.rng;
  for (const p of [...plot.plants]) {
    if (!plot.plants.includes(p) || !scratch.advanced.has(p.id) || !consumesWater(p, ctx)) continue;
    const loss = intInclusive(rng, config.waterLossMin, config.waterLossMax) * retainFactor(effectiveList(p.held));
    p.water -= loss;
    if (p.water < 0 && chance(rng, config.negativeWaterSkipChance)) p.skipNextGrowth = true;
    if (p.water > config.deathWater) continue;
    if (config.freezeInsteadOfKill) {
      p.frozen = true;
      continue;
    }
    ctx.emit(plot.id, { kind: "diedOfThirst", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
    bump(ctx.state.summary.diedOfThirst, p.kindId);
    const primed = isPrimedBlastberry(p);
    const { id, row, col } = p;
    convertToDeadPlant(ctx.state, p);
    if (primed) explode(plot, { id, row, col }, ctx);
  }
}

/** Timers run in seconds of simulated time, so they stay right when the stage length changes. */
function stepDecay(plot: PlotState, ctx: CycleCtx): void {
  for (const p of [...plot.plants]) {
    if (!plot.plants.includes(p) || p.isDeadPlant || p.frozen || p.decaySecondsRemaining === null) continue;
    p.decaySecondsRemaining -= ctx.stageSeconds;
    if (p.decaySecondsRemaining > 1e-6) continue;
    if (ctx.config.freezeInsteadOfKill) {
      p.decaySecondsRemaining = 0;
      p.frozen = true;
      continue;
    }
    ctx.emit(plot.id, { kind: "decayed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
    bump(ctx.state.summary.decayed, p.kindId);
    perPlot(ctx.state.summary, plot.id).decayed += 1;
    const primed = isPrimedBlastberry(p);
    const { id, row, col } = p;
    convertToDeadPlant(ctx.state, p);
    if (primed) explode(plot, { id, row, col }, ctx); // a decaying Blastberry breaks
  }
}

function ringCounts(occ: Occupancy, row: number, col: number, size: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const idx of ringCells(row, col, size)) {
    const q = occ[idx];
    if (q) counts[q.kindId] = (counts[q.kindId] ?? 0) + 1; // CELLS, not entities
  }
  return counts;
}

/**
 * Step 5 - every empty cell (or only labelled slots) draws ONE weighted roll
 * over every mutation eligible there, in row-major order. Any candidate can
 * win - that is the competition/dilution model. A multi-cell candidate needs
 * its whole footprint (anchored top-left at the cell) empty; a spawn blocks
 * later cells. A labelled slot considers its target even when absent from
 * coarse candidates, but ground and ring requirements still gate it.
 *
 * The player's Bioanalysis bonus scales every weight before the roll, so it
 * lifts the whole mutation arm without touching the relative odds between
 * mutations.
 */
function stepSpawn(plot: PlotState, ctx: CycleCtx, effects: EffectSimulation): void {
  const { config } = ctx;
  const { data } = ctx.env;
  const occ = buildOccupancy(plot);
  const candidates = candidateMutations(new Set(plot.plants.map((p) => p.kindId)), data);

  const slotAt = new Map<number, SlotLabel>();
  for (const s of plot.slots) slotAt.set(cellIndex(s.row, s.col), s);
  const locations =
    config.spawnCells === "slotsOnly"
      ? [...slotAt.keys()].sort((a, b) => a - b)
      : Array.from({ length: TOTAL_CELLS }, (_, i) => i);

  for (const idx of locations) {
    if (occ[idx]) continue;
    const row = Math.floor(idx / 10);
    const col = idx % 10;
    const slot = slotAt.get(idx) ?? null;
    const target = slot ? data.mutations[slot.mutationId] : undefined;
    const poolMuts = target && !candidates.includes(target) ? [...candidates, target] : candidates;

    const countsBySize = new Map<number, Record<string, number>>();
    const pool: SpawnPool = { ids: [], weights: [] };
    let targetWeight = 0;
    for (const m of poolMuts) {
      if (!footprintFits(row, col, m.size) || !isFootprintFree(occ, row, col, m.size)) continue;
      // The ground is checked per cell, not just at the anchor: a 2×2 or
      // 3×3 mutation must stand entirely on its required ground. Chorus
      // conversion wins over the stage's painted ground until the next stage.
      if (!footprint(row, col, m.size).every((c) => {
        const key = cellKey(Math.floor(c / GRID_SIZE), c % GRID_SIZE);
        return (plot.groundOverrides[key] ?? plot.groundTiles[key]) === m.ground;
      })) continue;
      let counts = countsBySize.get(m.size);
      if (!counts) {
        counts = ringCounts(occ, row, col, m.size);
        countsBySize.set(m.size, counts);
      }
      const special = m.special === "all_positive_crop_effects" ? effects.isSpecialEligible(m.id, [row, col], m.size) : undefined;
      const w = effectiveWeight(m, counts, config, special);
      if (m === target) targetWeight = w;
      if (w > 0) {
        pool.ids.push(m.id);
        pool.weights.push(w);
      }
    }
    if (slot) {
      const key = cellKey(slot.row, slot.col);
      plot.slotIneligibleCycles[key] = targetWeight > 0 ? 0 : (plot.slotIneligibleCycles[key] ?? 0) + 1;
    }

    const winner = rollPool(applyMutationChanceBonus(pool, ctx.stats.mutationChanceBonus), ctx.state.rng, config.blankFillTo);
    if (!winner) continue;

    const plant = newPlant(ctx.state, data, config, winner, row, col, "spawned", ctx.cycle, ctx.stageSeconds);
    plant.isRival = !!slot && winner !== slot.mutationId;
    insertPlant(plot, plant);
    for (const c of footprint(row, col, plant.size)) occ[c] = plant;

    bump(ctx.state.summary.spawned, winner);
    perPlot(ctx.state.summary, plot.id).spawned += 1;
    if (plant.isRival) ctx.state.summary.rivals.spawned += 1;
    ctx.emit(plot.id, {
      kind: "spawned",
      plantId: plant.id,
      mutationId: winner,
      row,
      col,
      rival: plant.isRival,
      slotTarget: slot?.mutationId ?? null,
    });
  }
}

