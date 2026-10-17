import { EFFORT_WEIGHTS, MINIGAME_HARVEST_KINDS } from "../config";
import type { EffortKind, EffortSummary, SimulationState } from "./state";

/**
 * Effort: a weighted count of the player's actions (`EFFORT_WEIGHTS`). Every action is counted
 * where it happens (harvest.ts, placement.ts, player.ts, runner.ts, inventory.ts, market.ts), so
 * script-driven actions count too. run.ts closes each online session: `sessions += 1` and the
 * session's weighted effort becomes `peak` if it is the largest so far. Plain data, no RNG.
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

/** A harvest is a `minigame` action for the minigame kinds, else `harvest`. */
export function effortHarvest(state: SimulationState, kindId: string): void {
  effort(state, MINIGAME_HARVEST_KINDS.includes(kindId) ? "minigame" : "harvest");
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
