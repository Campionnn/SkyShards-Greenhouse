import { EFFORT_WEIGHTS, MINIGAME_HARVEST_KINDS } from "../config";
import type { TickScratch } from "./context";
import type { EffortKind, EffortSummary, SimulationState } from "./state";

/**
 * Effort: a weighted count of the player's actions (`EFFORT_WEIGHTS`), meant as the work a player
 * has to do to run the flow. Every action is counted where it happens (harvest.ts, placement.ts,
 * player.ts, runner.ts, script/runtime.ts), so script-driven actions count too. run.ts closes
 * each online session: `sessions += 1` and the session's weighted effort becomes `peak` if it is
 * the largest so far. Plain data, no RNG; never changes what the simulation does.
 *
 * Two rules keep it from counting work a player wouldn't do (both per plot and per session, kept
 * in the cycle's `TickScratch`, never in state):
 * - watering a plot counts once, however many times it is watered (`effortWater`);
 * - a plant the player put down this session and breaks again in the same session (a base crop
 *   replanted, then broken by the step change) counts for neither (`effortPut` / `effortBreak`).
 */

export function zeroEffort(): EffortSummary {
  return { sessions: 0, total: 0, peak: 0, counts: {} };
}

/** The state's effort summary, created on first use for states saved before it existed. */
export function effortOf(state: SimulationState): EffortSummary {
  return (state.summary.effort ??= zeroEffort());
}

/** Count `n` actions of a kind. */
export function effort(state: SimulationState, kind: EffortKind, n = 1): void {
  if (n <= 0) return;
  const e = effortOf(state);
  e.counts[kind] = (e.counts[kind] ?? 0) + n;
  e.total += n * EFFORT_WEIGHTS[kind];
}

/** Take back one action counted earlier this session (a later action undid it). */
function uncount(state: SimulationState, kind: EffortKind): void {
  const e = effortOf(state);
  const n = e.counts[kind] ?? 0;
  if (n <= 0) return;
  if (n === 1) delete e.counts[kind];
  else e.counts[kind] = n - 1;
  e.total -= EFFORT_WEIGHTS[kind];
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

/**
 * The player put a plant down (`replant`, `place`, or `replace` for a swap before decay). It is
 * remembered for the rest of the session, so breaking it again before logging off undoes the count.
 */
export function effortPut(state: SimulationState, scratch: TickScratch, plantId: number, kind: EffortKind): void {
  effort(state, kind);
  (scratch.effortPlaced ??= new Map()).set(plantId, kind);
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
  uncount(state, put);
  if (put === "replace") effort(state, "remove");
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
