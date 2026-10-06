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

export function timelineStats(history: TimelineEntry[], cycle: number) {
  const stats = new Map<string, { visits: number; skipped: number; cycles: number }>();
  for (const entry of history) {
    const value = stats.get(entry.stepId) ?? { visits: 0, skipped: 0, cycles: 0 };
    if (entry.skipped) value.skipped++;
    else {
      value.visits++;
      value.cycles += Math.max(0, (entry.endCycle ?? cycle) - entry.startCycle);
    }
    stats.set(entry.stepId, value);
  }
  return stats;
}
