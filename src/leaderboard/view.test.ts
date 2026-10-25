import { describe, expect, it } from "vitest";
import { defaultViewerStats, readViewerStats, yieldOf } from "../hooks/useFlowViewer";
import { defaultGameData } from "../simulator/data/default";
import { DEFAULT_BAZAAR_PRICING } from "../simulator/economy/bazaar";
import type { FlowCell, FlowListEntry } from "./api";
import { valueResult } from "./pricing";
import type { RunResult } from "./result";
import { YIELD_STATS } from "./tiers";
import {
  avatarUrl,
  boardNumbers,
  boardOf,
  boardsText,
  DEFAULT_FILTERS,
  earningItems,
  earningOptions,
  earningTargets,
  filterRows,
  kitGain,
  kitText,
  localKindSummary,
  matchesFilters,
  needLines,
  ownsStartItems,
  payloadStepNamer,
  rampDays,
  rampText,
  readListParams,
  scenarioRunKind,
  searchText,
  stallInfo,
  starvedText,
  startItemsText,
  startItemsTotal,
  upkeepText,
  usedUpLines,
  writeListParams,
  type RowFilters,
  moneyBySource,
  findCell,
  flowRow,
  itemBreakdown,
  maxProfit,
  NEW_FOR_MS,
  sortRows,
  withLikeCounts,
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

const ironman: ViewSettings = { board: "ironman_strict", quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false, now: NOW };

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
    expect(rows[0].profitPerDay).toBeCloseTo(valueResult(data, result({ wheat: 100000 }), "ironman_strict").profitPerDay);
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

  it("per-crop fortune and tools scale the row, its money by source and mark it scaled", () => {
    const cell = result({ wheat: 1000, carrot: 500, chloronite: 5 }, { bySource: { wheat: { wheat: 1000 }, carrot: { carrot: 500 }, chloronite: { chloronite: 5 } } });
    const base = flowRow(data, entry("a", "A", cell), { ...ironman, viewerStats: { ...YIELD_STATS }, useMyStats: true });
    const bonus = flowRow(data, entry("a", "A", cell), { ...ironman, viewerStats: { ...YIELD_STATS, cropFortune: { wheat: 200 } }, useMyStats: true });
    const tool = flowRow(data, entry("a", "A", cell), { ...ironman, viewerStats: { ...YIELD_STATS, tools: [{ name: "Carrot Hoe", fortune: { carrot: 300 } }] }, useMyStats: true });
    expect(base.scaled).toBe(false);
    expect(bonus.scaled).toBe(true);
    expect(tool.scaled).toBe(true);
    const ff = YIELD_STATS.farmingFortune;
    const wheatGain = 1000 * data.crops.wheat.sellPrice * ((1 + (ff + 200) / 100) / (1 + ff / 100) - 1);
    expect(bonus.profitPerDay! - base.profitPerDay!).toBeCloseTo(wheatGain, 3);
    expect(tool.profitPerDay!).toBeGreaterThan(base.profitPerDay!);
    expect(bonus.mutationsPerDay).toBe(5);
  });

  it("readViewerStats keeps valid crop fortune and tools and drops the rest", () => {
    const s = readViewerStats({ cropFortune: { wheat: 50, nope: 3, carrot: "x", melon: 0, cactus: 12 }, tools: [{ name: " Hoe ", fortune: { wheat: 100, bad: 1 } }, { fortune: {} }, "x"] });
    expect(s.cropFortune).toEqual({ wheat: 50, cactus: 12 });
    expect(s.tools).toEqual([{ name: "Hoe", fortune: { wheat: 100 } }]);
    const old = readViewerStats({ farmingFortune: 1200 });
    expect(old.cropFortune).toEqual({});
    expect(old.tools).toEqual([]);
    // No per-crop terms: the server's yield shape, so nothing is marked scaled.
    expect(yieldOf(defaultViewerStats())).toEqual(YIELD_STATS);
    expect(yieldOf(s).cropFortune).toEqual({ wheat: 50, cactus: 12 });
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
    const lines = moneyBySource(data, bySource, "ironman_strict", {}, DEFAULT_BAZAAR_PRICING);
    expect(lines.map((l) => l.kind)).toEqual(["wheat", "chloronite", "coalroot"]);
    expect(lines[1].isMutation).toBe(true);
    // Targets ordered by earnings; one that earned nothing keeps its place after them.
    const order = earningTargets(data, ["scourroot", "coalroot", "chloronite"], bySource, "ironman_strict", {}, DEFAULT_BAZAAR_PRICING);
    expect(order.map((t) => t.id)).toEqual(["chloronite", "coalroot", "scourroot"]);
    expect(order[2].coinsPerDay).toBeNull();
    // Without bySource: the summary order.
    expect(earningTargets(data, ["b_none", "a_none"], undefined, "ironman_strict", {}, DEFAULT_BAZAAR_PRICING).map((t) => t.id)).toEqual(["b_none", "a_none"]);
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

  it("sorts by likes (all time and 30 days); local counts override the list", () => {
    const listed = [
      entry("a", "Old favourite", result({ wheat: 9000 }), { likes: 10, likes30d: 1 }),
      entry("b", "Trending", result({ wheat: 1000 }), { likes: 4, likes30d: 4 }),
      entry("c", "No likes field", result({ wheat: 500 })),
    ];
    const rows = rankEntries(data, listed, ironman);
    expect(sortRows(rows, "liked").map((r) => r.entry.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "liked30d").map((r) => r.entry.id)).toEqual(["b", "a", "c"]);
    const bumped = rankEntries(data, withLikeCounts(listed, { c: { likes: 20, likes30d: 20 } }), ironman);
    expect(sortRows(bumped, "liked30d")[0].entry.id).toBe("c");
    expect(sortRows(bumped, "liked30d").find((r) => r.entry.id === "a")!.rank).toBe(1);
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
    board: "ironman_strict",
    tier: "max",
    every,
    median: result({ wheat: 100000 * (1 - 0.05 * (every - 1)) }),
    spread: { [String(every)]: 1.2 },
    seeds: 5,
    engineVersion: "x",
  }));

  it("profit by frequency and slack from it", () => {
    const points = profitByEvery(data, cells, "ironman_strict", "max", { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(points.map((p) => p.every)).toEqual([1, 2, 3, 4, 6, 8, 12]);
    expect(points[0].profitPerDay!).toBeGreaterThan(points[6].profitPerDay!);
    const s = slackFrom(points, 1)!;
    expect(s).toBeCloseTo(0.95, 5); // only j = 2 in (1, 2]
    expect(slackFrom(points, 12)).toBeNull();
    expect(profitByEvery(data, cells, "ironman_strict", "high", { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false }).every((p) => p.profitPerDay === null)).toBe(true);
  });

  it("old cells' payback fields are ignored: every cell is ranked and counts for Forgiving", () => {
    const old = { ...result({ wheat: 50000 }), solvent: false, paybackCycle: null, peakDebt: { chloronite: 3 } } as RunResult;
    const mixed = cells.map((c) => (c.every === 2 ? { ...c, median: old } : c));
    const points = profitByEvery(data, mixed, "ironman_strict", "max", { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(points[1].profitPerDay).toBeGreaterThan(0);
    expect(slackFrom(points, 1)).toBeGreaterThan(0);
  });

  it("finds cells by run kind, falling back to an old cell's board name", () => {
    expect(findCell(cells, "ironman_strict", "max", 3)?.every).toBe(3);
    expect(findCell(cells, "normal", "max", 3)).toBeUndefined();
    const v2: FlowCell[] = [
      { ...cells[0], runKind: "borrow", board: "ironman_borrow", median: result({ wheat: 2 }) },
      { ...cells[0], runKind: "strict", board: "ironman_strict", median: result({ wheat: 1 }) },
    ];
    expect(findCell(v2, "ironman_borrow", "max", 1)?.median.produced.wheat).toBe(2);
    expect(findCell(v2, "ironman_strict", "max", 1)?.median.produced.wheat).toBe(1);
    // An old cell (no runKind) with the pre-v2 board name "ironman" is the strict board's.
    const legacy = [{ ...cells[0], board: "ironman" } as unknown as FlowCell];
    expect(findCell(legacy, "ironman_strict", "max", 1)).toBeDefined();
    expect(findCell(legacy, "ironman_borrow", "max", 1)).toBeUndefined();
  });

  it("spread maps or numbers", () => {
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
    const iron = itemBreakdown(data, result({ wheat: 1000, chloronite: 4 }), "ironman_strict", {}, DEFAULT_BAZAAR_PRICING);
    expect(iron.find((l) => l.item === "chloronite")!.unitPrice).toBe(0);
  });

  it("the three board numbers: each board's cell, the max tier standing in, null where none", () => {
    const v2: FlowCell[] = [
      { ...cells[0], runKind: "strict", board: "ironman_strict", median: result({ wheat: 1000 }) },
      { ...cells[0], runKind: "borrow", board: "ironman_borrow", median: result({ wheat: 3000 }, { slowing: true }) },
    ];
    const n = boardNumbers(data, v2, "high", 1, { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(n.map((x) => x.board)).toEqual(["ironman_strict", "ironman_borrow", "normal"]);
    expect(n[0].profitPerDay).toBeCloseTo(1000 * data.crops.wheat.sellPrice);
    expect(n[1].profitPerDay).toBeCloseTo(3000 * data.crops.wheat.sellPrice);
    expect(n[1].slowing).toBe(true);
    expect(n[2].profitPerDay).toBeNull();
  });
});

describe("leaderboard v2: boards, starting items, upkeep, stalls, ramp", () => {
  it("board names: run kinds win, old 'ironman' is from nothing; admin board lists", () => {
    expect(boardOf({ runKind: "borrow", board: "ironman_borrow" })).toBe("ironman_borrow");
    expect(boardOf({ board: "ironman" })).toBe("ironman_strict");
    expect(boardOf({ board: "nope" })).toBeNull();
    expect(boardsText(["all"])).toBe("All boards");
    expect(boardsText(["ironman", "normal"])).toBe("Ironman + Normal");
    expect(boardsText([])).toBe("—");
    expect(scenarioRunKind({ profile: "normal", config: {} })).toBe("normal");
    expect(scenarioRunKind({ config: { allowMutationDebt: true } })).toBe("borrow");
    expect(scenarioRunKind({ config: {} })).toBe("strict");
  });

  it("upkeep and starting items texts round counts up", () => {
    expect(upkeepText(undefined)).toBe("None");
    expect(upkeepText({})).toBe("None");
    expect(upkeepText({ zombud: 91.3, puffercloud: 90.5 })).toBe("92 Zombud + 91 Puffercloud /day");
    expect(upkeepText({ magic_jellybean: 0.08, cindershade: 0.04 })).toBe("0.08 Magic Jellybean + 0.04 Cindershade /day");
    expect(upkeepText({ a: 4, b: 3, c: 2, d: 1 })).toMatch(/\+ 1 more \/day$/);
    expect(startItemsText({ duskbloom: 40.2, shadevine: 7, dustgrain: 6 })).toBe("54 items: 41 Duskbloom, 7 Shadevine, 6 Dustgrain");
    expect(startItemsText({ blastberry: 1 })).toBe("1 item: 1 Blastberry");
    expect(startItemsText({})).toBe("None");
    expect(startItemsTotal({ a: 0.2, b: 2, c: -3, d: Number.NaN })).toBe(3);
    expect(startItemsTotal(undefined)).toBe(0);
  });

  it("What you need: rounded up, +25% to bring, session-only items tagged; used up once", () => {
    const lines = needLines({ startItems: { magic_jellybean: 140.2, blastberry: 1 }, sessionOnly: ["blastberry"] });
    expect(lines).toEqual([
      { item: "magic_jellybean", needs: 141, bring: 177, sessionOnly: false },
      { item: "blastberry", needs: 1, bring: 2, sessionOnly: true },
    ]);
    expect(needLines({})).toEqual([]);
    expect(usedUpLines({ witherbloom: 25.4 })).toEqual([{ item: "witherbloom", units: 26 }]);
  });

  it("Kit: +N% at 5% or more, 'Kit needed' when from nothing makes nothing, never Infinity or NaN", () => {
    expect(kitGain(100, 104)).toBeNull();
    const g = kitGain(100, 134)!;
    expect(g.kind).toBe("gain");
    expect(kitText(g).label).toBe("Kit +34%");
    expect(kitText(g).title).toContain("34% more");
    const need = kitGain(0, 88_800_000)!;
    expect(need.kind).toBe("needed");
    expect(kitText(need).label).toBe("Kit needed");
    expect(kitText(need).title).toBe('Makes nothing from scratch; with the starting items: 88.8M/day (see the "with starting items" board).');
    expect(kitGain(-5, 10)!.kind).toBe("needed");
    expect(kitGain(0, 0)).toBeNull();
    expect(kitGain(null, 10)).toBeNull();
    expect(kitGain(10, Number.NaN)).toBeNull();
    for (const k of [kitGain(1e-300, 1e300), kitGain(1, 1e308)]) if (k) expect(kitText(k).label).not.toMatch(/Infinity|NaN/);
  });

  it("Stall: a plot's starved cells summed, ≥ 5 on one plot; the top entry named", () => {
    expect(stallInfo(undefined)).toBeNull();
    expect(stallInfo([{ plot: 1, step: "a", item: "cindershade", cells: 0.9 }, { plot: 2, step: "a", item: "cindershade", cells: 0.9 }])).toBeNull();
    const s = stallInfo([
      { plot: 2, step: "s", item: "zombud", cells: 3 },
      { plot: 1, step: "s-aloe", item: "magic_jellybean", cells: 34.2 },
      { plot: 2, step: "t", item: "zombud", cells: 2.5 },
      { plot: 3, step: "x", item: "bad" },
    ])!;
    expect(s.plot).toBe(1);
    expect(s.top.item).toBe("magic_jellybean");
    expect(stallInfo([{ plot: 2, step: "s", item: "zombud", cells: 3 }, { plot: 2, step: "t", item: "zombud", cells: 2.5 }])!.cells).toBe(5.5);
    const named = payloadStepNamer([{ id: 1, flow: { steps: [{ id: "s-aloe", label: "All-in Aloe" }, { id: "s-bean" }] } }]);
    expect(starvedText(s.top, named)).toBe("Plot 1, step 1 (All-in Aloe): 34 Magic Jellybean cells empty on average");
    expect(starvedText({ plot: 1, step: "s-bean", item: "zombud", cells: 1 }, named)).toBe("Plot 1, step 2: 1 Zombud cell empty on average");
    expect(starvedText({ plot: 3, step: "step-1", item: "cindershade", cells: 0.9 })).toBe("Plot 3, step-1: 0.9 Cindershade cells empty on average");
  });

  it("ramp: days from cycles, never complete, from the start, missing", () => {
    const r = { cycles: 6250, days: 455.7, ramp: { complete: 220, produced: {}, bought: {} } };
    expect(rampDays(r)).toBeCloseTo((220 * 455.7) / 6250);
    expect(rampText(r, 12_300_000)).toBe("Layout complete after ~16 days · then 12.3M/day");
    expect(rampText({ ...r, ramp: { complete: null, produced: {}, bought: {} } }, 1_000_000)).toBe("Layout never complete (some cells stay empty) · then 1.0M/day");
    expect(rampText({ ...r, ramp: { complete: 0, produced: {}, bought: {} } }, null)).toBe("Layout complete from the start");
    expect(rampText({ ...r, ramp: { complete: 5, produced: {}, bought: {} } }, null)).toBe("Layout complete after under a day");
    expect(rampText({ cycles: 1, days: 1 }, 5)).toBeNull();
  });

  const v2entry = (id: string, cell: RunResult | null, extra: Partial<FlowListEntry> = {}) => entry(id, `Flow ${id}`, cell, extra);
  const chorus = result({ chorus_fruit: 48, potato: 50000 }, { bySource: { chorus_fruit: { chorus_fruit: 48, potato: 30000 }, chloronite: { potato: 20000 }, wheat: { wheat: 10 } } });

  it("earning items by coins on the board; the options are every bySource key", () => {
    const items = earningItems(data, chorus.bySource, "ironman_strict", {}, DEFAULT_BAZAAR_PRICING);
    expect(items.map((i) => i.id)).toEqual(["chorus_fruit", "chloronite", "wheat"]);
    expect(items.every((i) => i.coinsPerDay > 0)).toBe(true);
    const rows = rankEntries(data, [v2entry("a", chorus), v2entry("b", result({ wheat: 5 }, { bySource: { devourer: { pumpkin: 1 } } })), v2entry("c", null)], ironman);
    expect(earningOptions(rows)).toEqual(["chloronite", "chorus_fruit", "devourer", "wheat"]);
  });

  it("the row: kit from borrowPoint on 'from nothing', stall, slowing, upkeep, start items, steady rate, search text", () => {
    const strict = result({ wheat: 1000 }, { starved: [{ plot: 1, step: "a", item: "magic_jellybean", cells: 34 }], slowing: true, ramp: { complete: null, produced: { wheat: 2000 }, bought: {} } });
    const borrowPoint = { produced: { wheat: 2000 }, bought: {}, consumed: {} };
    const row = flowRow(data, v2entry("a", strict, { borrowPoint, excerpt: "Uses Blastberries", summary: { plots: [], targets: ["all_in_aloe"], inputs: ["magic_jellybean"], steps: 1, scripted: false } }), ironman);
    expect(row.kit).toMatchObject({ kind: "gain" });
    expect(row.stall?.plot).toBe(1);
    expect(row.slowing).toBe(true);
    expect(row.steadyPerDay).toBeCloseTo(2000 * data.crops.wheat.sellPrice);
    expect(row.search).toContain("magic jellybean");
    expect(row.search).toContain("all-in aloe");
    expect(row.search).toContain("blastberries");
    // Only the "from nothing" board prices the borrow point.
    expect(flowRow(data, v2entry("a", strict, { borrowPoint }), { ...ironman, board: "ironman_borrow" }).kit).toBeNull();
    // Kit needed: a strict cell of 0 with a borrow cell.
    expect(flowRow(data, v2entry("z", result({}, { slowing: true }), { borrowPoint }), ironman).kit?.kind).toBe("needed");
    const borrow = flowRow(data, v2entry("b", result({ wheat: 1 }, { upkeep: { zombud: 91.3, puffercloud: 90.5 }, startItems: { zombud: 41720.3, puffercloud: 41377.6 } })), { ...ironman, board: "ironman_borrow" });
    expect(borrow.upkeepPerDay).toBeCloseTo(181.8);
    expect(borrow.startItemsCount).toBe(41721 + 41378);
    // Old cells: none of the v2 fields.
    const old = flowRow(data, v2entry("o", result({ wheat: 1 })), ironman);
    expect([old.kit, old.stall, old.slowing, old.upkeepPerDay, old.startItemsCount, old.steadyPerDay]).toEqual([null, null, false, 0, 0, null]);
    expect(searchText(v2entry("s", null))).toContain("flow s");
  });

  it("matchesFilters: earning in top 3 or anywhere, upkeep, starting items, owned, search", () => {
    const rows = rankEntries(
      data,
      [
        v2entry("chorus", chorus),
        v2entry("devourer", result({ pumpkin: 70000, chorus_fruit: 1 }, { bySource: { devourer: { pumpkin: 70000 }, wheat: { wheat: 100 }, cactus: { cactus: 100 }, chorus_fruit: { potato: 1 } }, upkeep: { zombud: 91 }, startItems: { zombud: 40000 } })),
        v2entry("aloe", result({ wheat: 9 }, { bySource: { all_in_aloe: { wheat: 9 } }, upkeep: {}, startItems: { magic_jellybean: 141, blastberry: 1 } })),
        v2entry("pending", null),
      ],
      ironman
    );
    const by = (f: Partial<RowFilters>, board: Parameters<typeof matchesFilters>[2] = "ironman_borrow", owned: Record<string, number> | null = null) =>
      rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, ...f }, board, owned)).map((r) => r.entry.id);
    expect(by({})).toHaveLength(4);
    // A filter that needs a cell drops the unverified row.
    expect(by({ earning: ["wheat"], earningIn: "any" })).not.toContain("pending");
    expect(by({ earning: ["chorus_fruit"] })).toEqual(["chorus"]);
    expect(by({ earning: ["chorus_fruit"], earningIn: "any" }).sort()).toEqual(["chorus", "devourer"]);
    expect(by({ noUpkeep: true }).sort()).toEqual(["aloe", "chorus"]);
    expect(by({ noUpkeep: true }, "ironman_strict")).toHaveLength(4);
    expect(by({ maxStartItems: 0 })).toEqual(["chorus"]);
    expect(by({ maxStartItems: 200 }).sort()).toEqual(["aloe", "chorus"]);
    expect(by({ owned: true }, "ironman_borrow", { magic_jellybean: 141, blastberry: 1 }).sort()).toEqual(["aloe", "chorus"]);
    expect(by({ owned: true }, "ironman_borrow", { magic_jellybean: 140, blastberry: 1 })).toEqual(["chorus"]);
    // Without imported items the "I own" filter is off.
    expect(by({ owned: true }, "ironman_borrow", null)).toHaveLength(4);
    expect(by({ query: "AUTHOR ALOE" })).toEqual(["aloe"]);
    expect(by({ query: "chorus fruit" }).sort()).toEqual(["chorus", "devourer"]);
    expect(ownsStartItems({ a: 1.2 }, { a: 2 })).toBe(true);
    expect(ownsStartItems({ a: 1.2 }, { a: 1 })).toBe(false);
  });

  it("'Chorus Fruit' shows the chorus flows ordered by coins per day", () => {
    const flows = [10, 30, 20].map((n, i) => v2entry(`c${i}`, result({ chorus_fruit: n, potato: n * 1000 }, { bySource: { chorus_fruit: { potato: n * 1000 } } })));
    const rows = rankEntries(data, [...flows, v2entry("x", result({ wheat: 1e6 }, { bySource: { wheat: { wheat: 1e6 } } }))], ironman);
    const hit = sortRows(rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, earning: ["chorus_fruit"] }, "ironman_strict")), "profit");
    expect(hit.map((r) => r.entry.id)).toEqual(["c1", "c2", "c0"]);
  });

  it("sorts: steady rate (most first) and least upkeep (ties by profit, missing = 0)", () => {
    const rows = rankEntries(
      data,
      [
        v2entry("a", result({ wheat: 3000 }, { upkeep: { zombud: 9 }, ramp: { complete: 0, produced: { wheat: 100 }, bought: {} } })),
        v2entry("b", result({ wheat: 2000 }, { ramp: { complete: 0, produced: { wheat: 9000 }, bought: {} } })),
        v2entry("c", result({ wheat: 1000 }, { upkeep: {} })),
        v2entry("d", null),
      ],
      { ...ironman, board: "ironman_borrow" }
    );
    expect(sortRows(rows, "steady").map((r) => r.entry.id)).toEqual(["b", "a", "c", "d"]);
    expect(sortRows(rows, "upkeep").map((r) => r.entry.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("URL params round-trip; the old board name and junk are handled", () => {
    const p = readListParams(new URLSearchParams("board=ironman&sort=upkeep&plots=2&q=aloe&earning=chorus_fruit&earning=devourer&in=any&noUpkeep=1&maxStart=60&own=1"));
    expect(p).toEqual({ board: "ironman_strict", sort: "upkeep", plots: "2", filters: { query: "aloe", earning: ["chorus_fruit", "devourer"], earningIn: "any", noUpkeep: true, maxStartItems: 60, owned: true } });
    expect(readListParams(writeListParams(p))).toEqual(p);
    expect(writeListParams({ board: null, sort: "profit", plots: "any", filters: DEFAULT_FILTERS }).toString()).toBe("");
    const junk = readListParams(new URLSearchParams("board=x&sort=nope&plots=9&maxStart=-1&earning=<b>&in=sometimes"));
    expect(junk).toEqual({ board: null, sort: "profit", plots: "any", filters: DEFAULT_FILTERS });
  });

  it("the local test summary: the median seed by the board's value, the spread, failures", () => {
    const seeds = [result({ wheat: 3000 }), result({ wheat: 1000 }), result({ wheat: 2000 })].map((r) => ({ ok: true, error: null, result: r }));
    const s = localKindSummary(data, seeds, "ironman_strict", {}, DEFAULT_BAZAAR_PRICING);
    expect(s.done).toBe(3);
    expect(s.profitPerDay).toBeCloseTo(2000 * data.crops.wheat.sellPrice);
    expect(s.ratio).toBeCloseTo(1.5);
    const failed = localKindSummary(data, [seeds[0], { ok: false, error: "script error: boom", result: null }, undefined], "ironman_borrow", {}, DEFAULT_BAZAAR_PRICING);
    expect(failed).toMatchObject({ done: 2, total: 3, cell: null, profitPerDay: null, ratio: null, failed: [{ seed: 2, error: "script error: boom" }] });
  });
});
