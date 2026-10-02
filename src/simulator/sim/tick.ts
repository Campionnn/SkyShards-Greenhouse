import { effectiveList, recomputeEffects } from "../effects/adapter";
import type { FlowStep } from "../flow/types";
import { cellIndex, cellKey, footprint, footprintFits, ringCells, TOTAL_CELLS } from "../grid/cells";
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
 * The game tick: everything the greenhouse itself does in one cycle, in
 * order. It happens instantly, on every cycle, whether or not the player is
 * online. The player's session (sim/player.ts `PLAYER_PHASES`) comes AFTER
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
 *   is fully grown at once: its effects latch at the end of the spawn phase,
 *   so the player can harvest it that same cycle.
 * - Spawn runs before decay, so a new spawn's decay timer already ticks once
 *   on the cycle it appears (a harvestWindowCycles of N means N ticks
 *   counting the spawn tick).
 * - A cell the player frees (harvest, clearing) can only refill on the NEXT
 *   cycle's spawn roll.
 *
 * To change behaviour, edit this list: add, remove or reorder phases.
 * Adding, removing or reordering an RNG draw changes every seeded result.
 */
export const TICK_PHASES: readonly Phase[] = [
  { id: "destruction", summary: "Growing Devourers grow roots and roots spread; growing Chorus Fruit teleports (before it advances).", run: phaseDestruction },
  {
    id: "effects",
    summary: "Recompute held effects for every plant (4-way propagation).",
    run: (plot, ctx, scratch) => {
      scratch.effects = recomputeEffects(plot, ctx.config);
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
  { id: "spawn", summary: "Every empty cell (or only slots) rolls once for a spawn (at stage 1; 0-stage kinds latch at once); uptime is booked.", run: phaseSpawn },
  {
    id: "decay",
    summary:
      "Decay timers tick down. An expired plant decays only if its minimum mutations are met (pool snapshotted once per tick), else +24h; a decayed dead plant leaves nothing, anything else becomes a Dead Plant.",
    run: phaseDecay,
  },
];

/**
 * One plot's game tick. INTERNAL - only sim/run.ts may call it (the
 * scope-guard test enforces this). It works on run()'s private working copy.
 */
export function tickPlot(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  for (const phase of TICK_PHASES) phase.run(plot, ctx, scratch);
}

/** Latch the effect set the first time a plant is fully grown. Its decay timer is already running. */
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
    // A placed Blastberry went in mid-stage; the next tick primes it.
    if (p.kindId === "blastberry" && p.origin === "placed" && !p.isDeadPlant) p.gate.primed = true;
    if (p.isDeadPlant || p.origin === "placed") continue;
    // Soggybud's stage follows its water level (phaseSoggybud), not the tick.
    if (p.kindId === "soggybud") continue;
    // Not fully grown as the tick starts: it drinks this cycle (phaseWater),
    // whether or not it advances below.
    if (p.stage < p.readyStage) scratch.notFullyGrown.add(p.id);
    // Glasscorn keeps growing past its window and resets from stage 8 to 1.
    const resets = p.kindId === "glasscorn" && p.growthStages > 0 && p.stage >= p.growthStages;
    if (p.stage < p.growthStages || resets) {
      if (isDry(p, ctx.config)) {
        // Dried out: halted until the player waters it. Checked before the
        // water skip, so a pending skip waits until the plant is watered.
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
            // Its spawn timer keeps running: a reset lap is not a fresh spawn.
          } else {
            p.stage += 1;
          }
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
    // It enters at stage 1 like every spawn; water only ever moves it up from there.
    const stage = Math.min(p.growthStages, Math.max(spawnStageOf(p.growthStages), Math.floor(p.water / config.soggybudWaterPerStage)));
    if (stage > p.stage) ctx.emit(plot.id, { kind: "advanced", plantId: p.id, kindId: p.kindId, stage });
    p.stage = stage;
    latchIfReady(p, plot, ctx);
  }
}

/**
 * Loss multiplier (user-confirmed): "retains watering status by +X%" means
 * the water lasts (1 + X) times as long, so the loss is divided by 1 + X.
 * Water Retain (+50%) gives loss / 1.5, Improved Water Retain (+100%,
 * supersedes the base one) loss / 2 - it halves the loss, never removes it,
 * so a Godseed (which always holds improved retain) still drinks. Water Drain
 * amplifies the loss by 30%.
 */
export function retainFactor(effective: readonly string[]): number {
  const retain = effective.includes("improved_water_retain") ? 1 : effective.includes("water_retain") ? 0.5 : 0;
  const drain = effective.includes("water_drain") ? 0.3 : 0;
  return (1 + drain) / (1 + retain);
}

/**
 * Does this plant drink this cycle? A water consumer drinks on every tick it
 * is not fully grown - whether it advanced, was gated, skipped or blocked -
 * and stops once fully grown (0.27.2 follow-up, user-confirmed).
 *
 * "Not fully grown" = `stage < readyStage` as the tick's growth phase reached
 * the plant, BEFORE it advanced (`scratch.notFullyGrown`). `readyStage` is the
 * stage `isFullyGrown` and latching use. Consequences:
 * - the tick a plant grows its last stage still drains (it spent that cycle
 *   growing, like every stage before it); from the next tick it never drinks;
 * - a Glasscorn drinks again after its lap resets it to stage 1 (stages 7-8
 *   are fully grown); an All-in Aloe would after a reset, but it doesn't
 *   need watering;
 * - a 0-stage kind is fully grown the moment it spawns and never drinks;
 * - a plant the player places or plants mid-session first drinks on the
 *   next tick.
 * A dried-out plant drinks no more: it is already halted.
 */
function drinks(p: PlantState, ctx: CycleCtx, scratch: TickScratch): boolean {
  return scratch.notFullyGrown.has(p.id) && consumesWater(p, ctx) && !isDry(p, ctx.config);
}

/**
 * Water loss (0.27.2 follow-up): every plant that drinks this cycle (see
 * `drinks`) loses waterLossMin..waterLossMax x retainFactor. Below 0 it may
 * skip its next stage (one roll per drained cycle). At `haltWater` it dries
 * out: it no longer dies, it halts (sim/plants.ts `isDry`) until the player
 * waters it. A dry plant drinks no more, so crossing the threshold happens -
 * and is reported - exactly once per drying out.
 *
 * RNG: per drinking plant, in plot order, one `intInclusive` for the loss,
 * then one `chance` only if its water is now below 0.
 */
function phaseWater(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { config } = ctx;
  const rng = ctx.state.rng;
  for (const p of plot.plants) {
    if (!drinks(p, ctx, scratch)) continue;
    const loss = intInclusive(rng, config.waterLossMin, config.waterLossMax) * retainFactor(effectiveList(p.held));
    p.water -= loss;
    if (p.water < 0 && chance(rng, config.negativeWaterSkipChance)) p.skipNextGrowth = true;
    if (!isDry(p, config)) continue;
    ctx.emit(plot.id, { kind: "driedOut", plantId: p.id, kindId: p.kindId, row: p.row, col: p.col });
    bump(ctx.state.summary.driedOut, p.kindId);
  }
}

/**
 * Decay (0.27.2 minimum mutations, sim/decay.ts). Timers run in seconds of
 * simulated time, so they stay right when the cycle length changes.
 *
 * Every kind's pool is snapshotted ONCE at the start of the phase, so every
 * pooled plant of a kind whose timer runs out this tick is judged against
 * the same count - they decay together. When a timer runs out:
 * - minimum met (`minimumMet`): it decays. A dead_plant (layout-placed or
 *   left behind) leaves nothing - the cell goes empty and the player re-places
 *   the layout's from stock. Anything else becomes a Dead Plant; a primed
 *   Blastberry explodes.
 * - not met: the timer is extended by `decayExtensionHours` until it is
 *   positive again (`decayExtended`, `summary.extended`). If the minimum is
 *   met during an extension, it decays when that extension runs out.
 * Dead Plants are not skipped. No RNG is drawn.
 */
function phaseDecay(plot: PlotState, ctx: CycleCtx): void {
  const { config } = ctx;
  const { data } = ctx.env;
  const pools = poolSnapshot(plot);
  const extension = config.decayExtensionHours * 3600;
  for (const p of [...plot.plants]) {
    if (!plot.plants.includes(p) || p.decaySecondsRemaining === null) continue;
    p.decaySecondsRemaining -= ctx.cycleSeconds;
    if (p.decaySecondsRemaining > 1e-6) continue;
    const combined = pools.get(p.kindId) ?? null;
    if (!minimumMet(p, combined)) {
      // A non-positive extension would loop forever: the timer then just stays run out and is re-checked every tick.
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
      // A decayed dead plant leaves nothing behind (and so leaves its pool).
      removePlant(plot, p);
      continue;
    }
    const primed = isPrimedBlastberry(p);
    const { id, row, col } = p;
    convertToDeadPlant(ctx.state, data, config, p);
    if (primed) explode(plot, { id, row, col }, ctx); // a decaying Blastberry breaks
  }
}

/** Slot anchor keys the current step watches: its `watch` list, or every target when it has none. */
function watchedKeys(plot: PlotState, step: FlowStep): Set<string> {
  const all = plot.slots.map((s) => cellKey(s.row, s.col));
  if (!step.watch) return new Set(all);
  const wanted = new Set(step.watch);
  return new Set(all.filter((k) => wanted.has(k)));
}

/**
 * What a watched slot holds when something is standing on its anchor: its
 * target (growing, or `halted` while that target is dried out), or something
 * else in the way (`blocked`, a dry rival included).
 */
function occupiedStatus(q: PlantState, slot: SlotLabel, config: CycleCtx["config"]): WatchStatus {
  if (q.kindId !== slot.mutationId || q.isDeadPlant) return "blocked";
  return isDry(q, config) ? "halted" : "growing";
}

/** Book one watched cell-cycle into the per-spot record and the run totals. */
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
  // A streak only continues over consecutive cycles (a looping flow revisits the step later).
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
function phaseSpawn(plot: PlotState, ctx: CycleCtx, scratch: TickScratch): void {
  const { config } = ctx;
  const { data } = ctx.env;
  const effects = scratch.effects ?? recomputeEffects(plot, config);
  const occ = buildOccupancy(plot);
  const candidates = candidateMutations(new Set(plot.plants.map((p) => p.kindId)), data);

  const slotAt = new Map<number, SlotLabel>();
  for (const s of plot.slots) slotAt.set(cellIndex(s.row, s.col), s);
  const locations =
    config.spawnCells === "slotsOnly"
      ? [...slotAt.keys()].sort((a, b) => a - b)
      : Array.from({ length: TOTAL_CELLS }, (_, i) => i);

  const step = ctx.stepFor(plot.id);
  const watched = watchedKeys(plot, step);
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
      if (watch) recordWatch(plot, ctx, step.id, slot!, occupiedStatus(standing, slot!, config));
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
        ring = ringCounts(occ, row, col, m.size, config);
        ringBySize.set(m.size, ring);
      }
      const special = m.special === "all_positive_crop_effects" ? effects.isSpecialEligible(m.id, [row, col], m.size) : undefined;
      const w = effectiveWeight(m, ring, config, special);
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
        recordWatch(plot, ctx, step.id, slot, status);
      }
    }

    const winner = rollPool(applyMutationChanceBonus(pool, ctx.stats.mutationChanceBonus), ctx.state.rng, config.blankFillTo);
    if (!winner) continue;

    const plant = newPlant(ctx.state, data, config, winner, row, col, "spawned", ctx.cycle, ctx.cycleSeconds);
    plant.isRival = !!slot && winner !== slot.mutationId;
    insertPlant(plot, plant);
    for (const c of footprint(row, col, plant.size)) occ[c] = plant;
    // Minimum mutations: the neighbours it needed have helped create it (sim/decay.ts).
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

  // Refresh held effects for the plot as the spawn roll left it. Always, not
  // only when something spawned: the player session reads `held` for the one
  // harvest that has no latched set (an All-in Aloe taken before its harvest
  // stage), and it must see the same plot every tick. No RNG is drawn.
  // A mutation with no growth stages is fully grown as it spawns, so it
  // latches here against that refreshed set rather than at the next growth phase.
  scratch.effects = recomputeEffects(plot, config);
  for (const p of grownOnSpawn) latchIfReady(p, plot, ctx);
}

