import { describe, expect, it } from "vitest";
import type { FlowDetail } from "../leaderboard/api";
import { normalizeDetail } from "./flowsService";

describe("normalizeDetail", () => {
  it("accepts flat seed rows (API shape) and nested ones, dropping failed runs", () => {
    const d = normalizeDetail({
      cells: [{ board: "ironman", tier: "max", every: 1, median: { produced: { wheat: 1 } } }, { board: "ironman", tier: "max", every: 2 }],
      seeds: [
        { board: "ironman", tier: "max", every: 1, seedIndex: 0, ok: true, produced: { wheat: 5 }, consumed: {}, effort: { avg: 1, peak: 2 } },
        { board: "ironman", tier: "max", every: 1, seedIndex: 1, result: { produced: { wheat: 6 } } },
        { board: "ironman", tier: "max", every: 1, seedIndex: 2, ok: false, error: "boom", produced: null },
      ],
    } as unknown as FlowDetail);
    expect(d.cells).toHaveLength(1);
    expect(d.seeds!.map((s) => s.result.produced.wheat)).toEqual([5, 6]);
    expect(d.seeds![0].result.bought).toEqual({});
    expect(d.seeds![0].result.effort.peak).toBe(2);
  });
});
