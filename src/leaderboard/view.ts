import type { GameData, ItemId } from "../simulator/data/types";
import { DEFAULT_BAZAAR_PRICING, type BazaarPricing } from "../simulator/economy/bazaar";
import { RARE_DROP_ITEMS } from "../simulator/economy/bounty";
import { RARE_CROP_ITEMS } from "../simulator/economy/rareCrops";
import { formatCoins, nameOf } from "../components/simulator/format";
import type { AuthUser, CurvePoint, FlowAuthor, FlowCell, FlowListEntry, Spread, SpreadInfo, Timestamp } from "./api";
import { buyPrice, scaleResult, sellPrice, slack, valueResult, yieldStatsDiffer, type Quotes, type YieldStats } from "./pricing";
import { CANT_START_CELLS, cellResult, spreadRatio, type PrepInfo, type RunResult, type StarvedCells } from "./result";
import { boardFrom, CELL_KIND_RUN_KIND, cellKindFrom, cellKindOf, kitFromBoard, type Board, type CellKind, type RuleKind } from "./rules";
import { EVERY, type TierId } from "./tiers";

/**
 * The leaderboard page's pure view logic (docs/plans/flow-leaderboard.md §7): price the stored
 * counts under the viewer's settings, rank, label. Framework-free so it is unit-tested
 * (view.test.ts) and the components stay thin.
 */

/** Moderation limits (§2): the submit dialog and the owner's edit form enforce them. */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 2000;
export const REPORT_MAX = 200;

/** An entry younger than this gets the `new` badge. */
export const NEW_FOR_MS = 7 * 86400_000;
/** The server rejects a submission whose best seed beats the median by more than this. */
export const OUTLIER_RATIO = 2;
/** Ironman supplies the player farms themselves (placed free on the server, counted as consumed). */
export const SUPPLY_ITEMS: readonly ItemId[] = ["dead_plant", "fermento"];

/** Badge tooltips. */
export const BADGE_TITLE = {
  stale: "Scored by an older simulator version; re-verification is queued. The numbers may change.",
  estimated: "This stat tier isn't verified yet: the max-tier result stands in.",
  scaled: "Scaled to your yield stats (an estimate).",
  new: "Submitted in the last 7 days.",
};

export const TIER_LABEL: Record<TierId, string> = { max: "Max", high: "High", mid: "Mid", low: "Low" };
export const BOARD_LABEL: Record<Board, string> = { ironman: "Ironman", normal: "Normal" };
/** What a cell measured, as the page calls it. */
export const CELL_KIND_LABEL: Record<CellKind, string> = { ironman: "Ironman · from nothing", ironman_kit: "Ironman · with the starting items", normal: "Normal" };
/** The cell kinds without the "Ironman ·" prefix (compact places). */
export const CELL_KIND_SHORT: Record<CellKind, string> = { ironman: "From nothing", ironman_kit: "With the starting items", normal: "Normal" };
/** The engine set-ups as the simulator calls them. */
export const RULE_KIND_LABEL: Record<RuleKind, string> = { strict: "Ironman, strict", borrow: "Ironman", normal: "Normal" };

/**
 * The set-up the simulator's "Apply the leaderboard rules" uses for the site's Ironman / Normal
 * switch: Ironman = with the starting items (a mutation item can be placed before you own it, so
 * the flow runs as it will once you have them; "Watch from nothing" shows the builder part), Normal
 * = the normal profile. The submit dialog compares with the same one.
 */
export const profileRuleKind = (profile: string | undefined): RuleKind => (profile === "normal" ? "normal" : "borrow");

/** The rule-only switches `ruleConfig` sets: one plain-words line instead of one per key. */
const RULE_SWITCHES = new Set(["allowMutationDebt", "bootstrapDebt", "setupFromStock", "freePlacedItems", "leaderboardRules"]);

/**
 * `ruleDifferences` in a player's words, for the simulator's rules notes: the leaderboard's own
 * switches become one line, other advanced settings are named by their labels. (rules.ts is bundled
 * into the verifier, so the wording lives here.)
 */
export function ruleDifferenceLines(diffs: readonly string[], labels: Readonly<Record<string, string>> = {}): string[] {
  const out: string[] = [];
  const other: string[] = [];
  let switches = false;
  for (const d of diffs) {
    const m = /^advanced setting "(.+)" differs$/.exec(d);
    if (!m) out.push(d);
    else if (RULE_SWITCHES.has(m[1])) switches = true;
    else other.push(labels[m[1]] ?? m[1]);
  }
  if (other.length) out.push(other.length === 1 ? `the advanced setting "${other[0]}" is changed` : `${other.length} advanced settings are changed (${other.join(", ")})`);
  if (switches) out.push("the leaderboard's own set-up isn't on");
  return out;
}

/** The rule kind a simulator scenario's settings look like (the rules selectors' default). */
export function scenarioRuleKind(settings: { profile?: string; config: { allowMutationDebt?: boolean; bootstrapDebt?: boolean } }): RuleKind {
  if (settings.profile === "normal") return "normal";
  return settings.config.allowMutationDebt === true || settings.config.bootstrapDebt === true ? "borrow" : "strict";
}

/** An admin row's raw `boards` ("all" since v2; old rows list "ironman" / "normal"). */
export function boardsText(boards: readonly string[]): string {
  if (!boards.length) return "—";
  if (boards.includes("all")) return "All boards";
  return boards.map((b) => (BOARD_LABEL[boardFrom(b) ?? ("" as Board)] ?? b)).join(" + ");
}

/** The cell kind of a cell, seed row or job: its `cellKind`, else what an older API sent (`runKind` strict / borrow, or a board). */
export function cellKindOfRow(x: { cellKind?: unknown; runKind?: unknown; board?: unknown }): CellKind | null {
  return cellKindFrom(x.cellKind) ?? cellKindFrom(x.runKind) ?? cellKindFrom(x.board);
}

/** The board a cell kind is shown on. */
export const boardOfCellKind = (k: CellKind): Board => (CELL_KIND_RUN_KIND[k] === "normal" ? "normal" : "ironman");

/** Discord avatar (64 px), or Discord's default avatar for the account when it has none. */
export function avatarUrl(id: string, avatar: string | null | undefined): string {
  if (avatar) return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`;
  // BigInt() calls, not literals: the production build targets es2015.
  let index = "0";
  try {
    index = ((BigInt(id) >> BigInt(22)) % BigInt(6)).toString();
  } catch {
    index = "0";
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export const userName = (u: AuthUser): string => u.global_name || u.username;

/** ISO strings, or epoch seconds / milliseconds (anything below 1e12 is taken as seconds). */
export function toMillis(t: Timestamp | null | undefined): number {
  if (t === null || t === undefined || t === "") return NaN;
  if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
  const n = Number(t);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  return Date.parse(t);
}

/** "12 May 2026". */
export function formatDate(t: Timestamp): string {
  const ms = toMillis(t);
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export interface ViewSettings {
  board: Board;
  /** Ironman board: "I have the starting items" (the cells are the `ironman_kit` ones). */
  kit?: boolean;
  /** Normal board: Bazaar quotes (with the user's overrides); ignored for ironman. */
  quotes: Quotes;
  pricing: BazaarPricing;
  /** The viewer's yield stats, when known (from the saved simulator scenario). */
  viewerStats: YieldStats | null;
  /** Scale stored counts to `viewerStats` (an estimate). */
  useMyStats: boolean;
  /** For the `new` badge. */
  now: number;
}

export interface RowBadges {
  stale: boolean;
  /** The API's flag: a max-tier cell standing in for this tier. */
  estimated: boolean;
  new: boolean;
}

/** Where a flow's revenue comes from (coins per day). */
export interface RevenueSplit {
  crops: number;
  mutations: number;
  rare: number;
}

export interface FlowRow {
  entry: FlowListEntry;
  rank: number;
  /** Null when the entry has no verified cell yet. */
  profitPerDay: number | null;
  revenuePerDay: number | null;
  boughtPerDay: number | null;
  buildCost: number | null;
  /** Revenue by category (crops, mutation items, rare crops and drops). */
  split: RevenueSplit | null;
  /** Ironman: Dead Plants / Fermento consumed per day (counts). */
  suppliesPerDay: Record<ItemId, number>;
  /** Mutations harvested per day (count of mutation items produced). */
  mutationsPerDay: number | null;
  effortAvg: number | null;
  effortPeak: number | null;
  /** Coins per day per unit of effort per login. */
  perEffort: number | null;
  /** Target mutations, most earning first. */
  earning: { id: ItemId; coinsPerDay: number | null }[];
  uptime: number | null;
  /** From the row's frequency curve (the API's when it sends one). */
  slack: number | null;
  /** Profit per day at every grid frequency (null where not verified). */
  curve: FrequencyPoint[];
  /** Counts were scaled to the viewer's yield stats (an estimate). */
  scaled: boolean;
  badges: RowBadges;
  unpriced: ItemId[];
  /** Every harvested plant kind that earns coins on this board, most first (`earningItems`). */
  sources: EarningItem[];
  /** A plot whose layout cells sit empty for lack of stock (≥ STALL_CELLS on average). */
  stall: StallInfo | null;
  /** The cell is scored at its trailing rate (most seeds slowed down at the end). */
  slowing: boolean;
  /** Units per day the borrowed items grow by (0 = none or not a borrow cell). */
  upkeepPerDay: number;
  /** Starting items the borrow cell needs, whole units (0 = none or not a borrow cell). */
  startItemsCount: number;
  /** Lower-case text the search box matches: title, author, excerpt and item ids / names. */
  search: string;
  /**
   * "From nothing": the builder couldn't make the starting items within the run (`prep.done`
   * false). Such rows are not ranked (`rank` 0): the page lists them apart.
   */
  cantMake: PrepInfo | null;
  /**
   * "From nothing": the flow stops once its starting items run out (a slowing cell worth under
   * STOPS_SHARE of the same flow with the starting items, e.g. a Devourer farm that needs ~91 Zombud a
   * day it never grows). Listed apart with `cantMake`, not ranked.
   */
  stops: boolean;
  /** Ironman: the other ironman variant at the same tier / every (`altPoint`), priced; null when unknown. */
  altPerDay: number | null;
  /** Ironman: how the starting items are made (the "from nothing" cell's `prep`); null when unknown. */
  prep: PrepInfo | null;
}

export type SortKey = "profit" | "perEffort" | "effort" | "forgiving" | "liked" | "liked30d" | "newest";

export const SORT_LABEL: Record<SortKey, string> = {
  profit: "Profit",
  perEffort: "Profit per effort",
  effort: "Least effort",
  forgiving: "Most forgiving",
  liked: "Most liked",
  liked30d: "Most liked (30 days)",
  newest: "Newest",
};

/** Like counts the viewer changed locally (server replies), over the possibly cached list. */
export type LikeCounts = Record<string, { likes: number; likes30d: number }>;

/** Entries with the viewer's fresher like counts applied. */
export function withLikeCounts<T extends { id: string; likes?: number; likes30d?: number }>(entries: readonly T[], counts: LikeCounts): T[] {
  return entries.map((e) => (counts[e.id] ? { ...e, ...counts[e.id] } : e));
}

/** The result as the viewer sees it: scaled to their yield stats when asked and known. */
export function viewerResult(data: GameData, cell: RunResult, s: Pick<ViewSettings, "viewerStats" | "useMyStats">): { result: RunResult; scaled: boolean } {
  if (!s.useMyStats || !s.viewerStats || !yieldStatsDiffer(s.viewerStats)) return { result: cell, scaled: false };
  return { result: scaleResult(data, cell, s.viewerStats), scaled: true };
}

export function suppliesOf(r: RunResult | null): Record<ItemId, number> {
  const out: Record<ItemId, number> = {};
  if (!r) return out;
  for (const item of SUPPLY_ITEMS) if ((r.consumed[item] ?? 0) > 0) out[item] = r.consumed[item];
  return out;
}

const plural = (n: number, one: string, many: string) => (Math.round(n) === 1 ? one : many);
const roundCount = (n: number) => (n >= 10 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(1).replace(/\.0$/, "") : n > 0 ? n.toPrecision(1) : "0");

/** "12 dead plants, 3 fermento" per day; "none" when the flow places neither. */
export function suppliesText(supplies: Record<ItemId, number>): string {
  const parts: string[] = [];
  const dead = supplies.dead_plant ?? 0;
  const ferm = supplies.fermento ?? 0;
  if (dead > 0) parts.push(`${roundCount(dead)} ${plural(dead, "dead plant", "dead plants")}`);
  if (ferm > 0) parts.push(`${roundCount(ferm)} fermento`);
  return parts.length ? parts.join(", ") : "none";
}

/** Revenue by category under a board's prices. */
export function revenueSplit(data: GameData, r: RunResult, board: Board, quotes: Quotes, pricing: BazaarPricing): RevenueSplit {
  const out: RevenueSplit = { crops: 0, mutations: 0, rare: 0 };
  for (const [item, n] of Object.entries(r.produced)) {
    const unit = sellPrice(data, item, board, board === "normal" ? quotes : {}, pricing) ?? 0;
    const coins = n * unit;
    if (data.mutations[item]) out.mutations += coins;
    else if (RARE_CROP_ITEMS.includes(item) || RARE_DROP_ITEMS.includes(item)) out.rare += coins;
    else out.crops += coins;
  }
  return out;
}

/** Mutation items harvested per day. */
export function mutationsPerDay(data: GameData, r: RunResult): number {
  let n = 0;
  for (const [item, q] of Object.entries(r.produced)) if (data.mutations[item]) n += q;
  return n;
}

/** A curve point (or any produced / bought pair) priced like a cell: scaled to the viewer, valued on the board. */
export function pricePoint(data: GameData, p: Pick<CurvePoint, "produced" | "bought"> & { consumed?: CurvePoint["consumed"] }, s: Pick<ViewSettings, "board" | "quotes" | "pricing" | "viewerStats" | "useMyStats">): number {
  const asResult = { ...EMPTY_RESULT, produced: p.produced ?? {}, bought: p.bought ?? {}, consumed: p.consumed ?? {} };
  const { result } = viewerResult(data, asResult, s);
  return valueResult(data, result, s.board, s.board === "normal" ? s.quotes : {}, s.pricing ?? DEFAULT_BAZAAR_PRICING).profitPerDay;
}

/** A list row's frequency curve, priced for the viewer (null where the API sent no point). */
export function rowCurve(data: GameData, entry: FlowListEntry, s: ViewSettings): FrequencyPoint[] {
  const curve = entry.curve ?? {};
  return EVERY.map((every) => {
    const p = curve[String(every)];
    if (!p || typeof p !== "object") return { every, profitPerDay: null };
    return { every, profitPerDay: pricePoint(data, p, s) };
  });
}

const EMPTY_RESULT: RunResult = {
  cycles: 0,
  days: 0,
  produced: {},
  consumed: {},
  bought: {},
  built: {},
  shortfall: {},
  uptime: 0,
  sustainable: true,
  effort: { sessions: 0, avg: 0, peak: 0, byKind: {} },
  halted: false,
};

/** Price one list entry for the viewer. `every` is the frequency the list was fetched at (for Slack). */
export function flowRow(data: GameData, entry: FlowListEntry, s: ViewSettings, every = 1): Omit<FlowRow, "rank"> {
  const created = toMillis(entry.createdAt);
  const badges: RowBadges = {
    stale: !!entry.stale,
    estimated: !!entry.estimated,
    new: Number.isFinite(created) && s.now - created >= 0 && s.now - created < NEW_FOR_MS,
  };
  const effort = entry.effort ?? entry.cell?.effort ?? null;
  const curve = rowCurve(data, entry, s);
  const derivedSlack = slackFrom(curve, every);
  const base = {
    entry,
    suppliesPerDay: suppliesOf(entry.cell),
    effortAvg: effort ? effort.avg : null,
    effortPeak: effort ? effort.peak : null,
    uptime: entry.cell ? entry.cell.uptime : null,
    slack: typeof entry.slack === "number" ? entry.slack : derivedSlack,
    curve,
    badges,
  };
  const targets = entry.summary?.targets ?? [];
  const search = searchText(entry);
  if (!entry.cell)
    return {
      ...base,
      profitPerDay: null,
      revenuePerDay: null,
      boughtPerDay: null,
      buildCost: null,
      split: null,
      mutationsPerDay: null,
      perEffort: null,
      earning: targets.map((id) => ({ id, coinsPerDay: null })),
      scaled: false,
      unpriced: [],
      sources: [],
      stall: null,
      slowing: false,
      upkeepPerDay: 0,
      startItemsCount: 0,
      search,
      cantMake: null,
      stops: false,
      altPerDay: null,
      prep: s.board === "ironman" ? prepOf(entry, null, !!s.kit) : null,
    };
  const cell = entry.cell;
  const { result, scaled } = viewerResult(data, cell, s);
  const quotes = s.board === "normal" ? s.quotes : {};
  const pricing = s.pricing ?? DEFAULT_BAZAAR_PRICING;
  const v = valueResult(data, result, s.board, quotes, pricing);
  const alt = s.board === "ironman" ? altPointOf(entry, !!s.kit) : null;
  const altPerDay = alt ? pricePoint(data, alt, s) : null;
  const prep = s.board === "ironman" ? prepOf(entry, cell, !!s.kit) : null;
  return {
    ...base,
    cantMake: s.board === "ironman" && !s.kit && prep && !prep.done ? prep : null,
    stops: s.board === "ironman" && !s.kit && stopsAt(cell.slowing === true, v.profitPerDay, altPerDay),
    altPerDay,
    prep,
    sources: earningItems(data, result.bySource, s.board, quotes, pricing),
    stall: stallInfo(cell.starved),
    slowing: cell.slowing === true,
    upkeepPerDay: sumValues(cell.upkeep),
    startItemsCount: startItemsTotal(cell.startItems),
    search,
    earning: earningTargets(data, targets, result.bySource, s.board, quotes, pricing),
    profitPerDay: v.profitPerDay,
    revenuePerDay: v.revenuePerDay,
    boughtPerDay: v.boughtPerDay,
    buildCost: v.buildCost,
    split: revenueSplit(data, result, s.board, quotes, pricing),
    mutationsPerDay: mutationsPerDay(data, result),
    perEffort: effort && effort.avg > 0 ? v.profitPerDay / effort.avg : null,
    scaled,
    unpriced: v.unpriced,
  };
}

/** The other ironman variant's curve point of a list row: `altPoint`, or an older API's `borrowPoint` on "from nothing". */
function altPointOf(entry: FlowListEntry, kit: boolean): CurvePoint | null {
  const p = entry.altPoint ?? (kit ? null : entry.borrowPoint);
  return p && typeof p === "object" ? p : null;
}

/** A "from nothing" cell that is slowing and worth under this share of the same flow with the starting items: it stops. */
export const STOPS_SHARE = 0.1;

/** Whether a slowing from-nothing value stops (see `FlowRow.stops`); false without the other number to compare with. */
export function stopsAt(slowing: boolean, fromNothing: number | null, withItems: number | null): boolean {
  return slowing && fromNothing !== null && withItems !== null && withItems > 0 && fromNothing < STOPS_SHARE * withItems;
}

const numPair = (v: unknown): [number, number] | null => (Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) ? [v[0], v[1]] : null);

/** A valid `prep` (the "from nothing" cell's), else null. */
export function readPrep(raw: unknown): PrepInfo | null {
  if (!isRecord(raw) || !isRecord(raw.kit) || !finite(raw.cycles) || !finite(raw.days) || typeof raw.done !== "boolean") return null;
  const kit: Record<ItemId, number> = {};
  for (const [item, n] of Object.entries(raw.kit)) if (finite(n) && n > 0) kit[item] = Math.ceil(n - 1e-9);
  const out: PrepInfo = { kit, cycles: raw.cycles, days: raw.days, done: raw.done, mode: raw.mode === "real" ? "real" : "stitched" };
  if (finite(raw.madeDays)) out.madeDays = raw.madeDays;
  if (raw.credit === "timeline" || raw.credit === "flow" || raw.credit === "kit") out.credit = raw.credit;
  if (typeof raw.slow === "boolean") out.slow = raw.slow;
  if (isRecord(raw.have)) {
    const have: Record<ItemId, number> = {};
    for (const [item, n] of Object.entries(raw.have)) if (finite(n) && n >= 0) have[item] = Math.floor(n);
    out.have = have;
  }
  const range = numPair(raw.madeRange);
  if (range) out.madeRange = range;
  const doneSeeds = numPair(raw.doneSeeds);
  if (doneSeeds) out.doneSeeds = doneSeeds;
  return out;
}

/** A list row's `prep`: the row's own field, else (on "from nothing") its cell's. */
function prepOf(entry: FlowListEntry, cell: RunResult | null, kit: boolean): PrepInfo | null {
  return readPrep(entry.prep) ?? (kit ? null : readPrep(cell?.prep));
}

/** Days the builder took to make the kit (the first time it owned it), else the days to T*. */
export const prepDays = (p: PrepInfo): number => p.madeDays ?? p.days;

/** "~4 days", "under a day", "~1 day". */
function aboutDays(days: number): string {
  if (days < 1) return "under a day";
  const n = Math.round(days);
  return `~${n.toLocaleString("en-US")} day${n === 1 ? "" : "s"}`;
}

/** Kit items, largest first (ties by id). */
const kitLines = (kit: Readonly<Record<ItemId, number>>) => positiveEntries(kit);

/** "~4 days", or "~115 days (32–170)" when the seeds' build times differ more than 2×. */
function madeText(p: PrepInfo): string {
  const r = p.madeRange;
  const spread = r && r[0] > 0 && r[1] > 2 * r[0] ? ` (${Math.round(r[0])}–${Math.round(r[1])})` : "";
  return `${aboutDays(prepDays(p))}${spread}`;
}

/**
 * The ranking's starting-items line: "Starting items: 2 Zombud, 3 Cindershade · made in ~4 days"
 * (at most three items, then "+ N more"; a range when the seeds differ more than 2×; "· on 3 of 5
 * runs" when some couldn't); "No starting items" for an empty kit; "... · can't be made within the
 * run" when the builder didn't finish.
 */
export function prepText(p: PrepInfo): string {
  const lines = kitLines(p.kit);
  if (!lines.length) return "No starting items";
  const shown = lines.slice(0, 3).map(([item, n]) => `${n.toLocaleString("en-US")} ${nameOf(item)}`);
  if (lines.length > 3) shown.push(`+ ${lines.length - 3} more`);
  const runs = p.doneSeeds && p.doneSeeds[0] < p.doneSeeds[1] ? ` on ${p.doneSeeds[0]} of ${p.doneSeeds[1]} runs` : "";
  return `Starting items: ${shown.join(", ")} · ${p.done ? `made in ${madeText(p)}${runs}` : "can't be made within the run"}`;
}

/** What the builder had of a kit it couldn't finish: "1 of 3 Timestalk, 0 of 2 Devourer" (null without `have`). */
export function haveText(p: PrepInfo): string | null {
  if (!p.have) return null;
  const short = kitLines(p.kit).filter(([item, n]) => (p.have![item] ?? 0) < n);
  return short.length ? short.map(([item, n]) => `${(p.have![item] ?? 0).toLocaleString("en-US")} of ${n.toLocaleString("en-US")} ${nameOf(item)}`).join(", ") : null;
}

/** "93 Zombud + 91 Puffercloud a day" from a cell's upkeep (rounded up), or null when none. */
export function upkeepNeedText(upkeep: unknown): string | null {
  const lines = positiveEntries(upkeep);
  return lines.length ? `${lines.map(([item, n]) => `${countUp(n)} ${nameOf(item)}`).join(" + ")} a day` : null;
}

/** The whole kit for a tooltip: "41 Duskbloom, 7 Shadevine, 6 Dustgrain, 3 Cindershade, 2 Zombud". */
export function kitListText(kit: Readonly<Record<ItemId, number>>): string {
  const lines = kitLines(kit);
  return lines.length ? lines.map(([item, n]) => `${n.toLocaleString("en-US")} ${nameOf(item)}`).join(", ") : "None";
}

/** Whole items in a kit. */
export const kitCount = (kit: Readonly<Record<ItemId, number>>): number => kitLines(kit).reduce((a, [, n]) => a + n, 0);

/**
 * The detail page's builder line: "The site's builder makes the starting items in ~4 days, then this
 * flow runs from exactly them." plus why the builder's crops don't count when they don't.
 */
export function builderText(p: PrepInfo): string {
  if (!kitLines(p.kit).length) return "No starting items: it starts from an empty inventory.";
  if (!p.done) {
    const have = haveText(p);
    return `The site's builder couldn't make the starting items before the scored part of the run${have ? ` (it had ${have})` : ""}, so this flow has no from-nothing number.`;
  }
  const base = `The site's builder makes the starting items in ${madeText(p)}, then this flow runs from exactly them.`;
  if (p.credit === "flow") return `${base} The builder earns more than this flow meanwhile, so those days count at this flow's own rate.`;
  if (p.credit === "kit") return `${base} Capped at its number with the starting items.`;
  return `${base} The builder's crops meanwhile count.`;
}

/**
 * Standard competition ranks ("1, 2, 2, 4") over rows already sorted best first; rows without a
 * value share the last rank after every valued one. (`rankEntries` gives rows whose starting
 * items can't be made within the run rank 0 instead.)
 */
export function rank<T extends { profitPerDay: number | null }>(sorted: readonly T[]): (T & { rank: number })[] {
  let last: number | null | undefined;
  let lastRank = 0;
  return sorted.map((row, i) => {
    const r = i > 0 && row.profitPerDay === last ? lastRank : i + 1;
    last = row.profitPerDay;
    lastRank = r;
    return { ...row, rank: r };
  });
}

/**
 * Rows ranked by profit per day, best first (unverified entries last, by title). The rank is always
 * the profit rank; `sortRows` reorders for other views without changing it. On "from nothing",
 * rows whose starting items can't be made within the run (`cantMake`) take no place: they come
 * last with rank 0 (`splitRanked`).
 */
export function rankEntries(data: GameData, entries: readonly FlowListEntry[], s: ViewSettings, every = 1): FlowRow[] {
  const rows = entries.map((e) => flowRow(data, e, s, every));
  rows.sort((a, b) => {
    if (a.profitPerDay === null && b.profitPerDay === null) return a.entry.title.localeCompare(b.entry.title);
    if (a.profitPerDay === null) return 1;
    if (b.profitPerDay === null) return -1;
    return b.profitPerDay - a.profitPerDay || a.entry.title.localeCompare(b.entry.title);
  });
  const apart = (r: Pick<FlowRow, "cantMake" | "stops">) => !!r.cantMake || r.stops;
  const blocked = rows.filter(apart).map((r) => ({ ...r, rank: 0 }));
  return [...rank(rows.filter((r) => !apart(r))), ...blocked];
}

/** Ranked rows and the ones set apart from "from nothing" (can't make its starting items, or stops; rank 0), each in the given order. */
export function splitRanked<T extends { cantMake: PrepInfo | null; stops?: boolean }>(rows: readonly T[]): { ranked: T[]; cantMake: T[] } {
  const apart = (r: T) => !!r.cantMake || r.stops === true;
  return { ranked: rows.filter((r) => !apart(r)), cantMake: rows.filter(apart) };
}

/** Missing values always sort last, whichever way the key goes. */
function byKey<T>(get: (r: T) => number | null, desc: boolean) {
  return (a: T, b: T) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return desc ? y - x : x - y;
  };
}

/** Reorder ranked rows for a sort key (stable: ties keep the profit order). */
export function sortRows(rows: readonly FlowRow[], key: SortKey): FlowRow[] {
  const out = [...rows];
  switch (key) {
    case "profit":
      return out;
    case "perEffort":
      return out.sort(byKey((r) => r.perEffort, true));
    case "effort":
      return out.sort(byKey((r) => (r.profitPerDay === null ? null : r.effortAvg), false));
    case "forgiving":
      return out.sort(byKey((r) => r.slack, true));
    case "liked":
      return out.sort(byKey((r) => r.entry.likes ?? 0, true));
    case "liked30d":
      return out.sort(byKey((r) => r.entry.likes30d ?? 0, true));
    case "newest":
      return out.sort(byKey((r) => {
        const t = toMillis(r.entry.createdAt);
        return Number.isFinite(t) ? t : null;
      }, true));
  }
}

/** The largest profit in a set of rows (for the relative bars); rows set apart (`cantMake`, `stops`) don't count. */
export function maxProfit(rows: readonly FlowRow[]): number {
  return rows.reduce((m, r) => (r.cantMake || r.stops ? m : Math.max(m, r.profitPerDay ?? 0)), 0);
}

/**
 * Case-insensitive search; ranks are kept from the full list. Rows with a `search` text (flowRow's:
 * title, author, excerpt, item ids and names) match on it, others on title or author name.
 */
export function filterRows<T extends { entry: { title: string; author: FlowAuthor }; search?: string }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => (r.search !== undefined ? r.search.includes(q) : r.entry.title.toLowerCase().includes(q) || r.entry.author.name.toLowerCase().includes(q)));
}

// ---- Leaderboard v2: earning sources, starting items, upkeep, stalls, ramp, filters ------------

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Positive finite values of a count map, as entries, largest first (ties by id). */
function positiveEntries(m: unknown): [ItemId, number][] {
  if (!isRecord(m)) return [];
  return Object.entries(m)
    .filter((e): e is [ItemId, number] => finite(e[1]) && e[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const sumValues = (m: unknown): number => positiveEntries(m).reduce((s, [, n]) => s + n, 0);

/** A count rounded up for display ("you need at least this many"); small fractions keep one significant digit. */
function countUp(n: number): string {
  if (n >= 1) return Math.ceil(n - 1e-9).toLocaleString("en-US");
  return n > 0 ? String(Number(n.toPrecision(1))) : "0";
}

/** Whole starting items a borrow cell needs (each item rounded up), 0 when none or not a borrow cell. */
export function startItemsTotal(startItems: unknown): number {
  return positiveEntries(startItems).reduce((s, [, n]) => s + Math.ceil(n - 1e-9), 0);
}

/** One harvested plant kind and the coins its drops bring per day on a board. */
export interface EarningItem {
  id: ItemId;
  coinsPerDay: number;
  isMutation: boolean;
}

/** Every plant kind whose harvests earn coins on the board, most first (`moneyBySource` without the zero lines). */
export function earningItems(data: GameData, bySource: RunResult["bySource"], board: Board, quotes: Quotes, pricing: BazaarPricing): EarningItem[] {
  return moneyBySource(data, isRecord(bySource) ? bySource : undefined, board, quotes, pricing)
    .filter((l) => l.coinsPerDay > 0)
    .map((l) => ({ id: l.kind, coinsPerDay: l.coinsPerDay, isMutation: l.isMutation }));
}

/** The plant kinds the earning filter offers: every `bySource` key over the rows, by display name. */
export function earningOptions(rows: readonly { entry: FlowListEntry }[]): ItemId[] {
  const ids = new Set<ItemId>();
  for (const r of rows) {
    const by = r.entry.cell?.bySource;
    if (isRecord(by)) for (const k of Object.keys(by)) ids.add(k);
  }
  return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b));
}

/** A plot with this many layout cells empty for lack of stock (on average) gets the Stall chip. */
export const STALL_CELLS = 5;

export interface StallInfo {
  plot: number;
  /** All starved cells of that plot. */
  cells: number;
  /** Its largest entry. */
  top: StarvedCells;
}

/** Valid `starved` entries, largest first (old cells have none). */
export function starvedList(starved: unknown): StarvedCells[] {
  if (!Array.isArray(starved)) return [];
  return starved
    .filter((e): e is StarvedCells => isRecord(e) && finite(e.plot) && typeof e.step === "string" && typeof e.item === "string" && finite(e.cells) && e.cells > 0)
    .sort((a, b) => b.cells - a.cells || a.plot - b.plot);
}

/** The worst plot when any plot averages ≥ STALL_CELLS starved cells (summed over its entries), else null. */
export function stallInfo(starved: unknown): StallInfo | null {
  const byPlot = new Map<number, { cells: number; top: StarvedCells }>();
  for (const e of starvedList(starved)) {
    const p = byPlot.get(e.plot);
    if (p) p.cells += e.cells;
    else byPlot.set(e.plot, { cells: e.cells, top: e });
  }
  let best: StallInfo | null = null;
  for (const [plot, p] of byPlot) if (p.cells >= STALL_CELLS && (!best || p.cells > best.cells)) best = { plot, cells: p.cells, top: p.top };
  return best;
}

/** A strict run that never got going: on `plot`, `cells` layout cells sat empty for `items` it never grows. */
export interface CantStart {
  plot: number;
  cells: number;
  items: ItemId[];
}

/**
 * Whether a "from nothing" cell never got going. The stored `cantStart` wins (cells inherit it from
 * their median seed); older cells don't have it, so it is derived with the verifier's rule from
 * `starved`: per plot, the cells empty for items the cell never produced, at least
 * CANT_START_CELLS, the worst plot (ties: the lower plot). Only `starved`'s top 8 entries are
 * stored, so the derived figure can be a little lower than the verifier's.
 */
export function cantStartOf(cell: Pick<RunResult, "cantStart" | "starved" | "produced"> | null | undefined): CantStart | null {
  if (!cell) return null;
  const stored = cell.cantStart;
  if (isRecord(stored) && finite(stored.plot) && finite(stored.cells) && Array.isArray(stored.items)) {
    const items = stored.items.filter((x): x is ItemId => typeof x === "string");
    return { plot: stored.plot, cells: stored.cells, items };
  }
  const produced = isRecord(cell.produced) ? cell.produced : {};
  const byPlot = new Map<number, { cells: number; items: Set<ItemId> }>();
  for (const e of starvedList(cell.starved)) {
    if ((produced[e.item] ?? 0) > 0) continue;
    const p = byPlot.get(e.plot) ?? { cells: 0, items: new Set<ItemId>() };
    p.cells += e.cells;
    p.items.add(e.item);
    byPlot.set(e.plot, p);
  }
  let worst: CantStart | null = null;
  for (const [plot, p] of byPlot) {
    if (p.cells >= CANT_START_CELLS && (!worst || p.cells > worst.cells || (p.cells === worst.cells && plot < worst.plot))) worst = { plot, cells: Math.round(p.cells * 1000) / 1000, items: [...p.items].sort() };
  }
  return worst;
}

/** "Zombud, Puffercloud" / "Zombud and Puffercloud" (prose). */
function itemList(items: readonly ItemId[], prose = false): string {
  const names = items.map(nameOf);
  if (!prose || names.length < 2) return names.join(", ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "65 cells", "28.8 cells", "1 cell" (one decimal under 100). */
function cellsText(n: number): string {
  const v = n >= 100 ? Math.round(n).toLocaleString("en-US") : n >= 1 ? n.toFixed(1).replace(/\.0$/, "") : String(Number(n.toPrecision(1)));
  return `${v} cell${v === "1" ? "" : "s"}`;
}

/** The ranking's reason line: "Never grows Zombud, Puffercloud: 65 cells empty on plot 1". */
export function cantStartText(c: CantStart): string {
  return `Never grows ${itemList(c.items) || "an item it places"}: ${cellsText(c.cells)} empty on plot ${c.plot}`;
}

/** The detail page's note: "it places Zombud and Puffercloud but never grows them (65 cells empty on plot 1)". */
export function cantStartReason(c: CantStart): string {
  const one = c.items.length === 1;
  return `it places ${itemList(c.items, true) || "items"} but never grows ${one ? "it" : "them"} (${cellsText(c.cells)} empty on plot ${c.plot})`;
}

/** How a step is named in messages ("step 2 (All-in Aloe)" with the payload, else its id). */
export type StepNamer = (plot: number, stepId: string) => string;
/** Without the flow's labels (the ranking): the simulator's ids read as is ("step-2"), others get a "step" prefix. */
export const stepIdName: StepNamer = (_plot, id) => (/^step[-_ ]?\d+$/i.test(id) ? id : `step ${id}`);

/** "Plot 1, step 2 (All-in Aloe): 34 Magic Jellybean cells empty on average". */
export function starvedText(e: StarvedCells, stepName: StepNamer = stepIdName): string {
  const n = e.cells >= 10 ? Math.round(e.cells).toLocaleString("en-US") : e.cells >= 1 ? e.cells.toFixed(1).replace(/\.0$/, "") : String(Number(e.cells.toPrecision(1)));
  return `Plot ${e.plot}, ${stepName(e.plot, e.step)}: ${n} ${nameOf(e.item)} cell${n === "1" ? "" : "s"} empty on average`;
}

/** The step names of a flows file for messages: "step 2 (All-in Aloe)". */
export function payloadStepNamer(plots: readonly { id: number; flow: { steps: readonly { id: string; label?: string }[] } }[] | undefined): StepNamer {
  const names = new Map<string, string>();
  for (const p of plots ?? []) p.flow.steps.forEach((s, i) => names.set(`${p.id}|${s.id}`, s.label?.trim() ? `step ${i + 1} (${s.label.trim()})` : `step ${i + 1}`));
  return (plot, id) => names.get(`${plot}|${id}`) ?? stepIdName(plot, id);
}

/** Per-day upkeep, largest first. */
export function upkeepLines(upkeep: unknown): { item: ItemId; perDay: number }[] {
  return positiveEntries(upkeep).map(([item, perDay]) => ({ item, perDay }));
}

/** "None", or "92 Zombud + 92 Puffercloud /day" (each rounded up; at most three, then "+ N more"). */
export function upkeepText(upkeep: unknown): string {
  const lines = upkeepLines(upkeep);
  if (!lines.length) return "None";
  const shown = lines.slice(0, 3).map((l) => `${countUp(l.perDay)} ${nameOf(l.item)}`);
  if (lines.length > 3) shown.push(`${lines.length - 3} more`);
  return `${shown.join(" + ")} /day`;
}

/**
 * "With starting items" in one line: "Needs 165 Zombud, 116 Puffercloud to start, then 93 Zombud +
 * 91 Puffercloud per day." (each rounded up; at most three items per part, then "+ N more").
 * "Needs nothing to start" / "nothing after that" for the empty parts.
 */
export function kitSummaryText(r: Pick<RunResult, "startItems" | "upkeep">): string {
  const start = positiveEntries(r.startItems);
  const daily = upkeepLines(r.upkeep);
  const startPart = start.length
    ? `Needs ${start.slice(0, 3).map(([item, n]) => `${countUp(n)} ${nameOf(item)}`).join(", ")}${start.length > 3 ? ` + ${start.length - 3} more` : ""} to start`
    : "Needs nothing to start";
  const dailyPart = daily.length
    ? `then ${daily.slice(0, 3).map((l) => `${countUp(l.perDay)} ${nameOf(l.item)}`).join(" + ")}${daily.length > 3 ? ` + ${daily.length - 3} more` : ""} per day`
    : start.length
      ? "nothing after that"
      : "and nothing per day";
  return `${startPart}, ${dailyPart}.`;
}

/** "54 items: 41 Duskbloom, 7 Shadevine, 6 Dustgrain" (rounded up), "None" when it needs nothing. */
export function startItemsText(startItems: unknown): string {
  const lines = positiveEntries(startItems);
  if (!lines.length) return "None";
  const total = startItemsTotal(startItems);
  return `${total.toLocaleString("en-US")} item${total === 1 ? "" : "s"}: ${lines.map(([item, n]) => `${countUp(n)} ${nameOf(item)}`).join(", ")}`;
}

/** The "What you need" margin on top of the most the flow ever owed. */
export const KIT_MARGIN = 0.25;

export interface NeedLine {
  item: ItemId;
  /** The most owed at once, rounded up. */
  needs: number;
  /** With the KIT_MARGIN, rounded up. */
  bring: number;
  /** Only ever borrowed within a session (given back before the cycle ends). */
  sessionOnly: boolean;
}

/** A borrow cell's starting items, largest first, with the suggested margin. */
export function needLines(r: Pick<RunResult, "startItems" | "sessionOnly">): NeedLine[] {
  const session = new Set(Array.isArray(r.sessionOnly) ? r.sessionOnly : []);
  return positiveEntries(r.startItems).map(([item, n]) => {
    const needs = Math.ceil(n - 1e-9);
    return { item, needs, bring: Math.ceil(needs * (1 + KIT_MARGIN) - 1e-9), sessionOnly: session.has(item) };
  });
}

/** Items still owed at the end: used up once (rounded up), largest first. */
export function usedUpLines(usedUp: unknown): { item: ItemId; units: number }[] {
  return positiveEntries(usedUp).map(([item, n]) => ({ item, units: Math.ceil(n - 1e-9) }));
}

/** Days until the layouts were complete: `ramp.complete` in days (null: never; undefined: no ramp data). */
export function rampDays(r: Pick<RunResult, "ramp" | "days" | "cycles">): number | null | undefined {
  const ramp = r.ramp;
  if (!isRecord(ramp)) return undefined;
  if (ramp.complete === null) return null;
  if (!finite(ramp.complete)) return undefined;
  return r.cycles > 0 && r.days > 0 ? (ramp.complete * r.days) / r.cycles : 0;
}

/**
 * "Layout complete after ~16 days · then 12.3M/day" (the rate over the second half of the run,
 * priced by the caller), "from the start" for 0, an honest "never complete" for null. Null without
 * ramp data (old cells).
 */
export function rampText(r: Pick<RunResult, "ramp" | "days" | "cycles">, steadyPerDay: number | null): string | null {
  const days = rampDays(r);
  if (days === undefined) return null;
  const then = steadyPerDay === null ? "" : ` · then ${formatCoins(steadyPerDay)}/day`;
  if (days === null) return `Layout never complete (some cells stay empty)${then}`;
  if (days <= 0) return `Layout complete from the start${then}`;
  const d = days < 1 ? "under a day" : `~${Math.round(days).toLocaleString("en-US")} day${Math.round(days) === 1 ? "" : "s"}`;
  return `Layout complete after ${d}${then}`;
}

/** Lower-case haystack for the search box: title, author, excerpt, and the item ids and names it grows, places or earns from. */
export function searchText(entry: FlowListEntry): string {
  const ids = new Set<string>([...(entry.summary?.targets ?? []), ...(entry.summary?.inputs ?? [])]);
  const by = entry.cell?.bySource;
  if (isRecord(by)) for (const k of Object.keys(by)) ids.add(k);
  const parts = [entry.title, entry.author?.name ?? "", entry.excerpt ?? ""];
  for (const id of ids) parts.push(id, id.replace(/_/g, " "), nameOf(id));
  return parts.join("\n").toLowerCase();
}

export type EarningIn = "top3" | "any";
/** "Starting items ≤ N" presets (null = any). */
export const START_ITEM_CAPS: readonly (number | null)[] = [null, 0, 60, 200];

/** The ranking's client-side filters (all in the URL; the plot filter is part of the list request). */
export interface RowFilters {
  query: string;
  /** Plant kinds whose harvests must be among the row's earners. Empty = off. */
  earning: ItemId[];
  earningIn: EarningIn;
  /** Ironman board: hide rows with any upkeep. */
  noUpkeep: boolean;
  /** Ironman board: at most this many starting items (null = any). */
  maxStartItems: number | null;
}

export const DEFAULT_FILTERS: RowFilters = { query: "", earning: [], earningIn: "top3", noUpkeep: false, maxStartItems: null };

type FilterRow = Pick<FlowRow, "entry" | "sources" | "upkeepPerDay" | "startItemsCount"> & { search?: string };

/**
 * Whether a row passes the filters on `board`. The starting-item filters only apply on the
 * ironman board (both modes: either cell carries the starting items); any filter that needs a cell
 * drops rows without one.
 */
export function matchesFilters(row: FilterRow, f: RowFilters, board: Board): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !(row.search ?? `${row.entry.title}\n${row.entry.author.name}`.toLowerCase()).includes(q)) return false;
  const cell = row.entry.cell;
  if (f.earning.length) {
    if (!cell) return false;
    const pool = f.earningIn === "any" ? row.sources : row.sources.slice(0, 3);
    if (!pool.some((s) => f.earning.includes(s.id))) return false;
  }
  if (board !== "ironman") return true;
  if ((f.noUpkeep || f.maxStartItems !== null) && !cell) return false;
  if (f.noUpkeep && row.upkeepPerDay > 0) return false;
  if (f.maxStartItems !== null && row.startItemsCount > f.maxStartItems) return false;
  return true;
}

/** Everything the ranking keeps in its URL. */
export interface ListParams {
  /** Null: the site profile's default board. */
  board: Board | null;
  /** Ironman board: "I have the starting items" (`kit=1`; v2's `board=ironman_borrow` too). */
  kit: boolean;
  sort: SortKey;
  plots: "any" | "1" | "2" | "3";
  filters: RowFilters;
}

const SORT_KEYS = Object.keys(SORT_LABEL) as SortKey[];

/** Read the ranking's URL query (unknown or malformed values fall back to the defaults; v2's `ironman_strict` / `ironman_borrow` are the ironman board without / with the starting items). */
export function readListParams(params: URLSearchParams): ListParams {
  const sort = params.get("sort") as SortKey | null;
  const plots = params.get("plots");
  const cap = params.get("maxStart");
  const capN = cap === null || cap === "" ? null : Number(cap);
  const earning = [...new Set(params.getAll("earning").flatMap((v) => v.split(",")).map((v) => v.trim()).filter((v) => /^[a-z0-9_]{1,64}$/.test(v)))];
  return {
    board: boardFrom(params.get("board")),
    kit: kitFromBoard(params.get("board")) ?? params.get("kit") === "1",
    sort: sort && SORT_KEYS.includes(sort) ? sort : "profit",
    plots: plots === "1" || plots === "2" || plots === "3" ? plots : "any",
    filters: {
      query: (params.get("q") ?? "").slice(0, 100),
      earning,
      earningIn: params.get("in") === "any" ? "any" : "top3",
      noUpkeep: params.get("noUpkeep") === "1",
      maxStartItems: capN !== null && Number.isInteger(capN) && capN >= 0 ? capN : null,
    },
  };
}

/** The URL query for the ranking: defaults are left out, so a plain /flows stays plain. */
export function writeListParams(p: ListParams): URLSearchParams {
  const out = new URLSearchParams();
  if (p.board) out.set("board", p.board);
  if (p.kit && p.board !== "normal") out.set("kit", "1");
  if (p.sort !== "profit") out.set("sort", p.sort);
  if (p.plots !== "any") out.set("plots", p.plots);
  const f = p.filters;
  if (f.query.trim()) out.set("q", f.query);
  for (const id of f.earning) out.append("earning", id);
  if (f.earning.length && f.earningIn === "any") out.set("in", "any");
  if (f.noUpkeep) out.set("noUpkeep", "1");
  if (f.maxStartItems !== null) out.set("maxStart", String(f.maxStartItems));
  return out;
}

// ---- The submit dialog's local test -------------------------------------------------------------

/** One seed of a local test: finished (ok or not) or still running (undefined). */
export interface LocalSeed {
  ok: boolean;
  error: string | null;
  /** Ironman: the borrow run ("with the starting items"); normal: the normal run. */
  result: RunResult | null;
  /** Ironman: the "from nothing" timeline. */
  fromNothing?: RunResult | null;
}

export interface LocalKindSummary {
  done: number;
  total: number;
  /** Seeds that failed (1-based seed number and the reason). */
  failed: { seed: number; error: string }[];
  /** The cell the server would build: the median seed by this board's valuation (null until every seed succeeded). */
  cell: RunResult | null;
  /** The cell's coins per day on the board. */
  profitPerDay: number | null;
  /** best / median over the seeds' window values (the outlier check). */
  ratio: number | null;
  /** "From nothing": the starting items can't be made within the run (the server lists the flow apart). */
  cantMake: PrepInfo | null;
}

/**
 * A local test of one cell kind, summarised the way the server builds a cell (`cellResult`,
 * `spreadRatio`): `ironman` reads each seed's `fromNothing`, the others its `result`. A seed
 * fails both ironman variants.
 */
export function localKindSummary(data: GameData, seeds: readonly (LocalSeed | undefined)[], kind: CellKind, quotes: Quotes, pricing: BazaarPricing): LocalKindSummary {
  const board = boardOfCellKind(kind);
  const value = (r: RunResult) => valueResult(data, r, board, board === "normal" ? quotes : {}, pricing).profitPerDay;
  const pick = (s: LocalSeed) => (kind === "ironman" ? (s.fromNothing ?? null) : s.result);
  const finished = seeds.filter((s): s is LocalSeed => !!s);
  const failed = seeds.flatMap((s, i) => (s && (!s.ok || !pick(s)) ? [{ seed: i + 1, error: s.error || "no result" }] : []));
  const results = finished.filter((s) => s.ok && pick(s)).map((s) => pick(s)!);
  const complete = results.length === seeds.length && seeds.length > 0;
  const cell = complete ? cellResult(results, value) : null;
  const ratio = complete ? spreadRatio(results.map(value)) : null;
  const prep = kind === "ironman" && cell ? readPrep(cell.prep) : null;
  return { done: finished.length, total: seeds.length, failed, cell, profitPerDay: cell ? value(cell) : null, ratio, cantMake: prep && !prep.done ? prep : null };
}

// ---- Detail page helpers ----------------------------------------------------------------------

/** A cell kind's cell (matched by `cellKind`, else what an older API sent: run kind strict / borrow or a board name). */
export function findCell(cells: readonly FlowCell[], kind: CellKind, tier: TierId, every: number): FlowCell | undefined {
  return cells.find((c) => c.tier === tier && c.every === every && cellKindOfRow(c) === kind);
}

/**
 * A cell's spread ratio (best / median over seeds) at `every`. The API sends one cell's
 * `{ratio, ...}` info, a map of those per frequency, or a bare number; `Infinity` for an
 * unbounded ratio (a median of 0 with some seed above it).
 */
export function spreadAt(spread: Spread | null | undefined, every: number): number | null {
  if (spread === null || spread === undefined) return null;
  if (typeof spread === "number") return spread;
  if ("ratio" in spread && !(String(every) in spread)) return spread.ratio === null ? Infinity : typeof spread.ratio === "number" ? spread.ratio : null;
  const v = (spread as Record<string, SpreadInfo | number>)[String(every)];
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return v.ratio === null ? Infinity : typeof v.ratio === "number" ? v.ratio : null;
  return null;
}

export interface FrequencyPoint {
  every: number;
  profitPerDay: number | null;
  /** Average effort per login at this frequency, when known (shown in the chart's tooltip). */
  effortAvg?: number | null;
}

/** Profit per day at every grid frequency of one cell kind / tier (null where no cell exists). */
export function profitByEvery(data: GameData, cells: readonly FlowCell[], kind: CellKind, tier: TierId, s: Omit<ViewSettings, "board" | "now">): FrequencyPoint[] {
  const board = boardOfCellKind(kind);
  return EVERY.map((every) => {
    const cell = findCell(cells, kind, tier, every);
    if (!cell) return { every, profitPerDay: null };
    const { result } = viewerResult(data, cell.median, s);
    return {
      every,
      profitPerDay: valueResult(data, result, board, board === "normal" ? s.quotes : {}, s.pricing).profitPerDay,
      effortAvg: result.effort?.sessions ? result.effort.avg : null,
    };
  });
}

export interface BoardNumber {
  kind: CellKind;
  /** Null when that cell kind has no cell at this tier / every yet. */
  profitPerDay: number | null;
  boughtPerDay: number;
  buildCost: number;
  slowing: boolean;
  /** "From nothing" only: how the starting items are made (null: unknown, an old cell). */
  prep: PrepInfo | null;
}

/** The detail page's three numbers: each cell kind's cell at `tier` (else max) and `every`, priced for the viewer. */
export function boardNumbers(data: GameData, cells: readonly FlowCell[], tier: TierId, every: number, s: Omit<ViewSettings, "board" | "now">): BoardNumber[] {
  return CELL_KINDS_IN_ORDER.map((kind) => {
    const board = boardOfCellKind(kind);
    const cell = findCell(cells, kind, tier, every) ?? findCell(cells, kind, "max", every);
    if (!cell) return { kind, profitPerDay: null, boughtPerDay: 0, buildCost: 0, slowing: false, prep: null };
    const { result } = viewerResult(data, cell.median, s);
    const v = valueResult(data, result, board, board === "normal" ? s.quotes : {}, s.pricing);
    return {
      kind,
      profitPerDay: v.profitPerDay,
      boughtPerDay: v.boughtPerDay,
      buildCost: v.buildCost,
      slowing: cell.median.slowing === true,
      prep: kind === "ironman" ? readPrep(cell.median.prep) : null,
    };
  });
}

const CELL_KINDS_IN_ORDER: readonly CellKind[] = ["ironman", "ironman_kit", "normal"];

/** The cell kind the detail page and the ranking show for a board and the starting-items switch. */
export const viewCellKind = (board: Board, kit: boolean): CellKind => cellKindOf(board, kit);

/** The ramp's second-half rate priced on a board (null without ramp data). */
export function steadyRate(data: GameData, r: RunResult, s: Pick<ViewSettings, "board" | "quotes" | "pricing" | "viewerStats" | "useMyStats">): number | null {
  if (!isRecord(r.ramp)) return null;
  return pricePoint(data, { produced: r.ramp.produced ?? {}, bought: r.ramp.bought ?? {} }, s);
}

/** Slack at `every` from the frequency points ("Forgiving: 92%"); null when not computable. */
export function slackFrom(points: readonly FrequencyPoint[], every: number): number | null {
  const at = (n: number) => {
    const p = points.find((x) => x.every === n);
    return p && p.profitPerDay !== null ? p.profitPerDay : undefined;
  };
  return slack(every, at, EVERY);
}

export interface ItemLine {
  item: ItemId;
  perDay: number;
  /** Unit price under the board; null when unpriced. */
  unitPrice: number | null;
  coinsPerDay: number;
  kind: "produced" | "bought";
}

/** Per-item value of one result, highest coins per day first (purchases as negative lines). */
export function itemBreakdown(data: GameData, r: RunResult, board: Board, quotes: Quotes, pricing: BazaarPricing): ItemLine[] {
  const lines: ItemLine[] = [];
  for (const [item, perDay] of Object.entries(r.produced)) {
    const unit = sellPrice(data, item, board, board === "normal" ? quotes : {}, pricing);
    lines.push({ item, perDay, unitPrice: unit, coinsPerDay: unit === null ? 0 : perDay * unit, kind: "produced" });
  }
  if (board === "normal") {
    for (const [item, perDay] of Object.entries(r.bought)) {
      const unit = buyPrice(item, quotes, pricing);
      lines.push({ item, perDay, unitPrice: unit, coinsPerDay: unit === null ? 0 : -perDay * unit, kind: "bought" });
    }
  }
  return lines.sort((a, b) => b.coinsPerDay - a.coinsPerDay || b.perDay - a.perDay || a.item.localeCompare(b.item));
}

export interface SourceLine {
  /** The plant kind that was harvested. */
  kind: ItemId;
  /** Harvests of it per day are not stored; this is the coins its drops bring per day. */
  coinsPerDay: number;
  /** Drops per day, by item. */
  items: Record<ItemId, number>;
  isMutation: boolean;
}

/**
 * Money by source: each harvested plant kind and the coins its drops bring, highest first. Reads
 * `bySource` (kind -> item -> per day, or totals from a live simulator run). Empty without it.
 */
export function moneyBySource(data: GameData, bySource: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined, board: Board, quotes: Quotes, pricing: BazaarPricing): SourceLine[] {
  if (!bySource) return [];
  const lines: SourceLine[] = [];
  for (const [kind, items] of Object.entries(bySource)) {
    let coins = 0;
    for (const [item, n] of Object.entries(items)) coins += n * (sellPrice(data, item, board, board === "normal" ? quotes : {}, pricing) ?? 0);
    lines.push({ kind, coinsPerDay: coins, items: { ...items }, isMutation: !!data.mutations[kind] });
  }
  return lines.sort((a, b) => b.coinsPerDay - a.coinsPerDay || a.kind.localeCompare(b.kind));
}

/**
 * The flow's target mutations ordered by how much their harvests earn (top first); targets that
 * earned nothing follow in the summary's order. Falls back to the summary order without `bySource`.
 */
export function earningTargets(data: GameData, targets: readonly ItemId[], bySource: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined, board: Board, quotes: Quotes, pricing: BazaarPricing): { id: ItemId; coinsPerDay: number | null }[] {
  const earned = new Map(moneyBySource(data, bySource, board, quotes, pricing).map((l) => [l.kind, l.coinsPerDay]));
  const all = [...new Set([...targets, ...[...earned.keys()].filter((k) => data.mutations[k])])];
  return all
    .map((id, i) => ({ id, coinsPerDay: earned.has(id) ? earned.get(id)! : null, i }))
    .sort((a, b) => (b.coinsPerDay ?? -1) - (a.coinsPerDay ?? -1) || a.i - b.i)
    .map(({ id, coinsPerDay }) => ({ id, coinsPerDay }));
}

/** "45 / 290". */
export function effortText(avg: number | null, peak: number | null): string {
  if (avg === null || peak === null) return "—";
  return `${Math.round(avg)} / ${Math.round(peak)}`;
}

export function percent(r: number | null): string {
  return r === null || !Number.isFinite(r) ? "—" : `${Math.round(r * 100)}%`;
}

/** Spread ratio as "1.24×" (∞ for a zero median). */
export function ratioText(r: number | null): string {
  if (r === null) return "—";
  if (!Number.isFinite(r)) return "∞";
  return `${r.toFixed(2)}×`;
}
