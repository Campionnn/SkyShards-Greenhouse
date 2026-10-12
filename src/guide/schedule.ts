/**
 * Translating "how often do you play?" into the scenario's schedule.
 *
 * The Guide asks in hours because that is how a player thinks about it; the simulator takes an
 * `everyN` cycle gap. One growth cycle is `CYCLE_BASELINE_SECONDS` (4 hours) before the player's
 * speed bonuses, which is the honest conversion to show and use.
 */
import { CYCLE_BASELINE_SECONDS } from "../simulator/config";
import type { Scenario } from "../simulator/sim/state";

/** Hours per growth cycle before any speed bonus. */
export const HOURS_PER_CYCLE = CYCLE_BASELINE_SECONDS / 3600;

/** "Every 12 hours" -> the scenario's `everyN` cycle count, never below one cycle. */
export function hoursToCycles(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 1;
  return Math.max(1, Math.round(hours / HOURS_PER_CYCLE));
}

/** The `everyN` a schedule uses, or null for a time-of-day schedule. */
export function cyclesFromSchedule(activity: Scenario["settings"]["activity"]): number | null {
  return activity.kind === "everyN" ? activity.n : null;
}

/** The hours a schedule corresponds to, for showing the player their own answer back. */
export function scheduleHours(activity: Scenario["settings"]["activity"], fallback = 8): number {
  const cycles = cyclesFromSchedule(activity);
  return cycles === null ? fallback : cycles * HOURS_PER_CYCLE;
}
