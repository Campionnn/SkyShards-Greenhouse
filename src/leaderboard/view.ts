import type { GameData, ItemId } from "../simulator/data/types";
import { DEFAULT_BAZAAR_PRICING, type BazaarPricing } from "../simulator/economy/bazaar";
import type { AuthUser, FlowAuthor, FlowCell, FlowListEntry, Spread, SpreadInfo, Timestamp } from "./api";
import { buyPrice, scaleResult, sellPrice, slack, valueResult, yieldStatsDiffer, type Quotes, type YieldStats } from "./pricing";
import type { RunResult } from "./result";
import type { Board } from "./rules";
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

export interface FlowRow {
  entry: FlowListEntry;
  rank: number;
  /** Null when the entry has no verified cell yet. */
  profitPerDay: number | null;
  revenuePerDay: number | null;
  boughtPerDay: number | null;
  buildCost: number | null;
  /** Ironman: Dead Plants / Fermento consumed per day (counts). */
  suppliesPerDay: Record<ItemId, number>;
  effortAvg: number | null;
  effortPeak: number | null;
  /** Only when the API provides it; the list has one frequency cell so it can't be derived. */
  slack: number | null;
  /** Counts were scaled to the viewer's yield stats (an estimate). */
  scaled: boolean;
  badges: RowBadges;
  unpriced: ItemId[];
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

/** Price one list entry for the viewer. */
export function flowRow(data: GameData, entry: FlowListEntry, s: ViewSettings): Omit<FlowRow, "rank"> {
  const created = toMillis(entry.createdAt);
  const badges: RowBadges = {
    stale: !!entry.stale,
    estimated: !!entry.estimated,
    new: Number.isFinite(created) && s.now - created >= 0 && s.now - created < NEW_FOR_MS,
  };
  const effort = entry.effort ?? entry.cell?.effort ?? null;
  const base = {
    entry,
    suppliesPerDay: suppliesOf(entry.cell),
    effortAvg: effort ? effort.avg : null,
    effortPeak: effort ? effort.peak : null,
    slack: typeof entry.slack === "number" ? entry.slack : null,
    badges,
  };
  if (!entry.cell) return { ...base, profitPerDay: null, revenuePerDay: null, boughtPerDay: null, buildCost: null, scaled: false, unpriced: [] };
  const { result, scaled } = viewerResult(data, entry.cell, s);
  const v = valueResult(data, result, s.board, s.board === "normal" ? s.quotes : {}, s.pricing ?? DEFAULT_BAZAAR_PRICING);
  return {
    ...base,
    profitPerDay: v.profitPerDay,
    revenuePerDay: v.revenuePerDay,
    boughtPerDay: v.boughtPerDay,
    buildCost: v.buildCost,
    scaled,
    unpriced: v.unpriced,
  };
}

/**
 * Standard competition ranks ("1, 2, 2, 4") over rows already sorted best first; rows without a
 * value share the last rank after every valued one.
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

/** Rows sorted by profit per day, best first (unverified entries last, by title), then ranked. */
export function rankEntries(data: GameData, entries: readonly FlowListEntry[], s: ViewSettings): FlowRow[] {
  const rows = entries.map((e) => flowRow(data, e, s));
  rows.sort((a, b) => {
    if (a.profitPerDay === null && b.profitPerDay === null) return a.entry.title.localeCompare(b.entry.title);
    if (a.profitPerDay === null) return 1;
    if (b.profitPerDay === null) return -1;
    return b.profitPerDay - a.profitPerDay || a.entry.title.localeCompare(b.entry.title);
  });
  return rank(rows);
}

/** Case-insensitive match on title or author name; ranks are kept from the full list. */
export function filterRows<T extends { entry: { title: string; author: FlowAuthor } }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.entry.title.toLowerCase().includes(q) || r.entry.author.name.toLowerCase().includes(q));
}

// ---- Detail page helpers ----------------------------------------------------------------------

export function findCell(cells: readonly FlowCell[], board: Board, tier: TierId, every: number): FlowCell | undefined {
  return cells.find((c) => c.board === board && c.tier === tier && c.every === every);
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
}

/** Profit per day at every grid frequency of one board / tier (null where no cell exists). */
export function profitByEvery(data: GameData, cells: readonly FlowCell[], board: Board, tier: TierId, s: Omit<ViewSettings, "board" | "now">): FrequencyPoint[] {
  return EVERY.map((every) => {
    const cell = findCell(cells, board, tier, every);
    if (!cell) return { every, profitPerDay: null };
    const { result } = viewerResult(data, cell.median, s);
    return { every, profitPerDay: valueResult(data, result, board, board === "normal" ? s.quotes : {}, s.pricing).profitPerDay };
  });
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
