import { describe, expect, it } from "vitest";
import { defaultGameData } from "../simulator/data/default";
import { DEFAULT_BAZAAR_PRICING } from "../simulator/economy/bazaar";
import type { FlowCell, FlowListEntry } from "./api";
import { valueResult } from "./pricing";
import type { RunResult } from "./result";
import { YIELD_STATS } from "./tiers";
import {
  avatarUrl,
  debtLines,
  earningTargets,
  paybackText,
  splitSolvent,
  filterRows,
  moneyBySource,
  findCell,
  flowRow,
  itemBreakdown,
  maxProfit,
  NEW_FOR_MS,
  sortRows,
  profitByEvery,
  rank,
  rankEntries,
  slackFrom,
  spreadAt,
  suppliesText,
  toMillis,
  type ViewSettings,
} from "./view";

const data = defaultGameData();
const NOW = Date.UTC(2026, 4, 20);

const result = (produced: Record<string, number>, extra: Partial<RunResult> = {}): RunResult => ({
  cycles: 2000,
  days: 140,
  produced,
  consumed: {},
  bought: {},
  built: {},
  shortfall: {},
  uptime: 0.95,
  sustainable: true,
  effort: { sessions: 2000, avg: 45, peak: 290, byKind: { harvest: 20 } },
  halted: false,
  ...extra,
});

const entry = (id: string, title: string, cell: RunResult | null, extra: Partial<FlowListEntry> = {}): FlowListEntry => ({
  id,
  title,
  author: { id: "80351110224678912", name: `Author ${id}`, avatar: null },
  plots: 3,
  cycles: 2000,
  createdAt: new Date(NOW - 30 * 86400_000).toISOString(),
  updatedAt: new Date(NOW - 30 * 86400_000).toISOString(),
  stale: false,
  estimated: false,
  cell,
  spread: null,
  effort: cell?.effort ?? null,
  ...extra,
});

const ironman: ViewSettings = { board: "ironman", quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false, now: NOW };

describe("leaderboard view: ranking", () => {
  it("sorts by profit per day, puts unverified entries last and ranks ties together", () => {
    const rows = rankEntries(
      data,
      [
        entry("a", "Small", result({ wheat: 1000 })),
        entry("b", "Pending", null),
        entry("c", "Big", result({ wheat: 100000 })),
        entry("d", "Big twin", result({ wheat: 100000 })),
      ],
      ironman
    );
    expect(rows.map((r) => r.entry.id)).toEqual(["c", "d", "a", "b"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(rows[3].profitPerDay).toBeNull();
    expect(rows[0].profitPerDay).toBeCloseTo(valueResult(data, result({ wheat: 100000 }), "ironman").profitPerDay);
  });

  it("rank gives standard competition ranks", () => {
    expect(rank([{ profitPerDay: 5 }, { profitPerDay: 5 }, { profitPerDay: 4 }, { profitPerDay: null }, { profitPerDay: null }]).map((r) => r.rank)).toEqual([1, 1, 3, 4, 4]);
  });

  it("normal board subtracts purchases and reports the build cost separately", () => {
    const quotes = { dead_plant: { lowestSellOffer: 1000, highestBuyOrder: 900 }, wheat: { lowestSellOffer: 10, highestBuyOrder: 8 } };
    const r = result({ wheat: 1000 }, { bought: { dead_plant: 10 }, built: { dead_plant: 5 } });
    const row = flowRow(data, entry("a", "A", r), { ...ironman, board: "normal", quotes });
    const v = valueResult(data, r, "normal", quotes, DEFAULT_BAZAAR_PRICING);
    expect(row.profitPerDay).toBeCloseTo(v.profitPerDay);
    expect(row.boughtPerDay).toBeGreaterThan(0);
    expect(row.buildCost).toBeGreaterThan(0);
    expect(row.profitPerDay!).toBeCloseTo(row.revenuePerDay! - row.boughtPerDay!);
  });

  it("filters by title or author, keeping the ranks", () => {
    const rows = rankEntries(data, [entry("a", "Chloronite engine", result({ wheat: 10 })), entry("b", "Aloe", result({ wheat: 20 }))], ironman);
    const hit = filterRows(rows, "chloro");
    expect(hit.map((r) => r.entry.id)).toEqual(["a"]);
    expect(hit[0].rank).toBe(2);
    expect(filterRows(rows, "author b").map((r) => r.entry.id)).toEqual(["b"]);
    expect(filterRows(rows, "  ")).toHaveLength(2);
  });
});

describe("leaderboard view: badges and labels", () => {
  it("new (< 7 days), stale and the API's estimated flag", () => {
    const fresh = flowRow(data, entry("a", "A", result({}), { createdAt: new Date(NOW - NEW_FOR_MS + 60_000).toISOString(), stale: true }), ironman);
    expect(fresh.badges).toEqual({ new: true, stale: true, estimated: false });
    const old = flowRow(data, entry("b", "B", result({}), { createdAt: Math.floor((NOW - NEW_FOR_MS - 1000) / 1000), estimated: true }), ironman);
    expect(old.badges).toEqual({ new: false, stale: false, estimated: true });
  });

  it("scales to the viewer's yield stats only when asked and when they differ", () => {
    const cell = result({ wheat: 1000, chloronite: 5 });
    const viewerStats = { ...YIELD_STATS, farmingFortune: 1500 };
    const off = flowRow(data, entry("a", "A", cell), { ...ironman, viewerStats, useMyStats: false });
    const on = flowRow(data, entry("a", "A", cell), { ...ironman, viewerStats, useMyStats: true });
    const same = flowRow(data, entry("a", "A", cell), { ...ironman, viewerStats: { ...YIELD_STATS }, useMyStats: true });
    expect(off.scaled).toBe(false);
    expect(on.scaled).toBe(true);
    expect(same.scaled).toBe(false);
    expect(on.profitPerDay!).toBeLessThan(off.profitPerDay!);
  });

  it("ironman supplies text from consumed dead plants and fermento", () => {
    const row = flowRow(data, entry("a", "A", result({}, { consumed: { dead_plant: 12.4, fermento: 3, chloronite: 9 } })), ironman);
    expect(row.suppliesPerDay).toEqual({ dead_plant: 12.4, fermento: 3 });
    expect(suppliesText(row.suppliesPerDay)).toBe("12 dead plants, 3 fermento");
    expect(suppliesText({ dead_plant: 1 })).toBe("1 dead plant");
    expect(suppliesText({ fermento: 0.25 })).toBe("0.3 fermento");
    expect(suppliesText({})).toBe("none");
  });

  it("slack comes from the API when present, else from the row's frequency curve", () => {
    expect(flowRow(data, entry("a", "A", result({})), ironman).slack).toBeNull();
    expect(flowRow(data, entry("a", "A", result({}), { slack: 0.9 }), ironman).slack).toBe(0.9);
    const curve = Object.fromEntries([1, 2, 3, 4, 6, 8, 12].map((n) => [String(n), { produced: { wheat: 1000 * (13 - n) }, bought: {}, consumed: {} }]));
    const row = flowRow(data, entry("a", "A", result({ wheat: 12000 }), { curve }), ironman, 1);
    expect(row.curve.map((p) => p.every)).toEqual([1, 2, 3, 4, 6, 8, 12]);
    expect(row.curve[0].profitPerDay).toBeGreaterThan(row.curve[6].profitPerDay!);
    expect(row.slack).toBeCloseTo(11 / 12, 5); // only j = 2 lies in (1, 2]
  });

  it("splits revenue by category and counts mutations per day", () => {
    const row = flowRow(data, entry("a", "A", result({ wheat: 1000, chloronite: 4, cropie: 2 })), ironman);
    expect(row.split!.crops).toBe(1000 * data.crops.wheat.sellPrice);
    expect(row.split!.mutations).toBe(0); // ironman: mutation items have no NPC price
    expect(row.split!.rare).toBeGreaterThan(0);
    expect(row.mutationsPerDay).toBe(4);
    expect(row.perEffort).toBeCloseTo(row.profitPerDay! / 45);
  });

  it("money by source and the earning targets order", () => {
    const bySource = { chloronite: { wheat: 100, chloronite: 3 }, wheat: { wheat: 1000 }, coalroot: { wheat: 10 } };
    const lines = moneyBySource(data, bySource, "ironman", {}, DEFAULT_BAZAAR_PRICING);
    expect(lines.map((l) => l.kind)).toEqual(["wheat", "chloronite", "coalroot"]);
    expect(lines[1].isMutation).toBe(true);
    // Targets ordered by earnings; one that earned nothing keeps its place after them.
    const order = earningTargets(data, ["scourroot", "coalroot", "chloronite"], bySource, "ironman", {}, DEFAULT_BAZAAR_PRICING);
    expect(order.map((t) => t.id)).toEqual(["chloronite", "coalroot", "scourroot"]);
    expect(order[2].coinsPerDay).toBeNull();
    // Without bySource: the summary order.
    expect(earningTargets(data, ["b_none", "a_none"], undefined, "ironman", {}, DEFAULT_BAZAAR_PRICING).map((t) => t.id)).toEqual(["b_none", "a_none"]);
  });

  it("sortRows reorders without changing ranks; missing values sort last", () => {
    const rows = rankEntries(
      data,
      [
        entry("a", "Rich busy", result({ wheat: 9000 }, { effort: { sessions: 1, avg: 300, peak: 900, byKind: {} } })),
        entry("b", "Poor lazy", result({ wheat: 1000 }, { effort: { sessions: 1, avg: 5, peak: 10, byKind: {} } }), { createdAt: new Date(NOW).toISOString() }),
        entry("c", "Unverified", null),
      ],
      ironman
    );
    expect(rows.map((r) => r.entry.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "effort").map((r) => r.entry.id)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "perEffort").map((r) => r.entry.id)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "newest")[0].entry.id).toBe("b");
    expect(sortRows(rows, "effort").find((r) => r.entry.id === "a")!.rank).toBe(1);
    expect(maxProfit(rows)).toBe(rows[0].profitPerDay);
  });

  it("avatar URLs and timestamps", () => {
    expect(avatarUrl("123", "abc")).toBe("https://cdn.discordapp.com/avatars/123/abc.png?size=64");
    expect(avatarUrl("80351110224678912", null)).toBe(`https://cdn.discordapp.com/embed/avatars/${(80351110224678912n >> 22n) % 6n}.png`);
    expect(avatarUrl("not-a-number", null)).toBe("https://cdn.discordapp.com/embed/avatars/0.png");
    expect(toMillis(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMillis("2026-01-01T00:00:00Z")).toBe(Date.UTC(2026, 0, 1));
  });
});

describe("leaderboard view: detail page", () => {
  const cells: FlowCell[] = [1, 2, 3, 4, 6, 8, 12].map((every) => ({
    board: "ironman",
    tier: "max",
    every,
    median: result({ wheat: 100000 * (1 - 0.05 * (every - 1)) }),
    spread: { [String(every)]: 1.2 },
    seeds: 5,
    engineVersion: "x",
  }));

  it("profit by frequency and slack from it", () => {
    const points = profitByEvery(data, cells, "ironman", "max", { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(points.map((p) => p.every)).toEqual([1, 2, 3, 4, 6, 8, 12]);
    expect(points[0].profitPerDay!).toBeGreaterThan(points[6].profitPerDay!);
    const s = slackFrom(points, 1)!;
    expect(s).toBeCloseTo(0.95, 5); // only j = 2 in (1, 2]
    expect(slackFrom(points, 12)).toBeNull();
    expect(profitByEvery(data, cells, "ironman", "high", { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false }).every((p) => p.profitPerDay === null)).toBe(true);
  });

  it("insolvent cells: out of the ranking and the curve, worth 0 to Forgiving; debt texts", () => {
    const broke = result({ wheat: 999999 }, { solvent: false, paybackCycle: null, peakDebt: { chloronite: 3, cropie: 1 } });
    const { solvent, insolvent } = splitSolvent([entry("a", "A", result({ wheat: 10 })), entry("b", "B", broke), entry("c", "C", null)]);
    expect(solvent.map((e) => e.id)).toEqual(["a", "c"]);
    expect(insolvent.map((e) => e.id)).toEqual(["b"]);
    const mixed = cells.map((c) => (c.every === 2 ? { ...c, median: broke } : c));
    const points = profitByEvery(data, mixed, "ironman", "max", { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(points[1]).toEqual({ every: 2, profitPerDay: null, insolvent: true });
    expect(slackFrom(points, 1)).toBe(0);
    const row = flowRow(data, entry("a", "A", result({ wheat: 10 }), { curve: { "1": { produced: { wheat: 10 }, bought: {}, consumed: {} }, "2": { produced: { wheat: 10 }, bought: {}, consumed: {}, solvent: false } } }), ironman);
    expect(row.curve[1]).toMatchObject({ every: 2, profitPerDay: null, insolvent: true });
    expect(paybackText(broke)).toBe("Never paid back");
    expect(paybackText({ paybackCycle: 420, peakDebt: { chloronite: 2 } })).toBe("Paid back by cycle 420");
    expect(paybackText({ paybackCycle: 0, peakDebt: {} })).toBeNull();
    expect(paybackText({})).toBeNull();
    expect(debtLines(broke)).toEqual([{ item: "chloronite", units: 3 }, { item: "cropie", units: 1 }]);
  });

  it("finds cells and reads spread maps or numbers", () => {
    expect(findCell(cells, "ironman", "max", 3)?.every).toBe(3);
    expect(findCell(cells, "normal", "max", 3)).toBeUndefined();
    expect(spreadAt({ "3": 1.5 }, 3)).toBe(1.5);
    expect(spreadAt({ "3": 1.5 }, 4)).toBeNull();
    expect(spreadAt(1.7, 4)).toBe(1.7);
    expect(spreadAt(null, 1)).toBeNull();
    // The API's per-cell shape (leaderboard/stats.py spread): {ratio, ...}; null = unbounded.
    expect(spreadAt({ seeds: 5, values: [], best: 2, median: 1, worst: 1, ratio: 1.3 }, 1)).toBe(1.3);
    expect(spreadAt({ seeds: 5, values: [], best: 2, median: 0, worst: 0, ratio: null }, 1)).toBe(Infinity);
  });

  it("item breakdown sorts by coins per day, purchases negative", () => {
    const quotes = { dead_plant: { lowestSellOffer: 1000, highestBuyOrder: 900 } };
    const lines = itemBreakdown(data, result({ wheat: 1000, chloronite: 4 }, { bought: { dead_plant: 2 } }), "normal", quotes, DEFAULT_BAZAAR_PRICING);
    expect(lines[0].item).toBe("wheat");
    const bought = lines.find((l) => l.kind === "bought")!;
    expect(bought.coinsPerDay).toBeLessThan(0);
    expect(lines[lines.length - 1]).toBe(bought);
    const iron = itemBreakdown(data, result({ wheat: 1000, chloronite: 4 }), "ironman", {}, DEFAULT_BAZAAR_PRICING);
    expect(iron.find((l) => l.item === "chloronite")!.unitPrice).toBe(0);
  });
});
