import { describe, expect, it } from "vitest";
import type { FlowDetail, FlowStatusResponse } from "../leaderboard/api";
import { mockDetail, mockList, mockStatus } from "./flowsMock";
import { normalizeDetail, normalizeListEntries, normalizeResult, normalizeStatus } from "./flowsService";

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

  it("old cells: the pre-v2 'ironman' board is from nothing, payback fields are dropped, every flow is on both boards", () => {
    const d = normalizeDetail({
      boards: ["ironman"],
      cells: [
        { board: "ironman", tier: "max", every: 1, median: { produced: { wheat: 1 }, peakDebt: { chloronite: 3 }, paybackCycle: null, solvent: false } },
        { board: "normal", tier: "max", every: 1, median: { produced: { wheat: 2 } } },
        { board: "mystery", tier: "max", every: 1, median: { produced: { wheat: 3 } } },
      ],
      seeds: [{ board: "ironman", tier: "max", every: 1, seedIndex: 0, produced: { wheat: 1 }, solvent: true }],
    } as unknown as FlowDetail);
    expect(d.boards).toEqual(["ironman", "normal"]);
    expect(d.cells.map((c) => [c.cellKind, c.runKind, c.board])).toEqual([
      ["ironman", "ironman", "ironman"],
      ["normal", "normal", "normal"],
    ]);
    const median = d.cells[0].median as unknown as Record<string, unknown>;
    expect("peakDebt" in median || "paybackCycle" in median || "solvent" in median).toBe(false);
    expect(d.seeds![0]).toMatchObject({ cellKind: "ironman", runKind: "ironman", board: "ironman" });
    expect("solvent" in d.seeds![0].result).toBe(false);
  });

  it("v2 cells: strict is from nothing, borrow with the starting items; every v2 field kept, malformed ones dropped", () => {
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
        // A cell whose run kind and board disagree: the run kind wins.
        { runKind: "strict", board: "normal", tier: "max", every: 2, median: { produced: {}, cantStart: { plot: 1, cells: 65, items: ["puffercloud", "zombud", 7] } } },
        { runKind: "strict", board: "ironman_strict", tier: "max", every: 3, median: { produced: {}, cantStart: { plot: "1", cells: 65, items: [] } } },
      ],
    } as unknown as FlowDetail);
    expect(d.cells.map((c) => c.cellKind)).toEqual(["ironman_kit", "ironman", "ironman"]);
    expect(d.cells[1].median.cantStart).toEqual({ plot: 1, cells: 65, items: ["puffercloud", "zombud"] });
    expect(d.cells[2].median.cantStart).toBeUndefined();
    const m = d.cells[0].median;
    expect(m.startItems).toEqual({ zombud: 41720.3 });
    expect(m.sessionOnly).toEqual(["blastberry"]);
    expect(m.upkeep).toEqual({ zombud: 91.3 });
    expect(m.starved).toEqual([{ plot: 1, step: "s", item: "zombud", cells: 2.2 }]);
    expect(m.ramp).toEqual({ complete: 220, produced: { wheat: 2 }, bought: {} });
    expect(m.slowing).toBe(true);
    expect(m.window).toEqual({ from: 5000, to: 6250, cuts: 51 });
    expect(d.cells[1].board).toBe("ironman");
    expect(normalizeResult({ produced: {}, ramp: { complete: "soon" } })!.ramp!.complete).toBeNull();
    expect(normalizeResult({ produced: null })).toBeNull();
  });

  it("v3 cells: the cell kind wins; prep is kept when well formed (kit whole units)", () => {
    const prep = { kit: { zombud: 2, cindershade: 3 }, cycles: 75, days: 5.47, madeDays: 4.3, done: true, mode: "stitched" };
    const d = normalizeDetail({
      cells: [
        { cellKind: "ironman", runKind: "ironman", board: "ironman", tier: "max", every: 1, median: { produced: { wheat: 1 }, prep } },
        { cellKind: "ironman_kit", runKind: "ironman", board: "ironman", tier: "max", every: 1, median: { produced: { wheat: 2 }, prep: { kit: "x" } } },
      ],
      seeds: [{ cellKind: "ironman_kit", runKind: "ironman", board: "ironman", tier: "max", every: 1, seedIndex: 0, ok: true, result: { produced: { wheat: 2 } } }],
    } as unknown as FlowDetail);
    expect(d.cells.map((c) => c.cellKind)).toEqual(["ironman", "ironman_kit"]);
    expect(d.cells[0].median.prep).toEqual(prep);
    expect(d.cells[1].median.prep).toBeUndefined();
    expect(d.seeds![0].cellKind).toBe("ironman_kit");
  });

  it("status jobs: v3 run kinds; v2's strict / borrow jobs and the pre-v2 'ironman' board are ironman", () => {
    const s = normalizeStatus({
      status: "pending",
      rejectReason: null,
      jobs: [
        { runKind: "ironman", board: "ironman", tier: "max", priority: "A", status: "running", error: null },
        { runKind: "borrow", board: "ironman_borrow", tier: "max", priority: "A", status: "queued", error: null },
        { board: "ironman", tier: "max", priority: "A", status: "done", error: null },
        { runKind: "normal", board: "normal", tier: "max", priority: "A", status: "done", error: null },
      ],
    } as unknown as FlowStatusResponse);
    expect(s.jobs.map((j) => [j.runKind, j.board])).toEqual([
      ["ironman", "ironman"],
      ["ironman", "ironman"],
      ["ironman", "ironman"],
      ["normal", "normal"],
    ]);
  });

  it("list rows: altPoint, borrowPoint and prep are checked", () => {
    const rows = normalizeListEntries([
      { id: "a", cell: { produced: { wheat: 1 } }, altPoint: { produced: { wheat: 2 }, bought: {}, consumed: {} }, prep: { kit: { zombud: 2 }, cycles: 50, days: 3.6, done: true, mode: "real" } },
      { id: "b", cell: null, altPoint: "x", borrowPoint: 3, prep: { kit: {} } },
      "junk",
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].altPoint).toMatchObject({ produced: { wheat: 2 } });
    expect(rows[0].prep).toEqual({ kit: { zombud: 2 }, cycles: 50, days: 3.6, done: true, mode: "real" });
    expect(rows[1]).toMatchObject({ altPoint: null, borrowPoint: null, prep: null, cell: null });
  });
});

describe("the mock matches the API's shapes", () => {
  it("list rows: board / kit / cellKind echoed; ironman rows carry altPoint and prep (borrowPoint on kit=0); both ironman cells carry the starting items", async () => {
    const fromNothing = await mockList("ironman", "max", 1);
    expect(fromNothing).toMatchObject({ board: "ironman", kit: false, cellKind: "ironman", runKind: "ironman" });
    expect(fromNothing.entries.every((e) => e.cellKind === "ironman" && e.altPoint && typeof e.altPoint.produced === "object" && e.borrowPoint === e.altPoint)).toBe(true);
    expect(fromNothing.entries.every((e) => e.prep && typeof e.prep.done === "boolean")).toBe(true);
    const kit = await mockList("ironman", "max", 1, undefined, true);
    expect(kit).toMatchObject({ board: "ironman", kit: true, cellKind: "ironman_kit" });
    expect(kit.entries.every((e) => e.borrowPoint === undefined && e.altPoint)).toBe(true);
    // v2's board names are aliases.
    expect(await mockList("ironman_borrow", "max", 1)).toMatchObject({ board: "ironman", kit: true, cellKind: "ironman_kit" });
    expect(await mockList("ironman_strict", "max", 1, undefined, true)).toMatchObject({ board: "ironman", kit: false, cellKind: "ironman" });
    const normal = await mockList("normal", "max", 1, undefined, true);
    expect(normal).toMatchObject({ board: "normal", kit: false, cellKind: "normal" });
    expect(normal.entries.every((e) => e.altPoint === undefined && e.prep === undefined)).toBe(true);
    const devourer = kit.entries.find((e) => e.id === "mockDevr0007")!;
    expect(devourer.cell!.upkeep).toEqual({ zombud: 92.4, puffercloud: 90.2 });
    expect(devourer.cell!.startItems).toEqual({ zombud: 164.2, puffercloud: 115.6 });
    expect(devourer.cell!.usedUp).toEqual({ zombud: 97.3, puffercloud: 10.4 });
    const devFromNothing = fromNothing.entries.find((e) => e.id === "mockDevr0007")!;
    expect(devFromNothing.cell!.upkeep).toEqual(devourer.cell!.upkeep);
    expect(devFromNothing.prep).toMatchObject({ kit: { zombud: 165, puffercloud: 116 }, done: true, mode: "real" });
    expect(devFromNothing.cell!.prep).toEqual(devFromNothing.prep);
    // The Godseed flow's starting items can't be made within the run.
    expect(fromNothing.entries.filter((e) => e.prep && !e.prep.done).map((e) => e.id)).toEqual(["mockGods0009"]);
    expect(fromNothing.entries.find((e) => e.id === "mockNoct0006")!.prep).toEqual({ kit: {}, cycles: 0, days: 0, done: true, mode: "stitched" });
    expect(fromNothing.entries.some((e) => e.cell?.bySource?.chorus_fruit)).toBe(true);
    expect(normal.entries.every((e) => e.cell?.startItems === undefined)).toBe(true);
  });

  it("detail: cells and seeds carry cellKind + runKind + board for all three cell kinds; status jobs too", async () => {
    const d = (await mockDetail("mockChorus09"))!;
    expect(new Set(d.cells.map((c) => `${c.cellKind}:${c.runKind}:${c.board}`))).toEqual(new Set(["ironman:ironman:ironman", "ironman_kit:ironman:ironman", "normal:normal:normal"]));
    expect(d.seeds!.every((s) => s.cellKind && s.runKind && s.board)).toBe(true);
    expect(d.boards).toEqual(["ironman", "normal"]);
    // Seed results are not slowing-flagged (cells only), and the normalised detail keeps them.
    expect(normalizeDetail(d).cells).toHaveLength(d.cells.length);
    const st = await mockStatus();
    expect(st.jobs.map((j) => j.runKind)).toEqual(["ironman", "normal"]);
  });
});
