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
  builderText,
  cellKindOfRow,
  cantStartOf,
  cantStartReason,
  cantStartText,
  kitSummaryText,
  splitRanked,
  boardsText,
  DEFAULT_FILTERS,
  earningItems,
  earningOptions,
  earningTargets,
  filterRows,
  kitListText,
  localKindSummary,
  matchesFilters,
  needLines,
  payloadStepNamer,
  rampDays,
  rampText,
  prepText,
  readListParams,
  readPrep,
  scenarioRuleKind,
  profileRuleKind,
  ruleDifferenceLines,
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

const ironman: ViewSettings = { board: "ironman", quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false, now: NOW };
const withKit: ViewSettings = { ...ironman, kit: true };

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
    cellKind: "ironman" as const,
    board: "ironman" as const,
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

  it("old cells' payback fields are ignored: every cell is ranked and counts for Forgiving", () => {
    const old = { ...result({ wheat: 50000 }), solvent: false, paybackCycle: null, peakDebt: { chloronite: 3 } } as RunResult;
    const mixed = cells.map((c) => (c.every === 2 ? { ...c, median: old } : c));
    const points = profitByEvery(data, mixed, "ironman", "max", { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(points[1].profitPerDay).toBeGreaterThan(0);
    expect(slackFrom(points, 1)).toBeGreaterThan(0);
  });

  it("finds cells by cell kind, falling back to what an older API sent", () => {
    expect(findCell(cells, "ironman", "max", 3)?.every).toBe(3);
    expect(findCell(cells, "normal", "max", 3)).toBeUndefined();
    const v3: FlowCell[] = [
      { ...cells[0], cellKind: "ironman_kit", runKind: "ironman", board: "ironman", median: result({ wheat: 2 }) },
      { ...cells[0], cellKind: "ironman", runKind: "ironman", board: "ironman", median: result({ wheat: 1 }) },
    ];
    expect(findCell(v3, "ironman_kit", "max", 1)?.median.produced.wheat).toBe(2);
    expect(findCell(v3, "ironman", "max", 1)?.median.produced.wheat).toBe(1);
    // v2 cells: run kind strict is "from nothing", borrow "with the starting items".
    const v2 = [{ ...cells[0], cellKind: undefined, runKind: "borrow", board: "ironman_borrow", median: result({ wheat: 5 }) }, { ...cells[0], cellKind: undefined, runKind: "strict", board: "ironman_strict" }] as unknown as FlowCell[];
    expect(findCell(v2, "ironman_kit", "max", 1)?.median.produced.wheat).toBe(5);
    expect(findCell(v2, "ironman", "max", 1)).toBe(v2[1]);
    // A pre-v2 cell (board "ironman" only) is "from nothing".
    const legacy = [{ every: 1, tier: "max", board: "ironman", median: result({}) } as unknown as FlowCell];
    expect(findCell(legacy, "ironman", "max", 1)).toBeDefined();
    expect(findCell(legacy, "ironman_kit", "max", 1)).toBeUndefined();
    expect(cellKindOfRow({ runKind: "normal" })).toBe("normal");
    expect(cellKindOfRow({ cellKind: "ironman_kit", runKind: "ironman" })).toBe("ironman_kit");
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
    const iron = itemBreakdown(data, result({ wheat: 1000, chloronite: 4 }), "ironman", {}, DEFAULT_BAZAAR_PRICING);
    expect(iron.find((l) => l.item === "chloronite")!.unitPrice).toBe(0);
  });

  it("the three numbers: from nothing, with the starting items, normal; the max tier standing in, null where none", () => {
    const prep = { kit: { zombud: 2 }, cycles: 75, days: 5.47, madeDays: 4.3, done: true, mode: "stitched" as const };
    const v3: FlowCell[] = [
      { ...cells[0], cellKind: "ironman", median: result({ wheat: 1000 }, { prep }) },
      { ...cells[0], cellKind: "ironman_kit", median: result({ wheat: 3000 }, { slowing: true }) },
    ];
    const n = boardNumbers(data, v3, "high", 1, { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(n.map((x) => x.kind)).toEqual(["ironman", "ironman_kit", "normal"]);
    expect(n[0].prep).toEqual(prep);
    expect(n[1].prep).toBeNull();
    expect(n[0].profitPerDay).toBeCloseTo(1000 * data.crops.wheat.sellPrice);
    expect(n[1].profitPerDay).toBeCloseTo(3000 * data.crops.wheat.sellPrice);
    expect(n[1].slowing).toBe(true);
    expect(n[2].profitPerDay).toBeNull();
  });
});

describe("leaderboard v2: boards, starting items, upkeep, stalls, ramp", () => {
  it("cell kinds from any API's rows; admin board lists; the simulator's rule kind", () => {
    expect(cellKindOfRow({ runKind: "borrow", board: "ironman_borrow" })).toBe("ironman_kit");
    expect(cellKindOfRow({ board: "ironman_strict" })).toBe("ironman");
    expect(cellKindOfRow({ board: "nope" })).toBeNull();
    expect(boardsText(["all"])).toBe("All boards");
    expect(boardsText(["ironman", "normal"])).toBe("Ironman + Normal");
    expect(boardsText(["ironman_borrow"])).toBe("Ironman");
    expect(boardsText([])).toBe("—");
    expect(scenarioRuleKind({ profile: "normal", config: {} })).toBe("normal");
    expect(scenarioRuleKind({ config: { allowMutationDebt: true } })).toBe("borrow");
    expect(scenarioRuleKind({ config: {} })).toBe("strict");
    // The simulator's rules: one per site profile; the differences in a player's words.
    expect(profileRuleKind("normal")).toBe("normal");
    expect(profileRuleKind(undefined)).toBe("borrow");
    expect(
      ruleDifferenceLines(
        ["starting inventory is not empty", 'advanced setting "allowMutationDebt" differs', 'advanced setting "leaderboardRules" differs', 'advanced setting "waterLossMin" differs'],
        { waterLossMin: "Water loss min" }
      )
    ).toEqual(["starting inventory is not empty", 'the advanced setting "Water loss min" is changed', "the leaderboard's own set-up isn't on"]);
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

  it("the starting-items line: items largest first, made in ~N days; none; can't be made; the builder line", () => {
    const maga = { kit: { duskbloom: 41, zombud: 2, cindershade: 3, shadevine: 7, dustgrain: 6 }, cycles: 75, days: 5.47, madeDays: 4.3, done: true, mode: "stitched" as const };
    expect(prepText(maga)).toBe("Starting items: 41 Duskbloom, 7 Shadevine, 6 Dustgrain, + 2 more · made in ~4 days");
    expect(prepText({ ...maga, kit: { zombud: 2, cindershade: 3 } })).toBe("Starting items: 3 Cindershade, 2 Zombud · made in ~4 days");
    expect(prepText({ kit: {}, cycles: 0, days: 0, done: true, mode: "stitched" })).toBe("No starting items");
    expect(prepText({ ...maga, madeDays: 0.4 })).toMatch(/made in under a day$/);
    expect(prepText({ ...maga, done: false })).toMatch(/· can't be made within the run$/);
    // Without madeDays (older cells) the days to T* count.
    const { madeDays: _m, ...noMade } = maga;
    void _m;
    expect(prepText(noMade)).toMatch(/made in ~5 days$/);
    expect(kitListText(maga.kit)).toBe("41 Duskbloom, 7 Shadevine, 6 Dustgrain, 3 Cindershade, 2 Zombud");
    expect(kitListText({})).toBe("None");
    expect(builderText(maga)).toBe("The site's builder makes the starting items in ~4 days, then this flow runs from exactly them. The builder's crops meanwhile count.");
    expect(builderText({ ...maga, credit: "flow" })).toMatch(/The builder earns more than this flow meanwhile, so those days count at this flow's own rate\.$/);
    expect(builderText({ ...maga, credit: "kit" })).toMatch(/Capped at its number with the starting items\.$/);
    expect(builderText({ ...maga, done: false, have: { zombud: 1, duskbloom: 41 } })).toBe(
      "The site's builder couldn't make the starting items before the scored part of the run (it had 0 of 7 Shadevine, 0 of 6 Dustgrain, 0 of 3 Cindershade, 1 of 2 Zombud), so this flow has no from-nothing number."
    );
    expect(builderText({ kit: {}, cycles: 0, days: 0, done: true, mode: "stitched" })).toMatch(/^No starting items/);
    // A range when the seeds differ more than 2×, and how many runs made it.
    expect(prepText({ ...maga, madeDays: 115, madeRange: [32, 170], doneSeeds: [5, 5] })).toMatch(/made in ~115 days \(32–170\)$/);
    expect(prepText({ ...maga, madeRange: [4, 5], doneSeeds: [3, 5] })).toMatch(/made in ~4 days on 3 of 5 runs$/);
    expect(readPrep({ ...maga, credit: "flow", slow: true, have: { zombud: 1.7 }, madeRange: [4, 5], doneSeeds: [5, 5] })).toMatchObject({ credit: "flow", slow: true, have: { zombud: 1 }, madeRange: [4, 5], doneSeeds: [5, 5] });
    expect(readPrep({ ...maga, credit: "nope", madeRange: [1] })).not.toHaveProperty("credit");
    // readPrep checks the shape (old or malformed cells have none).
    expect(readPrep(maga)).toEqual(maga);
    expect(readPrep({ kit: { a: 1.2 }, cycles: 25, days: 1, done: true })).toEqual({ kit: { a: 2 }, cycles: 25, days: 1, done: true, mode: "stitched" });
    expect(readPrep({ kit: {}, cycles: "x", days: 1, done: true })).toBeNull();
    expect(readPrep(undefined)).toBeNull();
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
    const items = earningItems(data, chorus.bySource, "ironman", {}, DEFAULT_BAZAAR_PRICING);
    expect(items.map((i) => i.id)).toEqual(["chorus_fruit", "chloronite", "wheat"]);
    expect(items.every((i) => i.coinsPerDay > 0)).toBe(true);
    const rows = rankEntries(data, [v2entry("a", chorus), v2entry("b", result({ wheat: 5 }, { bySource: { devourer: { pumpkin: 1 } } })), v2entry("c", null)], ironman);
    expect(earningOptions(rows)).toEqual(["chloronite", "chorus_fruit", "devourer", "wheat"]);
  });

  it("the row: the other ironman number, prep, stall, slowing, upkeep, start items, search text", () => {
    const prep = { kit: { zombud: 2 }, cycles: 75, days: 5.47, done: true, mode: "stitched" as const };
    const fromNothing = result({ wheat: 1000 }, { starved: [{ plot: 1, step: "a", item: "magic_jellybean", cells: 34 }], slowing: true, ramp: { complete: null, produced: { wheat: 2000 }, bought: {} }, prep });
    const altPoint = { produced: { wheat: 2000 }, bought: {}, consumed: {} };
    const row = flowRow(data, v2entry("a", fromNothing, { altPoint, prep, excerpt: "Uses Blastberries", summary: { plots: [], targets: ["all_in_aloe"], inputs: ["magic_jellybean"], steps: 1, scripted: false } }), ironman);
    expect(row.altPerDay).toBeCloseTo(2000 * data.crops.wheat.sellPrice);
    expect(row.prep).toEqual(prep);
    expect(row.cantMake).toBeNull();
    expect(row.stall?.plot).toBe(1);
    expect(row.slowing).toBe(true);
    expect(row.search).toContain("magic jellybean");
    expect(row.search).toContain("all-in aloe");
    expect(row.search).toContain("blastberries");
    // The row's prep falls back to the "from nothing" cell's own; an older API's borrowPoint is the alt point on "from nothing" only.
    const fallback = flowRow(data, v2entry("f", fromNothing, { borrowPoint: altPoint }), ironman);
    expect(fallback.prep).toEqual(prep);
    expect(fallback.altPerDay).toBeCloseTo(2000 * data.crops.wheat.sellPrice);
    expect(flowRow(data, v2entry("k", result({ wheat: 2000 }), { borrowPoint: altPoint }), withKit).altPerDay).toBeNull();
    // Normal rows have neither.
    expect(flowRow(data, v2entry("n", fromNothing, { altPoint, prep }), { ...ironman, board: "normal" })).toMatchObject({ altPerDay: null, prep: null, cantMake: null });
    const kit = flowRow(data, v2entry("b", result({ wheat: 1 }, { upkeep: { zombud: 91.3, puffercloud: 90.5 }, startItems: { zombud: 41720.3, puffercloud: 41377.6 } })), withKit);
    expect(kit.upkeepPerDay).toBeCloseTo(181.8);
    expect(kit.startItemsCount).toBe(41721 + 41378);
    // Old cells: none of the v2 / v3 fields.
    const old = flowRow(data, v2entry("o", result({ wheat: 1 })), ironman);
    expect([old.altPerDay, old.prep, old.cantMake, old.stall, old.slowing, old.upkeepPerDay, old.startItemsCount]).toEqual([null, null, null, null, false, 0, 0]);
    expect(searchText(v2entry("s", null))).toContain("flow s");
  });

  it("matchesFilters: earning in top 3 or anywhere, upkeep, starting items, search", () => {
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
    const by = (f: Partial<RowFilters>, board: Parameters<typeof matchesFilters>[2] = "ironman") =>
      rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, ...f }, board)).map((r) => r.entry.id);
    expect(by({})).toHaveLength(4);
    // A filter that needs a cell drops the unverified row.
    expect(by({ earning: ["wheat"], earningIn: "any" })).not.toContain("pending");
    expect(by({ earning: ["chorus_fruit"] })).toEqual(["chorus"]);
    expect(by({ earning: ["chorus_fruit"], earningIn: "any" }).sort()).toEqual(["chorus", "devourer"]);
    expect(by({ noUpkeep: true }).sort()).toEqual(["aloe", "chorus"]);
    expect(by({ noUpkeep: true }, "normal")).toHaveLength(4);
    expect(by({ maxStartItems: 0 })).toEqual(["chorus"]);
    expect(by({ maxStartItems: 200 }).sort()).toEqual(["aloe", "chorus"]);
    expect(by({ query: "AUTHOR ALOE" })).toEqual(["aloe"]);
    expect(by({ query: "chorus fruit" }).sort()).toEqual(["chorus", "devourer"]);
  });

  it("'Chorus Fruit' shows the chorus flows ordered by coins per day", () => {
    const flows = [10, 30, 20].map((n, i) => v2entry(`c${i}`, result({ chorus_fruit: n, potato: n * 1000 }, { bySource: { chorus_fruit: { potato: n * 1000 } } })));
    const rows = rankEntries(data, [...flows, v2entry("x", result({ wheat: 1e6 }, { bySource: { wheat: { wheat: 1e6 } } }))], ironman);
    const hit = sortRows(rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, earning: ["chorus_fruit"] }, "ironman")), "profit");
    expect(hit.map((r) => r.entry.id)).toEqual(["c1", "c2", "c0"]);
  });

  it("URL params round-trip; v2's board names, the switch and junk are handled", () => {
    const p = readListParams(new URLSearchParams("board=ironman&kit=1&sort=effort&plots=2&q=aloe&earning=chorus_fruit&earning=devourer&in=any&noUpkeep=1&maxStart=60"));
    expect(p).toEqual({ board: "ironman", kit: true, sort: "effort", plots: "2", filters: { query: "aloe", earning: ["chorus_fruit", "devourer"], earningIn: "any", noUpkeep: true, maxStartItems: 60 } });
    expect(readListParams(writeListParams(p))).toEqual(p);
    expect(writeListParams(p).get("kit")).toBe("1");
    expect(writeListParams({ board: null, kit: false, sort: "profit", plots: "any", filters: DEFAULT_FILTERS }).toString()).toBe("");
    // Old links: ironman_strict is the ironman board, ironman_borrow the same with the switch on (whatever kit says).
    expect(readListParams(new URLSearchParams("board=ironman_strict"))).toMatchObject({ board: "ironman", kit: false });
    expect(readListParams(new URLSearchParams("board=ironman_borrow"))).toMatchObject({ board: "ironman", kit: true });
    expect(readListParams(new URLSearchParams("board=ironman_strict&kit=1"))).toMatchObject({ board: "ironman", kit: false });
    // The switch means nothing on Normal and isn't written there.
    expect(writeListParams({ ...p, board: "normal" }).get("kit")).toBeNull();
    const junk = readListParams(new URLSearchParams("board=x&sort=nope&plots=9&maxStart=-1&earning=<b>&in=sometimes"));
    expect(junk).toEqual({ board: null, kit: false, sort: "profit", plots: "any", filters: DEFAULT_FILTERS });
  });

  it("the local test summary: each ironman variant from its own result, the median seed, the spread, failures", () => {
    const prep = { kit: { zombud: 2 }, cycles: 75, days: 5.47, done: true, mode: "stitched" as const };
    const seeds = [3000, 1000, 2000].map((n) => ({ ok: true, error: null, result: result({ wheat: n }), fromNothing: result({ wheat: n / 2 }, { prep }) }));
    const kit = localKindSummary(data, seeds, "ironman_kit", {}, DEFAULT_BAZAAR_PRICING);
    expect(kit.done).toBe(3);
    expect(kit.profitPerDay).toBeCloseTo(2000 * data.crops.wheat.sellPrice);
    expect(kit.ratio).toBeCloseTo(1.5);
    const fromNothing = localKindSummary(data, seeds, "ironman", {}, DEFAULT_BAZAAR_PRICING);
    expect(fromNothing.profitPerDay).toBeCloseTo(1000 * data.crops.wheat.sellPrice);
    expect(fromNothing.cantMake).toBeNull();
    // A failed seed fails both variants.
    const failedSeeds = [seeds[0], { ok: false, error: "script error: boom", result: null, fromNothing: null }, undefined];
    for (const k of ["ironman", "ironman_kit"] as const) expect(localKindSummary(data, failedSeeds, k, {}, DEFAULT_BAZAAR_PRICING)).toMatchObject({ done: 2, total: 3, cell: null, profitPerDay: null, ratio: null, failed: [{ seed: 2, error: "script error: boom" }] });
    // The builder can't make the kit within the run: "from nothing" says so.
    const never = seeds.map((x) => ({ ...x, fromNothing: result({ wheat: 9 }, { prep: { ...prep, done: false } }) }));
    expect(localKindSummary(data, never, "ironman", {}, DEFAULT_BAZAAR_PRICING).cantMake).toMatchObject({ done: false });
    expect(localKindSummary(data, never, "ironman_kit", {}, DEFAULT_BAZAAR_PRICING).cantMake).toBeNull();
  });
});

describe("leaderboard v2/v3: flows set apart from the from-nothing ranking", () => {
  const devourerStarved = [
    { plot: 1, step: "step-1", item: "zombud", cells: 38 },
    { plot: 1, step: "step-1", item: "puffercloud", cells: 27 },
    { plot: 2, step: "step-1", item: "wheat", cells: 9 },
  ];

  it("cantStartOf: the stored field wins; old cells derive it from starved items never produced", () => {
    expect(cantStartOf(null)).toBeNull();
    expect(cantStartOf(result({ wheat: 1 }))).toBeNull();
    const stored = { plot: 2, cells: 21, items: ["cindershade", "magic_jellybean"] };
    expect(cantStartOf(result({ wheat: 1 }, { cantStart: stored, starved: devourerStarved }))).toEqual(stored);
    // Derived: plot 1's 65 cells are for items it never produced; plot 2's wheat it does produce.
    expect(cantStartOf(result({ wheat: 5, devourer: 3 }, { starved: devourerStarved }))).toEqual({ plot: 1, cells: 65, items: ["puffercloud", "zombud"] });
    // Produced items don't count: a flow short of an item it grows only stalls.
    expect(cantStartOf(result({ zombud: 1, puffercloud: 1 }, { starved: devourerStarved.slice(0, 2) }))).toBeNull();
    // Under CANT_START_CELLS per plot (summed): not blocked, even over several plots.
    expect(cantStartOf(result({}, { starved: [{ plot: 1, step: "a", item: "cindershade", cells: 4.9 }, { plot: 2, step: "a", item: "cindershade", cells: 4.9 }] }))).toBeNull();
    // Ties go to the lower plot; a summed plot qualifies.
    expect(cantStartOf(result({}, { starved: [{ plot: 3, step: "a", item: "x", cells: 3 }, { plot: 3, step: "b", item: "y", cells: 3 }, { plot: 2, step: "a", item: "z", cells: 6 }] }))).toEqual({ plot: 2, cells: 6, items: ["z"] });
    // Malformed stored values fall back to the rule.
    expect(cantStartOf({ produced: {}, starved: [], cantStart: { plot: "1" } as unknown as RunResult["cantStart"] })).toBeNull();
  });

  it("texts: the reason line and the detail note", () => {
    const c = { plot: 1, cells: 65, items: ["zombud", "puffercloud"] };
    expect(cantStartText(c)).toBe("Never grows Zombud, Puffercloud: 65 cells empty on plot 1");
    expect(cantStartReason(c)).toBe("it places Zombud and Puffercloud but never grows them (65 cells empty on plot 1)");
    expect(cantStartReason({ plot: 1, cells: 28.8, items: ["magic_jellybean"] })).toBe("it places Magic Jellybean but never grows it (28.8 cells empty on plot 1)");
    expect(cantStartText({ plot: 1, cells: 21, items: ["cindershade", "magic_jellybean", "zombud"] })).toBe("Never grows Cindershade, Magic Jellybean, Zombud: 21 cells empty on plot 1");
  });

  it("'from nothing' ranking: rows whose starting items can't be made take no place, no rank and don't set the bar; the switch keeps them", () => {
    const never = { kit: { godseed: 1 }, cycles: 2500, days: 182, done: false, mode: "stitched" as const };
    const made = { kit: { zombud: 2 }, cycles: 75, days: 5.5, done: true, mode: "stitched" as const };
    const entries = [
      entry("big", "Godseed", result({ wheat: 1e6 }, { prep: never }), { altPoint: { produced: { wheat: 3e6 }, bought: {}, consumed: {} }, prep: never }),
      entry("a", "A", result({ wheat: 2000 }, { prep: made }), { prep: made }),
      entry("b", "B", result({ wheat: 1000 })),
    ];
    const rows = rankEntries(data, entries, ironman);
    expect(rows.map((r) => [r.entry.id, r.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["big", 0],
    ]);
    expect(rows[2].cantMake?.kit).toEqual({ godseed: 1 });
    expect(rows[2].altPerDay).toBeCloseTo(3e6 * data.crops.wheat.sellPrice);
    expect(maxProfit(rows)).toBeCloseTo(2000 * data.crops.wheat.sellPrice);
    const { ranked, cantMake } = splitRanked(sortRows(rows, "profit"));
    expect(ranked.map((r) => r.entry.id)).toEqual(["a", "b"]);
    expect(cantMake.map((r) => r.entry.id)).toEqual(["big"]);
    // Filters apply to them like any row.
    expect(rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, query: "godseed" }, "ironman")).map((r) => r.entry.id)).toEqual(["big"]);
    // With the starting items (and on Normal) nothing is set apart.
    for (const s of [withKit, { ...ironman, board: "normal" as const }]) {
      const other = rankEntries(data, entries, s);
      expect(other.map((r) => r.rank)).toEqual([1, 2, 3]);
      expect(other.every((r) => r.cantMake === null)).toBe(true);
    }
  });

  it("v2 cells still render: the old 'can't start' rule reads them, and old entries carry no prep", () => {
    const cells = [
      { runKind: "strict", board: "ironman_strict", tier: "max", every: 1, median: result({ devourer: 3 }, { starved: devourerStarved }), spread: null, seeds: 5, engineVersion: "x" },
      { runKind: "borrow", board: "ironman_borrow", tier: "max", every: 1, median: result({ wheat: 9 }), spread: null, seeds: 5, engineVersion: "x" },
    ] as unknown as FlowCell[];
    const n = boardNumbers(data, cells, "max", 1, { quotes: {}, pricing: DEFAULT_BAZAAR_PRICING, viewerStats: null, useMyStats: false });
    expect(n.map((x) => [x.kind, x.profitPerDay !== null, x.prep])).toEqual([
      ["ironman", true, null],
      ["ironman_kit", true, null],
      ["normal", false, null],
    ]);
    expect(cantStartOf(cells[0].median)).toEqual({ plot: 1, cells: 65, items: ["puffercloud", "zombud"] });
  });

  it("'with starting items' in words: to start, then per day (rounded up)", () => {
    expect(kitSummaryText({ startItems: { zombud: 164.2, puffercloud: 115.6 }, upkeep: { zombud: 92.4, puffercloud: 90.2 } })).toBe("Needs 165 Zombud, 116 Puffercloud to start, then 93 Zombud + 91 Puffercloud per day.");
    expect(kitSummaryText({ startItems: { witherbloom: 26 }, upkeep: {} })).toBe("Needs 26 Witherbloom to start, nothing after that.");
    expect(kitSummaryText({})).toBe("Needs nothing to start, and nothing per day.");
    expect(kitSummaryText({ startItems: {}, upkeep: { cindershade: 0.04 } })).toBe("Needs nothing to start, then 0.04 Cindershade per day.");
    expect(startItemsText({ zombud: 164.2, puffercloud: 115.6 })).toBe("281 items: 165 Zombud, 116 Puffercloud");
    expect(startItemsTotal({ zombud: 164.2, puffercloud: 115.6 })).toBe(281);
    expect(usedUpLines({ zombud: 97.3, puffercloud: 10.4 })).toEqual([
      { item: "zombud", units: 98 },
      { item: "puffercloud", units: 11 },
    ]);
  });
});
