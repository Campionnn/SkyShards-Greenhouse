import type { ActivitySchedule } from "../sim/state";
import { hourOfDay } from "./clock";

// When is the player online? Every player action - harvesting, watering,
// upkeep, re-placing, waking Snoozling, vacuuming rats, step changes - only
// happens on active cycles. A cycle "fires" at `firesAt` seconds of simulated
// time (the end of its growth stage).

const LOOKAHEAD_LIMIT = 10_000;

function inWindow(hour: number, from: number, to: number): boolean {
  if (from === to) return true; // a zero-length window reads as "all day"
  return from < to ? hour >= from && hour < to : hour >= from || hour < to; // wraps past midnight
}

export function isActive(schedule: ActivitySchedule, cycle: number, firesAt: number, startTimeOfDay: number): boolean {
  if (schedule.kind === "everyN") {
    const n = Math.max(1, Math.floor(schedule.n));
    return (((cycle - schedule.offset) % n) + n) % n === 0;
  }
  if (schedule.windows.length === 0) return false;
  const hour = hourOfDay(startTimeOfDay, firesAt);
  return schedule.windows.some((w) => inWindow(hour, w.from, w.to));
}

/**
 * Cycles from `cycle` until the next active cycle (>= 1), estimating future
 * fire times with the current cycle length. Infinity if none within the
 * lookahead - the player never returns.
 */
export function cyclesUntilNextActive(
  schedule: ActivitySchedule,
  cycle: number,
  firesAt: number,
  cycleSeconds: number,
  startTimeOfDay: number
): number {
  if (schedule.kind === "everyN") {
    const n = Math.max(1, Math.floor(schedule.n));
    for (let j = 1; j <= n; j++) if (isActive(schedule, cycle + j, 0, startTimeOfDay)) return j;
    return Infinity;
  }
  for (let j = 1; j <= LOOKAHEAD_LIMIT; j++) {
    if (isActive(schedule, cycle + j, firesAt + j * cycleSeconds, startTimeOfDay)) return j;
  }
  return Infinity;
}
