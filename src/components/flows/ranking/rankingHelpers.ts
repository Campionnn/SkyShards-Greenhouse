import type { Board } from "../../../leaderboard/rules";
import { kitCount, percent, prepDays, suppliesText, upkeepLines, type FlowRow, type RowFilters, type SortKey } from "../../../leaderboard/view";
import type { StepLayout } from "../../../simulator/flow/types";
import { formatCoins, nameOf } from "../../simulator/format";

/** Non-component helpers for the /flows ranking (kept apart for fast refresh). */

/**
 * Desktop grid, shared by the header, the rows and the loading skeleton: # · layout · flow · earns +
 * upkeep · coins/day · effort · forgiving · likes · simulator · peek. Narrow containers drop the earns
 * column (earner and upkeep move under the title) and the effort word; wide ones widen the earns column.
 */
export const ROW_COLS =
  "grid-cols-[1.5rem_77px_minmax(0,1fr)_6rem_2.5rem_7.5rem_3.5rem_1.75rem_1.75rem] @min-[60rem]:grid-cols-[1.5rem_77px_minmax(0,1fr)_minmax(0,10.5rem)_6rem_5.5rem_7.5rem_3.5rem_1.75rem_1.75rem] @min-[80rem]:grid-cols-[1.5rem_77px_minmax(0,1fr)_minmax(0,16rem)_8rem_5.5rem_7.5rem_3.5rem_1.75rem_1.75rem]";

export const SORT_HINT: Record<SortKey, string> = {
  profit: "Coins per day at your stats and prices.",
  perEffort: "Coins per day for each point of work per login: the best return on your time.",
  effort: "The fewest actions per login first.",
  forgiving: "How much profit survives logging in late.",
  liked: "The most likes from players, all time.",
  liked30d: "The most likes given in the last 30 days.",
  newest: "Most recently submitted first.",
};

export const BOARD_INTRO: Record<"ironman" | "ironman_kit" | "normal", string> = {
  ironman: "From nothing: each flow's starting items are made first with the site's builder flow, then the flow runs; the time it takes counts. Upkeep is what it keeps needing every day.",
  ironman_kit: "As if you already own each flow's starting items. Upkeep is what it keeps needing every day.",
  normal: "Bazaar prices: shortfalls are bought and the starting layouts' cost is shown separately.",
};

/** The detail page's query for a row: the board, and the starting-items switch when on. */
export const boardQuery = (board: Board, kit: boolean) => `?board=${board}${board === "ironman" && kit ? "&kit=1" : ""}`;

/** Link state for the detail page's back link: the ranking's own query (sort, filters, …), restored on "Flow rankings". */
export interface RankingLinkState {
  rankingSearch: string;
}

export const flowHref = (id: string, board: Board, kit: boolean) => `/flows/${encodeURIComponent(id)}${boardQuery(board, kit)}`;
/**
 * The simulator link for an entry; `at` also opens that plot's step in the layout editor once the
 * flow is loaded (`plot` = plot id, `step` = 0-based step index; SimulatorPage reads both).
 */
export const simHref = (id: string, board: Board, kit: boolean, at?: { plot: number; step: number }) =>
  `/simulator?flow=${encodeURIComponent(id)}&board=${board}${board === "ironman" && kit ? "&kit=1" : ""}${at ? `&plot=${at.plot}&step=${at.step}` : ""}`;

/** The layout the flow spends the most time in (server-picked once verified), else plot 1's start. */
export function thumbOf(row: FlowRow) {
  const code = row.entry.summary?.plots.find((p) => p.thumb)?.thumb ?? null;
  return row.entry.thumb?.layout ?? (code ? { code } : null);
}

/** One picture in the peek: a plot and its layout. */
export interface PeekLayout {
  plot: number;
  layout: StepLayout;
  /** "88% of the time" (that plot's most-used layout), or "start layout" when its timing isn't known. */
  note: string;
}

/**
 * The peek's pictures, one per plot: each plot's most-used layout (`thumb.plots`, from the
 * verified run's time per step). Entries the API hasn't timed per plot fall back to the overall
 * most-used layout for its plot and the start layouts of the others.
 */
export function peekLayouts(row: FlowRow): PeekLayout[] {
  const { entry } = row;
  const timed = (share: number) => `${percent(share)} of the time`;
  if (entry.thumb?.plots?.length) return entry.thumb.plots.map((p) => ({ plot: p.plot, layout: p.layout, note: timed(p.share) }));
  const out: PeekLayout[] = [];
  for (const p of entry.summary?.plots ?? []) {
    if (entry.thumb && entry.thumb.plot === p.id) out.push({ plot: p.id, layout: entry.thumb.layout, note: timed(entry.thumb.share) });
    else if (p.thumb) out.push({ plot: p.id, layout: { code: p.thumb }, note: "start layout" });
  }
  if (!out.length) {
    const t = thumbOf(row);
    if (t) out.push({ plot: entry.thumb?.plot ?? 1, layout: t, note: entry.thumb ? timed(entry.thumb.share) : "start layout" });
  }
  return out;
}

/** A one-line plain-text taste of the description (Markdown marks stripped). */
export const excerptOf = (row: FlowRow) =>
  (row.entry.excerpt ?? "")
    .replace(/[#>*_`[\]()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "3 plots, 6 steps" (steps only when there are more than plots). */
export function shapeText(row: FlowRow): string {
  const steps = row.entry.summary?.steps ?? null;
  const plots = row.entry.plots;
  return `${plots} plot${plots === 1 ? "" : "s"}${steps !== null && steps > plots ? `, ${steps} steps` : ""}`;
}

/** The row's short starting-items fact: "59 starting items · made in ~5 days" / "No starting items". */
export function startShort(row: FlowRow): string | null {
  const p = row.prep;
  if (!p) return null;
  const n = kitCount(p.kit);
  if (!n) return "No starting items";
  const d = prepDays(p);
  return `${n.toLocaleString("en-US")} starting items · ${p.done ? (d < 1 ? "made in under a day" : `made in ~${Math.round(d)} days`) : "can't be made"}`;
}

/** Supplies: Ironman "12 dead plants/day to farm"; Normal "1.2M/day bought". Null when none. */
export function supplyText(row: FlowRow, board: Board): string | null {
  if (board === "normal") return row.boughtPerDay ? `${formatCoins(row.boughtPerDay)}/day bought` : null;
  const t = suppliesText(row.suppliesPerDay);
  return t === "none" ? null : `${t}/day to farm`;
}

/** A count rounded up ("you need at least this many"); fractions keep one significant digit. */
const countUp = (n: number) => (n >= 1 ? Math.ceil(n - 1e-9).toLocaleString("en-US") : n > 0 ? String(Number(n.toPrecision(1))) : "0");

/**
 * Ironman upkeep, short enough for a table cell: "256 Turtlellini +2 more/day" (null when it
 * grows back everything it uses, or on Normal, where shortfalls are bought). `full` lists every item.
 */
export function upkeepShort(row: FlowRow, board: Board): { short: string; full: string } | null {
  if (board !== "ironman" || !row.entry.cell) return null;
  const lines = upkeepLines(row.entry.cell.upkeep);
  if (!lines.length) return null;
  const first = `${countUp(lines[0].perDay)} ${nameOf(lines[0].item)}`;
  return {
    short: `${first}${lines.length > 1 ? ` +${lines.length - 1} more` : ""}/day`,
    full: `Upkeep: it needs these every day, on top of the starting items: ${lines.map((l) => `${countUp(l.perDay)} ${nameOf(l.item)}`).join(", ")}`,
  };
}

/** Forgiving as a percentage; above 100% (logging in later earns more) reads "100%+". */
export function forgivingText(slack: number | null): string {
  if (slack === null || !Number.isFinite(slack)) return "—";
  return slack > 1.005 ? "100%+" : `${Math.round(slack * 100)}%`;
}

export const FORGIVING_HINT = "How much of the profit survives logging in late (up to twice as late). Over 100%: logging in later earns more.";

/** Whether any client-side filter or the search is on (on Normal the Ironman-only ones don't count). */
export function filtersActive(f: RowFilters, board: Board): boolean {
  return f.query.trim() !== "" || f.earning.length > 0 || (board === "ironman" && (f.noUpkeep || f.maxStartItems !== null));
}

/** Facet counts over the board's ranked rows (the other filters ignored): earning (top 3 / anywhere), starting-item caps, no upkeep. */
export function facetCounts(rows: readonly FlowRow[]) {
  const top3: Record<string, number> = {};
  const anywhere: Record<string, number> = {};
  const caps: Record<string, number> = {};
  let noUpkeep = 0;
  for (const r of rows) {
    r.sources.forEach((s, i) => {
      anywhere[s.id] = (anywhere[s.id] ?? 0) + 1;
      if (i < 3) top3[s.id] = (top3[s.id] ?? 0) + 1;
    });
    if (!r.entry.cell) continue;
    if (r.upkeepPerDay <= 0) noUpkeep++;
    for (const cap of [0, 60, 200]) if (r.startItemsCount <= cap) caps[cap] = (caps[cap] ?? 0) + 1;
  }
  return { top3, anywhere, caps, noUpkeep };
}
export type FacetCounts = ReturnType<typeof facetCounts>;
