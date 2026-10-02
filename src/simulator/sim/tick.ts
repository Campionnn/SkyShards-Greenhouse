import { effectiveList, recomputeEffects } from "../effects/adapter";
import type { FlowStep } from "../flow/types";
import { cellIndex, cellKey, footprint, footprintFits, ringCells, TOTAL_CELLS } from "../grid/cells";
import { DECAY_EXTENSION_HOURS, SPAWN_POOL_FLOOR } from "../config";
import { chance, intInclusive } from "../rng";
import { candidateMutations } from "../spawn/candidates";
import { locationOpenFor, ringCounts, type RingCounts } from "../spawn/eligibility";
import { effectiveWeight } from "../spawn/multiplicity";
import { applyMutationChanceBonus, rollPool, type SpawnPool } from "../spawn/pool";
import { aloeRow } from "../growth/aloe";
import { afterAdvance, growthBlockedBy, type GateEnv } from "../growth/gates";
import type { CycleCtx, Phase, TickScratch } from "./context";
import { creditInputs, isPooled, minimumMet, poolSnapshot } from "./decay";
import { phaseDestruction } from "./destruction";
import { explode, isPrimedBlastberry } from "./explosion";
import {
  buildOccupancy,
  convertToDeadPlant,
  DEAD_PLANT,
  insertPlant,
  isDry,
  isFootprintFree,
  isRoot,
  newPlant,
  removePlant,
  spawnStageOf,
} from "./plants";
import { bump, perPlot } from "./summary";
import type { PlantState, PlotState, SlotLabel, WatchStatus } from "./state";

/**
 * The game tick: what the greenhouse does each cycle, in order, online or not.
 * The player session (sim/player.ts `PLAYER_PHASES`) runs after every plot's tick.
 *
 * Order matters:
 * - Destruction before growth: a growing Chorus Fruit teleports, then advances, so it teleports
 *   on the tick it becomes fully grown (same for a growing Devourer's root roll). Before spawn,
 *   so a new spawn does nothing destructive on its spawn tick.
 * - Spawns enter at stage 1 (`spawnStageOf`) and are not grown or watered that cycle; a 0-stage
 *   kind latches at the end of the spawn phase and is harvestable the same cycle.
 * - Spawn before decay: a spawn's timer ticks once on its spawn cycle.
 * - Decay before the player: a timer expiring on a harvest cycle is lost.
 * - A cell freed by the player refills at the next cycle's spawn roll at the earliest.
 * Reordering phases or RNG draws changes every seeded result.
 */
export const TICK_PHASES: readonly Phase[] = [
  { id: "destruction", summary: "Growing Devourers grow roots and roots spread; growing Chorus Fruit teleports (before it advances).", run: phaseDestruction },
  {
    id: "effects",
    summary: "Recompute held effects for every plant (4-way propagation).",
    run: (plot, _ctx, scratch) => {
      scratch.effects = recomputeEffects(plot);
    },
  },
  { id: "growth", summary: "Advance one growth stage unless gated or dried out; latch effects when fully grown.", run: phaseGrowth },
  { id: "soggybud", summary: "Soggybud draws water from its neighbours; stage follows water.", run: phaseSoggybud },
  {
    id: "water",
    summary:
      "Water consumers not yet fully grown lose waterLossMin-Max water (default 18-22, x retain/drain) every cycle, advanced or not; at the halt level they dry out (halt until watered) and lose no more.",
    run: phaseWater,
  },
  { id: "spawn", summary: "Every empty cell rolls once for a spawn (at stage 1; 0-stage kinds latch at once); uptime is booked.", run: phaseSpawn },
  {
    id: "decay",
    summary:
      "Decay timers tick down. An expired plant decays only if its minimum mutations are met (pool snapshotted once per tick), else +24h; a decayed dead plant leaves nothing, anything else becomes a Dead Plant.",
    run: phaseDecay,
  },
];

/** One plot's game tick, on run()'s working copy. Internal: only sim/run.ts may import it (scope-guard test). */
export function tickPlot(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  for (const phase of TICK_PHASES) phase.run(plot, ctx, scratch);
}

/** Latch effects the first time a plant is fully grown. */
function latchIfReady(p: PlantState, plot: PlotState, ctx: CycleCtx): void {
  if (p.lockedEffects !== null || p.isDeadPlant || p.origin === "placed" || p.stage < p.readyStage) return;
  p.lockedEffects = effectiveList(p.held);
  p.fullyGrownAtCycle = ctx.cycle;
  if (p.kindId === "blastberry") p.gate.primed = true; // a natural Blastberry primes once fully grown
  ctx.emit(plot.id, { kind: "fullyGrown", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
}

function phaseGrowth(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const env: GateEnv = {
    data: ctx.env.data,
    config: ctx.config,
    occ: buildOccupancy(plot),
    active: ctx.active,
    noctilumeTimeChange: ctx.policiesFor(plot.id).gateInteractions.noctilumeTime,
  };
  for (const p of plot.plants) {
    // A placed Blastberry primes on the first tick after placement.
    if (p.kindId === "blastberry" && p.origin === "placed" && !p.isDeadPlant) p.gate.primed = true;
    if (p.isDeadPlant || p.origin === "placed") continue;
    // Soggybud's stage follows its water (phaseSoggybud).
    if (p.kindId === "soggybud") continue;
    // Recorded before advancing: phaseWater drains it this cycle even if it grows its last stage now.
    if (p.stage < p.readyStage) scratch.notFullyGrown.add(p.id);
    // Glasscorn keeps growing past its window and resets from stage 8 to 1.
    const resets = p.kindId === "glasscorn" && p.growthStages > 0 && p.stage >= p.growthStages;
    if (p.stage < p.growthStages || resets) {
      if (isDry(p)) {
        // Checked before the water skip, so a pending skip is kept until watered.
        ctx.emit(plot.id, { kind: "growthBlocked", plantId: p.id, kindId: p.kindId, gate: "dry" });
      } else if (p.skipNextGrowth) {
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
            // Decay timer is not reset.
          } else {
            p.stage += 1;
          }
          ctx.emit(plot.id, { kind: "advanced", plantId: p.id, kindId: p.kindId, stage: p.stage });
          afterAdvance(p, env);
          // All-in Aloe: each new stage rolls that stage's reset chance (wiki table).
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

/** Soggybud water source: base crops and mutations that need watering, not other Soggybuds. */
function holdsWater(q: PlantState, ctx: CycleCtx): boolean {
  if (q.isDeadPlant || isRoot(q) || q.kindId === "soggybud") return false;
  if (q.origin === "planted") return true;
  return !!ctx.env.data.mutations[q.kindId]?.requiresWatering;
}

/**
 * Soggybud cannot be watered. Each tick it takes up to soggybudWaterPerNeighbour from each 8-way
 * neighbour (`holdsWater`); stage = floor(water / soggybudWaterPerStage), clamped to [spawn stage, growthStages].
 */
function phaseSoggybud(plot: PlotState, ctx: CycleCtx): void {
  const { config } = ctx;
  const occ = buildOccupancy(plot);
  for (const p of plot.plants) {
    if (p.kindId !== "soggybud" || p.origin !== "spawned" || p.isDeadPlant) continue;
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
    const stage = Math.min(p.growthStages, Math.max(spawnStageOf(p.growthStages), Math.floor(p.water / config.soggybudWaterPerStage)));
    if (stage > p.stage) ctx.emit(plot.id, { kind: "advanced", plantId: p.id, kindId: p.kindId, stage });
    p.stage = stage;
    latchIfReady(p, plot, ctx);
  }
}

/**
 * Water loss multiplier: Water Retain (+50%) divides loss by 1.5, Improved Water Retain (+100%,
 * overrides Water Retain) by 2, so a Godseed still drinks. Water Drain adds 30%.
 */
export function retainFactor(effective: readonly string[]): number {
  const retain = effective.includes("improved_water_retain") ? 1 : effective.includes("water_retain") ? 0.5 : 0;
  const drain = effective.includes("water_drain") ? 0.3 : 0;
  return (1 + drain) / (1 + retain);
}

/**
 * A water consumer drinks every tick it is not fully grown (advanced, gated or skipped alike),
 * judged before the growth phase advanced it (`scratch.notFullyGrown`). So it drinks on the tick
 * it reaches its last stage, a Glasscorn drinks again after resetting to stage 1, 0-stage kinds
 * never drink, and a plant placed mid-session first drinks next tick. Dry plants don't drink.
 */
function drinks(p: PlantState, ctx: CycleCtx, scratch: TickScratch): boolean {
  return scratch.notFullyGrown.has(p.id) && consumesWater(p, ctx) && !isDry(p);
}

/**
 * Each drinking plant loses waterLossMin..waterLossMax x retainFactor. Below 0 it may skip its next
 * stage. At `HALT_WATER` it dries out and halts until watered (`isDry`); since dry plants don't
 * drink, `driedOut` fires once per dry-out.
 * RNG: per drinking plant in plot order, one intInclusive, then one chance if water < 0.
 */
function phaseWater(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { config } = ctx;
  const rng = ctx.state.rng;
  for (const p of plot.plants) {
    if (!drinks(p, ctx, scratch)) continue;
    const loss = intInclusive(rng, config.waterLossMin, config.waterLossMax) * retainFactor(effectiveList(p.held));
    p.water -= loss;
    if (p.water < 0 && chance(rng, config.negativeWaterSkipChance)) p.skipNextGrowth = true;
    if (!isDry(p)) continue;
    ctx.emit(plot.id, { kind: "driedOut", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
    bump(ctx.state.summary.driedOut, p.kindId);
  }
}

/**
 * Decay timers count down in seconds (cycle length varies). Pools are snapshotted once per phase,
 * so pooled plants of a kind expiring this tick are judged together (sim/decay.ts). On expiry:
 * - minimum met: decays. A dead_plant leaves an empty cell; anything else becomes a Dead Plant,
 *   and a primed Blastberry explodes.
 * - not met: timer extended by `DECAY_EXTENSION_HOURS` until positive; re-checked at the next expiry.
 * Dead Plants decay too. No RNG.
 */
function phaseDecay(plot: PlotState, ctx: CycleCtx): void {
  const { data } = ctx.env;
  const pools = poolSnapshot(plot);
  const extension = DECAY_EXTENSION_HOURS * 3600;
  for (const p of [...plot.plants]) {
    if (!plot.plants.includes(p) || p.decaySecondsRemaining === null) continue;
    p.decaySecondsRemaining -= ctx.cycleSeconds;
    if (p.decaySecondsRemaining > 1e-6) continue;
    const combined = pools.get(p.kindId) ?? null;
    if (!minimumMet(p, combined)) {
      // Non-positive extension: leave the timer expired and re-check every tick (avoids an infinite loop).
      if (extension > 0) while (p.decaySecondsRemaining <= 1e-6) p.decaySecondsRemaining += extension;
      ctx.emit(plot.id, {
        kind: "decayExtended",
        plantId: p.id,
        kindId: p.kindId,
        row: p.row,
        col: p.col,
        mutatesRemaining: p.mutatesRemaining,
        combined: isPooled(p) ? combined : null,
      });
      bump((ctx.state.summary.extended ??= {}), p.kindId);
      continue;
    }
    ctx.emit(plot.id, { kind: "decayed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
    bump(ctx.state.summary.decayed, p.kindId);
    perPlot(ctx.state.summary, plot.id).decayed += 1;
    if (p.kindId === DEAD_PLANT) {
      removePlant(plot, p);
      continue;
    }
    const primed = isPrimedBlastberry(p);
    const { id, row, col } = p;
    convertToDeadPlant(ctx.state, data, p);
    if (primed) explode(plot, { id, row, col }, ctx); // a decaying Blastberry breaks
  }
}

/** Slot anchor keys the step watches: its `watch` list, or every slot when omitted. */
function watchedKeys(plot: PlotState, step: FlowStep): Set<string> {
  const all = plot.slots.map((s) => cellKey(s.row, s.col));
  if (!step.watch) return new Set(all);
  const wanted = new Set(step.watch);
  return new Set(all.filter((k) => wanted.has(k)));
}

/** Status of an occupied watched slot: its target (growing, or halted if dry) or anything else (blocked). */
function occupiedStatus(q: PlantState, slot: SlotLabel): WatchStatus {
  if (q.kindId !== slot.mutationId || q.isDeadPlant) return "blocked";
  return isDry(q) ? "halted" : "growing";
}

/** Record one watched cell-cycle in the per-spot counters and run totals. */
function recordWatch(plot: PlotState, ctx: CycleCtx, stepId: string, slot: SlotLabel, status: WatchStatus): void {
  const key = cellKey(slot.row, slot.col);
  plot.watchStatus[key] = status;
  const byStep = ((ctx.state.uptime[String(plot.id)] ??= {})[stepId] ??= {});
  const spot = (byStep[key] ??= {
    mutationId: slot.mutationId,
    row: slot.row,
    col: slot.col,
    watched: 0,
    growing: 0,
    ready: 0,
    requirements: 0,
    blocked: 0,
    halted: 0,
    firstRequirementsCycle: null,
    longestRequirementsStreak: 0,
    currentRequirementsStreak: 0,
    lastCycle: -1,
  });
  // Streaks break across non-consecutive cycles (a looping flow revisits the step).
  if (spot.lastCycle !== ctx.cycle - 1) spot.currentRequirementsStreak = 0;
  spot.lastCycle = ctx.cycle;
  spot.watched += 1;
  spot[status] += 1;
  const total = ctx.state.summary.uptime;
  total.watched += 1;
  total[status] += 1;
  if (status === "requirements") {
    spot.firstRequirementsCycle ??= ctx.cycle;
    spot.currentRequirementsStreak += 1;
    spot.longestRequirementsStreak = Math.max(spot.longestRequirementsStreak, spot.currentRequirementsStreak);
  } else {
    spot.currentRequirementsStreak = 0;
  }
}

/**
 * Each empty cell, row-major, draws one weighted roll over every
 * mutation eligible there; any candidate can win. Multi-cell candidates need their whole footprint
 * (top-left anchored) empty, and a spawn blocks later cells this tick. A slot always considers its
 * target, still gated by ground and ring requirements. Bioanalysis scales all weights uniformly.
 */
function phaseSpawn(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { config } = ctx;
  const { data } = ctx.env;
  const effects = scratch.effects ?? recomputeEffects(plot);
  const occ = buildOccupancy(plot);
  const candidates = candidateMutations(new Set(plot.plants.map((p) => p.kindId)), data);

  const slotAt = new Map<number, SlotLabel>();
  for (const s of plot.slots) slotAt.set(cellIndex(s.row, s.col), s);
  const locations = Array.from({ length: TOTAL_CELLS }, (_, i) => i);

  const step = ctx.stepFor(plot.id);
  const watched = watchedKeys(plot, step);
  plot.watchStatus = {};
  // 0-stage spawns, latched after the loop.
  const grownOnSpawn: PlantState[] = [];

  for (const idx of locations) {
    const row = Math.floor(idx / 10);
    const col = idx % 10;
    const slot = slotAt.get(idx) ?? null;
    const watch = !!slot && watched.has(cellKey(row, col));
    const standing = occ[idx];
    if (standing) {
      if (watch) recordWatch(plot, ctx, step.id, slot!, occupiedStatus(standing, slot!));
      continue;
    }
    const target = slot ? data.mutations[slot.mutationId] : undefined;
    const poolMuts = target && !candidates.includes(target) ? [...candidates, target] : candidates;

    // Requirement counts skip dried-out plants; Lonelily reads plain occupancy (spawn/eligibility.ts).
    const ringBySize = new Map<number, RingCounts>();
    const pool: SpawnPool = { ids: [], weights: [] };
    let targetWeight = 0;
    for (const m of poolMuts) {
      if (!locationOpenFor(plot, occ, row, col, m)) continue;
      let ring = ringBySize.get(m.size);
      if (!ring) {
        ring = ringCounts(occ, row, col, m.size);
        ringBySize.set(m.size, ring);
      }
      const special = m.special === "all_positive_crop_effects" ? effects.isSpecialEligible(m.id, [row, col], m.size) : undefined;
      const w = effectiveWeight(m, ring, special);
      if (m === target) targetWeight = w;
      if (w > 0) {
        pool.ids.push(m.id);
        pool.weights.push(w);
      }
    }
    if (slot) {
      const key = cellKey(slot.row, slot.col);
      plot.slotIneligibleCycles[key] = targetWeight > 0 ? 0 : (plot.slotIneligibleCycles[key] ?? 0) + 1;
      if (watch) {
        const status: WatchStatus =
          targetWeight > 0
            ? "ready"
            : target && footprintFits(row, col, target.size) && !isFootprintFree(occ, row, col, target.size)
              ? "blocked"
              : "requirements";
        recordWatch(plot, ctx, step.id, slot, status);
      }
    }

    const winner = rollPool(applyMutationChanceBonus(pool, ctx.stats.mutationChanceBonus), ctx.state.rng, SPAWN_POOL_FLOOR);
    if (!winner) continue;

    const plant = newPlant(ctx.state, data, config, winner, row, col, "spawned", ctx.cycle);
    plant.isRival = !!slot && winner !== slot.mutationId;
    insertPlant(plot, plant);
    for (const c of footprint(row, col, plant.size)) occ[c] = plant;
    // Credit the requirement neighbours toward their minimum mutations (sim/decay.ts).
    creditInputs(plot, occ, plant, data.mutations[winner], ctx);

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
    if (plant.stage >= plant.readyStage) grownOnSpawn.push(plant);
  }

  // Always refresh effects, even with no spawn: the player session reads `held` for unlatched
  // harvests (All-in Aloe before its harvest stage). 0-stage spawns latch against this set.
  scratch.effects = recomputeEffects(plot);
  for (const p of grownOnSpawn) latchIfReady(p, plot, ctx);
}

