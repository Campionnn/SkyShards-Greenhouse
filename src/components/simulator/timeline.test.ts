import { describe, expect, it } from "vitest";
import { entrySeconds, formatDays, formatShare, shareOfRun, timelineEntryAt, timelineGeometry, timelineStats, type TimelineEntry } from "./timeline";

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
    expect(timelineStats(history, 30).get("a")).toMatchObject({ visits: 2, skipped: 0, cycles: 20 });
    expect(timelineStats(history, 30).get("b")).toMatchObject({ visits: 0, skipped: 1, cycles: 0 });
    expect(timelineStats(history, 30).get("c")).toMatchObject({ visits: 1, skipped: 0, cycles: 10 });
  });

  it("measures real time from recorded seconds, estimating older entries at the average cycle", () => {
    const timed: TimelineEntry[] = [
      { stepId: "a", stepIndex: 0, startCycle: 0, endCycle: 10, startSeconds: 0, endSeconds: 86400 },
      { stepId: "b", stepIndex: 1, startCycle: 10, endCycle: null, startSeconds: 86400, endSeconds: null },
    ];
    // Cycle lengths vary: 1 day for the first 10 cycles, 3 days for the next 10.
    expect(entrySeconds(timed[0], 20, 4 * 86400)).toBe(86400);
    expect(entrySeconds(timed[1], 20, 4 * 86400)).toBe(3 * 86400);
    const stats = timelineStats(timed, 20, 4 * 86400);
    expect(stats.get("a")?.seconds).toBe(86400);
    expect(shareOfRun(stats.get("b")!.seconds, 4 * 86400)).toBe(75);
    // Old entries without seconds: 30 cycles over 3 days = 0.1 day each.
    expect(entrySeconds(history[0], 30, 3 * 86400)).toBeCloseTo(86400);
    expect(entrySeconds(history[3], 30, 3 * 86400)).toBeCloseTo(86400);
    expect(timelineStats(history, 30, 3 * 86400).get("b")?.seconds).toBe(0);
    expect(entrySeconds(history[0], 0, 0)).toBe(0);
    expect(shareOfRun(10, 0)).toBe(0);
  });

  it("formats shares and day counts compactly", () => {
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(0.05)).toBe("<0.1%");
    expect(formatShare(4)).toBe("4%");
    expect(formatShare(4.26)).toBe("4.3%");
    expect(formatShare(42.6)).toBe("43%");
    expect(formatDays(0)).toBe("0d");
    expect(formatDays(100)).toBe("<0.01d");
    expect(formatDays(43200)).toBe("0.50d");
    expect(formatDays(3.25 * 86400)).toBe("3.3d");
    expect(formatDays(250 * 86400)).toBe("250d");
  });

  it("distinguishes repeated self exits at the same cycle", () => {
    const repeats: TimelineEntry[] = [
      { ...history[0], endCycle: 0 },
      { ...history[0], endCycle: 0 },
      { ...history[0], endCycle: null },
    ];
    expect(timelineEntryAt(repeats, 0)).toBe(2);
    expect(timelineStats(repeats, 1).get("a")).toMatchObject({ visits: 3, skipped: 0, cycles: 1 });
  });
});
