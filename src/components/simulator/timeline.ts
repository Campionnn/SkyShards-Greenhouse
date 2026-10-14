import type { FlowRunnerState } from "../../simulator";

export type TimelineEntry = FlowRunnerState["history"][number];

/** Most recent built step at a boundary; skipped steps never occupy time. */
export function timelineEntryAt(history: TimelineEntry[], atCycle: number): number | null {
  let low = 0;
  let high = history.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (history[mid].startCycle <= atCycle) low = mid + 1;
    else high = mid;
  }
  for (let i = low - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.skipped) continue;
    return entry.endCycle === null || atCycle <= entry.endCycle ? i : null;
  }
  return null;
}

/** Clip geometry to the visible clock; do not inflate short visits over neighbours. */
export function timelineGeometry(entry: TimelineEntry, cycle: number, fromCycle: number) {
  const end = entry.endCycle ?? cycle;
  if (entry.skipped || end < fromCycle || entry.startCycle > cycle || (fromCycle > 0 && entry.endCycle !== null && end === fromCycle)) return null;
  const span = Math.max(1, cycle - fromCycle);
  const start = Math.max(fromCycle, entry.startCycle);
  return {
    left: ((start - fromCycle) / span) * 100,
    width: (Math.max(0, Math.min(cycle, end) - start) / span) * 100,
  };
}

/**
 * Simulated seconds a visit lasted. `elapsedSeconds` is the run clock at `cycle` (closes the open
 * visit). Entries from older states have no seconds: they are estimated at the run's average
 * cycle length.
 */
export function entrySeconds(entry: TimelineEntry, cycle: number, elapsedSeconds: number): number {
  const perCycle = cycle > 0 ? elapsedSeconds / cycle : 0;
  const start = entry.startSeconds ?? entry.startCycle * perCycle;
  const end = entry.endCycle === null ? elapsedSeconds : entry.endSeconds ?? entry.endCycle * perCycle;
  return Math.max(0, end - start);
}

/** Share of the whole run, 0..100 (0 before any time has passed). */
export function shareOfRun(seconds: number, elapsedSeconds: number): number {
  return elapsedSeconds > 0 ? Math.min(100, (seconds / elapsedSeconds) * 100) : 0;
}

/** "12%", "0.4%", "<0.1%", "0%". */
export function formatShare(percent: number): string {
  if (percent <= 0) return "0%";
  if (percent < 0.1) return "<0.1%";
  if (percent < 10) return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(percent)}%`;
}

/** Simulated seconds as a day count: "12.4d", "0.35d", "<0.01d". */
export function formatDays(seconds: number): string {
  const days = seconds / 86400;
  if (days <= 0) return "0d";
  if (days < 0.01) return "<0.01d";
  if (days < 1) return `${days.toFixed(2)}d`;
  if (days < 100) return `${days.toFixed(1)}d`;
  return `${Math.round(days).toLocaleString()}d`;
}

export type StepStats = { visits: number; skipped: number; cycles: number; seconds: number };

export function timelineStats(history: TimelineEntry[], cycle: number, elapsedSeconds = 0) {
  const stats = new Map<string, StepStats>();
  for (const entry of history) {
    const value = stats.get(entry.stepId) ?? { visits: 0, skipped: 0, cycles: 0, seconds: 0 };
    if (entry.skipped) value.skipped++;
    else {
      value.visits++;
      value.cycles += Math.max(0, (entry.endCycle ?? cycle) - entry.startCycle);
      value.seconds += entrySeconds(entry, cycle, elapsedSeconds);
    }
    stats.set(entry.stepId, value);
  }
  return stats;
}
