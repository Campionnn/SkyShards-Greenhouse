import { describe, expect, it } from "vitest";
import type { FlowDetail, FlowStatusResponse } from "../leaderboard/api";
import { mockDetail, mockList, mockStatus } from "./flowsMock";
import { normalizeDetail, normalizeResult, normalizeStatus } from "./flowsService";

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

  it("old cells: the pre-v2 'ironman' board is from nothing, payback fields are dropped, every flow is on all boards", () => {
    const d = normalizeDetail({
      boards: ["ironman"],
      cells: [
        { board: "ironman", tier: "max", every: 1, median: { produced: { wheat: 1 }, peakDebt: { chloronite: 3 }, paybackCycle: null, solvent: false } },
        { board: "normal", tier: "max", every: 1, median: { produced: { wheat: 2 } } },
        { board: "mystery", tier: "max", every: 1, median: { produced: { wheat: 3 } } },
      ],
      seeds: [{ board: "ironman", tier: "max", every: 1, seedIndex: 0, produced: { wheat: 1 }, solvent: true }],
    } as unknown as FlowDetail);
    expect(d.boards).toEqual(["ironman_strict", "ironman_borrow", "normal"]);
    expect(d.cells.map((c) => [c.runKind, c.board])).toEqual([
      ["strict", "ironman_strict"],
      ["normal", "normal"],
    ]);
    const median = d.cells[0].median as unknown as Record<string, unknown>;
    expect("peakDebt" in median || "paybackCycle" in median || "solvent" in median).toBe(false);
    expect(d.seeds![0]).toMatchObject({ runKind: "strict", board: "ironman_strict" });
    expect("solvent" in d.seeds![0].result).toBe(false);
  });

  it("v2 cells keep their run kind and every new field; malformed ones are dropped", () => {
    const d = normalizeDetail({
      cells: [
        {
          runKind: "borrow",
          board: "ironman_borrow",
          tier: "max",
          every: 1,
          median: {
            produced: { wheat: 1 },
            startItems: { zombud: 41720.3, bad: "x" },
            sessionOnly: ["blastberry", 3],
            usedUp: { zombud: 41720.3 },
            upkeep: { zombud: 91.3 },
            starved: [{ plot: 1, step: "s", item: "zombud", cells: 2.2 }, { plot: "1" }],
            ramp: { complete: 220, produced: { wheat: 2 }, bought: {} },
            slowing: true,
            window: { from: 5000, to: 6250, cuts: 51 },
          },
        },
        // A cell whose runKind and board disagree: the run kind wins.
        { runKind: "strict", board: "normal", tier: "max", every: 2, median: { produced: {} } },
      ],
    } as unknown as FlowDetail);
    const m = d.cells[0].median;
    expect(m.startItems).toEqual({ zombud: 41720.3 });
    expect(m.sessionOnly).toEqual(["blastberry"]);
    expect(m.upkeep).toEqual({ zombud: 91.3 });
    expect(m.starved).toEqual([{ plot: 1, step: "s", item: "zombud", cells: 2.2 }]);
    expect(m.ramp).toEqual({ complete: 220, produced: { wheat: 2 }, bought: {} });
    expect(m.slowing).toBe(true);
    expect(m.window).toEqual({ from: 5000, to: 6250, cuts: 51 });
    expect(d.cells[1].board).toBe("ironman_strict");
    expect(normalizeResult({ produced: {}, ramp: { complete: "soon" } })!.ramp!.complete).toBeNull();
    expect(normalizeResult({ produced: null })).toBeNull();
  });

  it("status jobs get their board from the run kind; old jobs from 'ironman'", () => {
    const s = normalizeStatus({
      status: "pending",
      rejectReason: null,
      jobs: [{ runKind: "borrow", board: "ironman_borrow", tier: "max", priority: "A", status: "queued", error: null }, { board: "ironman", tier: "max", priority: "A", status: "done", error: null }],
    } as unknown as FlowStatusResponse);
    expect(s.jobs.map((j) => [j.runKind, j.board])).toEqual([
      ["borrow", "ironman_borrow"],
      ["strict", "ironman_strict"],
    ]);
  });
});

describe("the mock matches the API's shapes", () => {
  it("list rows: board / runKind echoed, borrowPoint only on ironman_strict, v2 fields on the cell", async () => {
    const strict = await mockList("ironman", "max", 1);
    expect(strict).toMatchObject({ board: "ironman_strict", runKind: "strict" });
    expect(strict.entries.every((e) => e.borrowPoint && typeof e.borrowPoint.produced === "object")).toBe(true);
    const borrow = await mockList("ironman_borrow", "max", 1);
    expect(borrow.entries.every((e) => e.borrowPoint === undefined)).toBe(true);
    const devourer = borrow.entries.find((e) => e.id === "mockDevr0007")!;
    expect(devourer.cell!.upkeep).toEqual({ zombud: 91.3, puffercloud: 90.5 });
    expect(Object.keys(devourer.cell!.startItems!)).toEqual(["zombud", "puffercloud"]);
    const aloe = strict.entries.find((e) => e.id === "mockAloe0002")!;
    expect(aloe.cell!.slowing).toBe(true);
    expect(aloe.curve!["1"].slowing).toBe(true);
    expect(aloe.cell!.starved![0].cells).toBeGreaterThan(5);
    expect(strict.entries.some((e) => e.cell?.bySource?.chorus_fruit)).toBe(true);
    // Strict cells never carry the borrow-only fields.
    expect(strict.entries.every((e) => e.cell?.startItems === undefined)).toBe(true);
  });

  it("detail: cells and seeds carry runKind + board for all three run kinds; status jobs too", async () => {
    const d = (await mockDetail("mockChorus09"))!;
    expect(new Set(d.cells.map((c) => `${c.runKind}:${c.board}`))).toEqual(new Set(["strict:ironman_strict", "borrow:ironman_borrow", "normal:normal"]));
    expect(d.seeds!.every((s) => s.runKind && s.board)).toBe(true);
    // Seed results are not slowing-flagged (cells only), and the normalised detail keeps them.
    expect(normalizeDetail(d).cells).toHaveLength(d.cells.length);
    const st = await mockStatus();
    expect(st.jobs.map((j) => j.runKind)).toEqual(["strict", "borrow", "normal"]);
  });
});
