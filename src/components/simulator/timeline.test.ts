import { describe, expect, it } from "vitest";
import { timelineEntryAt, timelineGeometry, timelineStats, type TimelineEntry } from "./timeline";

const history: TimelineEntry[] = [
  { stepId: "a", stepIndex: 0, startCycle: 0, endCycle: 10 },
  { stepId: "b", stepIndex: 1, startCycle: 10, endCycle: 10, skipped: true },
  { stepId: "c", stepIndex: 2, startCycle: 10, endCycle: 20 },
  { stepId: "a", stepIndex: 0, startCycle: 20, endCycle: null },
];

describe("step timeline", () => {
  it("picks the newly built visit at a shared boundary, ignoring skips", () => {
    expect(timelineEntryAt(history, 0)).toBe(0);
    expect(timelineEntryAt(history, 9.99)).toBe(0);
    expect(timelineEntryAt(history, 10)).toBe(2);
    expect(timelineEntryAt(history, 20)).toBe(3);
    expect(timelineEntryAt(history, 100)).toBe(3);
    expect(timelineEntryAt([], 0)).toBeNull();
    expect(timelineEntryAt(history, -1)).toBeNull();
  });

  it("does not hit skipped-only history or invent a visit in a gap", () => {
    expect(timelineEntryAt([history[1]], 10)).toBeNull();
    expect(timelineEntryAt([history[0]], 11)).toBeNull();
  });

  it("preserves tiny visit geometry instead of overlapping neighbours", () => {
    expect(timelineGeometry(history[0], 100000, 0)).toEqual({ left: 0, width: 0.01 });
    expect(timelineGeometry(history[1], 30, 0)).toBeNull();
  });

  it("clips visits to a recent-cycle window and keeps current zero-length entries", () => {
    expect(timelineGeometry(history[0], 30, 15)).toBeNull();
    expect(timelineGeometry(history[0], 30, 10)).toBeNull();
    expect(timelineGeometry(history[2], 30, 15)?.left).toBe(0);
    expect(timelineGeometry(history[2], 30, 15)?.width).toBeCloseTo(100 / 3);
    expect(timelineGeometry(history[3], 20, 0)).toEqual({ left: 100, width: 0 });
    expect(timelineGeometry({ ...history[3], startCycle: 0 }, 0, 0)).toEqual({ left: 0, width: 0 });
  });

  it("counts built visits and skip passes separately, with exact elapsed cycles", () => {
    expect(timelineStats(history, 30).get("a")).toEqual({ visits: 2, skipped: 0, cycles: 20 });
    expect(timelineStats(history, 30).get("b")).toEqual({ visits: 0, skipped: 1, cycles: 0 });
    expect(timelineStats(history, 30).get("c")).toEqual({ visits: 1, skipped: 0, cycles: 10 });
  });

  it("distinguishes repeated self exits at the same cycle", () => {
    const repeats: TimelineEntry[] = [
      { ...history[0], endCycle: 0 },
      { ...history[0], endCycle: 0 },
      { ...history[0], endCycle: null },
    ];
    expect(timelineEntryAt(repeats, 0)).toBe(2);
    expect(timelineStats(repeats, 1).get("a")).toEqual({ visits: 3, skipped: 0, cycles: 1 });
  });
});
