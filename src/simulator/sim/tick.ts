import { effectiveList, recomputeEffects } from "../effects/adapter";
import type { FlowStage } from "../flow/types";
import { cellIndex, cellKey, footprint, footprintFits, ringCells, TOTAL_CELLS } from "../grid/cells";
import { chance, intInclusive } from "../rng";
import { candidateMutations } from "../spawn/candidates";
import { locationOpenFor, ringCounts } from "../spawn/eligibility";
import { effectiveWeight } from "../spawn/multiplicity";
import { applyMutationChanceBonus, rollPool, type SpawnPool } from "../spawn/pool";
import { aloeRow } from "../stage/aloe";
import { afterAdvance, growthBlockedBy, type GateEnv } from "../stage/gates";
import type { CycleCtx, SubStep, TickScratch } from "./context";
import { stepDestruction } from "./destruction";
import { explode, isPrimedBlastberry } from "./explosion";
import {
  buildOccupancy,
  convertToDeadPlant,
  insertPlant,
  isFootprintFree,
  isRoot,
  newPlant,
  spawnStageOf,
} from "./plants";
import { bump, perPlot } from "./summary";
import type { PlantState, PlotState, SlotLabel, WatchStatus } from "./state";

/**
 * The game tick: everything the greenhouse itself does in one cycle, in
 * order. It happens instantly, on every cycle, whether or not the player is
 * online. The player's session (sim/player.ts `PLAYER_STEPS`) comes AFTER
 * the game tick of every plot, because the player acts at some point during
 * the cycle rather than at the tick.
 *
 * Consequences of the order:
 * - Destruction runs first, before growth: a Chorus Fruit that is still
 *   growing teleports and THEN advances, so it teleports one last time on the
 *   tick it becomes fully grown. A growing Devourer rolls for a root the same
 *   way. Destruction runs before spawn, so a new spawn does nothing
 *   destructive on its spawn tick.
 * - Decay runs before the player, so a timer that expires on the cycle the
 *   player would have harvested is lost.
 * - A spawn enters at stage 1 (sim/plants.ts `spawnStageOf`). It is not grown
 *   or watered on the cycle it appears, but a mutation with no growth stages
 *   is fully grown at once: its effects latch at the end of the spawn step,
 *   so the player can harvest it that same cycle.
 * - Spawn runs before decay, so a new spawn's decay timer already ticks once
 *   on the cycle it appears (a harvestWindowCycles of N means N ticks
 *   counting the spawn tick).
 * - A cell the player frees (harvest, clearing) can only refill on the NEXT
 *   cycle's spawn roll.
 *
 * To change behaviour, edit this list: add, remove or reorder sub-steps.
 * Adding, removing or reordering an RNG draw changes every seeded result.
 */
export const TICK_STEPS: readonly SubStep[] = [
  { id: "destruction", summary: "Growing Devourers grow roots and roots spread; growing Chorus Fruit teleports (before it advances).", run: stepDestruction },
  {
    id: "effects",
    summary: "Recompute held effects for every plant (4-way propagation).",
    run: (plot, _ctx, scratch) => {
      scratch.effects = recomputeEffects(plot);
    },
  },
  { id: "growth", summary: "Advance one stage unless gated; latch effects when fully grown.", run: stepGrowth },
  { id: "soggybud", summary: "Soggybud draws water from its neighbours; stage follows water.", run: stepSoggybud },
  { id: "water", summary: "Plants that advanced this cycle lose 2-3 water; thirst kills.", run: stepWater },
  { id: "spawn", summary: "Every empty cell (or only slots) rolls once for a spawn (at stage 1; 0-stage kinds latch at once); uptime is booked.", run: stepSpawn },
  { id: "decay", summary: "Decay timers tick down; expired plants become Dead Plants.", run: stepDecay },
];

/**
 * One plot's game tick. INTERNAL - only sim/run.ts may call it (the
 * scope-guard test enforces this). It works on run()'s private working copy.
 */
export function tickPlot(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  for (const step of TICK_STEPS) step.run(plot, ctx, scratch);
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
    if (p.isDeadPlant || p.origin === "placed") continue;
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
    // It enters at stage 1 like every spawn; water only ever moves it up from there.
    const stage = Math.min(p.growthStages, Math.max(spawnStageOf(p.growthStages), Math.floor(p.water / config.soggybudWaterPerStage)));
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
    if (!plot.plants.includes(p) || p.isDeadPlant || p.decaySecondsRemaining === null) continue;
    p.decaySecondsRemaining -= ctx.stageSeconds;
    if (p.decaySecondsRemaining > 1e-6) continue;
    ctx.emit(plot.id, { kind: "decayed", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
    bump(ctx.state.summary.decayed, p.kindId);
    perPlot(ctx.state.summary, plot.id).decayed += 1;
    const primed = isPrimedBlastberry(p);
    const { id, row, col } = p;
    convertToDeadPlant(ctx.state, p);
    if (primed) explode(plot, { id, row, col }, ctx); // a decaying Blastberry breaks
  }
}

/** Slot anchor keys the current stage watches: its `watch` list, or every target when it has none. */
function watchedKeys(plot: PlotState, stage: FlowStage): Set<string> {
  const all = plot.slots.map((s) => cellKey(s.row, s.col));
  if (!stage.watch) return new Set(all);
  const wanted = new Set(stage.watch);
  return new Set(all.filter((k) => wanted.has(k)));
}

/** What a watched slot holds when something is standing on its anchor. */
function occupiedStatus(q: PlantState, slot: SlotLabel): WatchStatus {
  return q.kindId === slot.mutationId && !q.isDeadPlant ? "growing" : "blocked";
}

/** Book one watched cell-cycle into the per-spot record and the run totals. */
function recordWatch(plot: PlotState, ctx: CycleCtx, stageId: string, slot: SlotLabel, status: WatchStatus): void {
  const key = cellKey(slot.row, slot.col);
  plot.watchStatus[key] = status;
  const byStage = ((ctx.state.uptime[String(plot.id)] ??= {})[stageId] ??= {});
  const spot = (byStage[key] ??= {
    mutationId: slot.mutationId,
    row: slot.row,
    col: slot.col,
    watched: 0,
    growing: 0,
    ready: 0,
    requirements: 0,
    blocked: 0,
    firstRequirementsCycle: null,
    longestRequirementsStreak: 0,
    currentRequirementsStreak: 0,
    lastCycle: -1,
  });
  // A streak only continues over consecutive cycles (a looping rotation revisits the stage later).
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
 * Spawn - every empty cell (or only labelled slots) draws ONE weighted roll
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
function stepSpawn(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { config } = ctx;
  const { data } = ctx.env;
  const effects = scratch.effects ?? recomputeEffects(plot);
  const occ = buildOccupancy(plot);
  const candidates = candidateMutations(new Set(plot.plants.map((p) => p.kindId)), data);

  const slotAt = new Map<number, SlotLabel>();
  for (const s of plot.slots) slotAt.set(cellIndex(s.row, s.col), s);
  const locations =
    config.spawnCells === "slotsOnly"
      ? [...slotAt.keys()].sort((a, b) => a - b)
      : Array.from({ length: TOTAL_CELLS }, (_, i) => i);

  const stage = ctx.stageFor(plot.id);
  const watched = watchedKeys(plot, stage);
  plot.watchStatus = {};
  /** Spawns that are fully grown the moment they appear (0 growth stages). */
  const grownOnSpawn: PlantState[] = [];

  for (const idx of locations) {
    const row = Math.floor(idx / 10);
    const col = idx % 10;
    const slot = slotAt.get(idx) ?? null;
    const watch = !!slot && watched.has(cellKey(row, col));
    const standing = occ[idx];
    if (standing) {
      if (watch) recordWatch(plot, ctx, stage.id, slot!, occupiedStatus(standing, slot!));
      continue;
    }
    const target = slot ? data.mutations[slot.mutationId] : undefined;
    const poolMuts = target && !candidates.includes(target) ? [...candidates, target] : candidates;

    const countsBySize = new Map<number, Record<string, number>>();
    const pool: SpawnPool = { ids: [], weights: [] };
    let targetWeight = 0;
    for (const m of poolMuts) {
      if (!locationOpenFor(plot, occ, row, col, m)) continue;
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
      if (watch) {
        // Empty anchor: ready if the target could spawn now; blocked if its
        // footprint is covered by something else; otherwise its requirements
        // (neighbours or ground) are missing.
        const status: WatchStatus =
          targetWeight > 0
            ? "ready"
            : target && footprintFits(row, col, target.size) && !isFootprintFree(occ, row, col, target.size)
              ? "blocked"
              : "requirements";
        recordWatch(plot, ctx, stage.id, slot, status);
      }
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
    if (plant.stage >= plant.readyStage) grownOnSpawn.push(plant);
  }

  // Refresh held effects for the plot as the spawn roll left it. Always, not
  // only when something spawned: the player session reads `held` for the one
  // harvest that has no latched set (an All-in Aloe taken before its harvest
  // stage), and it must see the same plot every tick. No RNG is drawn.
  // A mutation with no growth stages is fully grown as it spawns, so it
  // latches here against that refreshed set rather than at the next growth step.
  scratch.effects = recomputeEffects(plot);
  for (const p of grownOnSpawn) latchIfReady(p, plot, ctx);
}

