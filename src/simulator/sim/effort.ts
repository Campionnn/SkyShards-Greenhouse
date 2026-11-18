import { EFFORT_WEIGHTS, MINIGAME_HARVEST_KINDS, STEP_CHANGE_EFFORT_SCALE } from "../config";
import type { CycleCtx, TickScratch } from "./context";
import type { EffortKind, EffortSummary, SimulationState } from "./state";

/**
 * Effort: a weighted count of the player's actions (`EFFORT_WEIGHTS`), meant as the work a player
 * has to do to run the flow. Every action is counted where it happens (harvest.ts, placement.ts,
 * player.ts, runner.ts, script/runtime.ts), so script-driven actions count too. run.ts closes
 * each online session: `sessions += 1` and the session's weighted effort becomes `peak` if it is
 * the largest so far. Plain data, no RNG; never changes what the simulation does.
 *
 * Three rules keep it from counting work a player wouldn't do (per plot and per session, kept
 * in the cycle's `TickScratch` / `CycleCtx`, never in state):
 * - watering a plot counts once, however many times it is watered (`effortWater`); a Noctilume
 *   time change counts once per session for every plot together (one day/night cycle);
 * - a plant the player put down this session and breaks again in the same session (a base crop
 *   replanted, then broken by the step change) counts for neither (`effortPut` / `effortBreak`);
 * - everything a step change does (its harvests, breaks, placements) is one rebuild in one go and
 *   counts at `STEP_CHANGE_EFFORT_SCALE` of its weight (`duringStepChange`); the step change
 *   itself adds nothing on top.
 */

/** The weight scale for actions being counted now (lowered inside `duringStepChange`). */
let scale = 1;

/** Run `fn` with every action it counts weighted at `STEP_CHANGE_EFFORT_SCALE`. */
export function duringStepChange<T>(fn: () => T): T {
  const before = scale;
  scale = STEP_CHANGE_EFFORT_SCALE;
  try {
    return fn();
  } finally {
    scale = before;
  }
}

export function zeroEffort(): EffortSummary {
  return { sessions: 0, total: 0, peak: 0, counts: {}, weighted: {} };
}

/** The state's effort summary, created on first use for states saved before it existed. */
export function effortOf(state: SimulationState): EffortSummary {
  return (state.summary.effort ??= zeroEffort());
}

function add(e: EffortSummary, kind: EffortKind, n: number, w: number): void {
  const counts = e.counts[kind] = (e.counts[kind] ?? 0) + n;
  if (counts === 0) delete e.counts[kind];
  if (w === 0) return;
  const weighted = (e.weighted ??= {});
  if ((weighted[kind] = (weighted[kind] ?? 0) + w) === 0) delete weighted[kind];
  e.total += w;
}

/** Count `n` actions of a kind; returns the weight each was counted at. */
export function effort(state: SimulationState, kind: EffortKind, n = 1): number {
  const each = EFFORT_WEIGHTS[kind] * scale;
  if (n <= 0) return each;
  add(effortOf(state), kind, n, n * each);
  return each;
}

/** Take back one action counted earlier this session at weight `w` (a later action undid it). */
function uncount(state: SimulationState, kind: EffortKind, w: number): void {
  const e = effortOf(state);
  if ((e.counts[kind] ?? 0) <= 0) return;
  add(e, kind, -1, -w);
}

/** A harvest is a `minigame` action for the minigame kinds, else `harvest`. */
export function effortHarvest(state: SimulationState, kindId: string): void {
  effort(state, MINIGAME_HARVEST_KINDS.includes(kindId) ? "minigame" : "harvest");
}

/** The player watered (part of) a plot. Counts once per plot per session (`scratch.effortWatered`). */
export function effortWater(state: SimulationState, scratch: TickScratch): void {
  if (scratch.effortWatered) return;
  scratch.effortWatered = true;
  effort(state, "water");
}

/** The player set the time for a Noctilume. Counts once per session for all plots (`ctx.effortNoctilume`). */
export function effortNoctilume(ctx: CycleCtx): void {
  if (ctx.effortNoctilume) return;
  ctx.effortNoctilume = true;
  effort(ctx.state, "noctilume");
}

/**
 * The player put a plant down (`replant`, `place`, or `replace` for a swap before decay). It is
 * remembered for the rest of the session, so breaking it again before logging off undoes the count.
 */
export function effortPut(state: SimulationState, scratch: TickScratch, plantId: number, kind: EffortKind): void {
  const w = effort(state, kind);
  (scratch.effortPlaced ??= new Map()).set(plantId, { kind, w });
}

/**
 * The player breaks a plant without harvesting it (`remove`: one click). When they put it down
 * earlier this session, neither counts: they would just not have put it there. A swap before
 * decay still leaves the old item's removal.
 */
export function effortBreak(state: SimulationState, scratch: TickScratch, plantId: number): void {
  const put = scratch.effortPlaced?.get(plantId);
  if (put === undefined) {
    effort(state, "remove");
    return;
  }
  scratch.effortPlaced!.delete(plantId);
  uncount(state, put.kind, put.w);
  if (put.kind === "replace") effort(state, "remove");
}

/** End of an online session: count it and keep the largest session's effort as `peak`. */
export function closeSession(state: SimulationState, totalBefore: number): void {
  const e = effortOf(state);
  e.sessions += 1;
  e.peak = Math.max(e.peak, e.total - totalBefore);
}

/** Weighted effort per session so far (0 before the first session). */
export function effortPerSession(e: EffortSummary | undefined): number {
  if (!e || e.sessions === 0) return 0;
  return e.total / e.sessions;
}
