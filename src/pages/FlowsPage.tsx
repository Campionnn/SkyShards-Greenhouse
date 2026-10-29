import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Ban, ChevronDown, Code2, FlaskConical, Layers, RefreshCw, Search, Sprout, Trophy } from "lucide-react";
import { SlowingBadge, StallChip, StartingItemsLine, UpkeepValue } from "../components/flows/FlowChips";
import { AccountControl, AuthorLabel, Badge, LikeButton, PriceNote, StatsPanel } from "../components/flows/FlowControls";
import { FilterBar, OwnedImportDialog } from "../components/flows/FlowFilters";
import { EffortMeter, LayoutBoxes, MutationChip, Sparkline, SplitBar, SplitLegend } from "../components/flows/FlowVisuals";
import { useOwnedItems } from "../components/flows/flowsDisplay";
import { formatCoins, nameOf } from "../components/simulator/format";
import { InfoHint, useToast } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useFlowLikes, useLikeReplay } from "../hooks/useFlowLikes";
import { useFlowViewer } from "../hooks/useFlowViewer";
import type { FlowListResponse } from "../leaderboard/api";
import type { Board } from "../leaderboard/rules";
import {
  BADGE_TITLE,
  DEFAULT_FILTERS,
  haveText,
  kitListText,
  kitSummaryText,
  earningOptions,
  matchesFilters,
  maxProfit,
  percent,
  prepText,
  rankEntries,
  readListParams,
  SORT_BOARD,
  SORT_LABEL,
  sortRows,
  splitRanked,
  suppliesText,
  upkeepNeedText,
  withLikeCounts,
  writeListParams,
  type FlowRow,
  type ListParams,
  type RowFilters,
  type SortKey,
} from "../leaderboard/view";
import { listFlows } from "../services/flowsService";
import { defaultGameData } from "../simulator";

const DATA = defaultGameData();

type PlotsFilter = ListParams["plots"];

/** The current time, refreshed every minute (price age, `new` badges). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const RANK_STYLE: Record<number, string> = {
  1: "text-amber-300",
  2: "text-slate-200",
  3: "text-orange-300",
};

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; title?: string }> = ({ active, onClick, children, title }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    title={title}
    onClick={onClick}
    className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
      active ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200" : "border-transparent text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
    }`}
  >
    {children}
  </button>
);

const SORT_HINT: Record<SortKey, string> = {
  profit: "Coins per day at your stats and prices.",
  perEffort: "Coins per day for each point of work per login: the best return on your time.",
  effort: "The fewest actions per login first.",
  forgiving: "How much profit survives logging in late.",
  steady: "Coins per day over the second half of the run, once the flow is up and running.",
  upkeep: "The fewest items to supply every day first (ties by profit).",
  liked: "The most likes from players, all time.",
  liked30d: "The most likes given in the last 30 days.",
  newest: "Most recently submitted first.",
};

const RowBadges: React.FC<{ row: FlowRow }> = ({ row }) => (
  <>
    {row.badges.new && <Badge tone="new" title={BADGE_TITLE.new}>new</Badge>}
    {row.badges.stale && <Badge tone="stale" title={BADGE_TITLE.stale}>re-verifying</Badge>}
    {row.badges.estimated && <Badge tone="estimated" title={BADGE_TITLE.estimated}>max-tier stand-in</Badge>}
    {row.profitPerDay === null && <Badge tone="pending" title="Not verified at this tier and frequency yet.">pending</Badge>}
    {row.stall && <StallChip stall={row.stall} />}
    {row.slowing && <SlowingBadge />}
  </>
);

/** One ranked flow. */
interface RowLike {
  liked: boolean;
  busy: boolean;
  /** Omitted on the viewer's own flows (count only). */
  onToggle?: () => void;
  /** Logged out: a click asks to log in first instead of redirecting straight away. */
  needsLogin?: boolean;
}

/** The ranking's link query for a row: the board, and the starting-items switch when on. */
const boardQuery = (board: Board, kit: boolean) => `?board=${board}${board === "ironman" && kit ? "&kit=1" : ""}`;

/** One ranked flow (exported for the SSR tests: the page itself renders rows only after its fetch effect). */
export const FlowRowItem: React.FC<{ row: FlowRow; top: number; every: number; board: Board; kit?: boolean; index: number; like: RowLike; sort: SortKey }> = ({ row, top, every, board, kit = false, index, like, sort }) => {
  const navigate = useNavigate();
  const { entry } = row;
  const normal = board === "normal";
  const ironman = board === "ironman";
  const summary = entry.summary ?? null;
  // The layout the flow spends the most time in (server-picked once verified), else plot 1's start.
  const startCode = summary?.plots.find((p) => p.thumb)?.thumb ?? null;
  const thumbLayout = entry.thumb?.layout ?? (startCode ? { code: startCode } : null);
  const topEarning = row.earning.slice(0, 3);
  const moreTargets = row.earning.length - topEarning.length;
  const steps = summary?.steps ?? null;
  const supply = normal ? (row.boughtPerDay ? `${formatCoins(row.boughtPerDay)}/day supplies` : null) : (() => {
    const t = suppliesText(row.suppliesPerDay);
    return t === "none" ? null : `${t}/day to farm`;
  })();
  const query = boardQuery(board, kit);
  // The headline's tooltip on "with the starting items": the from-nothing number beside it.
  const headlineTitle = ironman && kit && row.altPerDay !== null ? `From nothing: ${formatCoins(row.altPerDay)}/day (making the starting items first)` : undefined;
  const open = () => navigate(`/flows/${entry.id}${query}`);
  // A one-line plain-text taste of the description (Markdown marks stripped).
  const excerpt = (entry.excerpt ?? "")
    .replace(/[#>*_`[\]()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    <li
      className="group relative grid cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-transparent px-2 py-3 transition-[background-color,border-color] duration-150 hover:border-slate-600/40 hover:bg-slate-800/50 sm:grid-cols-[2.25rem_auto_minmax(0,1fr)_auto] sm:px-3 flows-row-in"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
      onClick={open}
      data-testid="flow-row"
    >
      <div className={`pt-0.5 text-center text-lg font-semibold tabular-nums sm:self-center sm:pt-0 ${RANK_STYLE[row.rank] ?? "text-slate-500"}`}>{row.rank}</div>

      <div className="hidden self-center sm:block" title={entry.thumb ? `Plot ${entry.thumb.plot}'s most-used layout (${percent(entry.thumb.share)} of the time)` : undefined}>
        <LayoutBoxes layout={thumbLayout} cell={7} />
      </div>

      <div className="min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={`/flows/${entry.id}${query}`} onClick={(e) => e.stopPropagation()} className="break-words text-sm font-semibold text-slate-100 transition-colors group-hover:text-emerald-200">
              {entry.title}
            </Link>
            <RowBadges row={row} />
          </div>
          {/* Phones: the headline number sits beside the title. */}
          <div className="text-right sm:hidden">
            <div className={`text-base font-semibold tabular-nums leading-tight ${row.profitPerDay !== null && row.profitPerDay < 0 ? "text-red-300" : "text-amber-300"}`} title={headlineTitle}>
              {row.profitPerDay === null ? "—" : formatCoins(row.profitPerDay)}
            </div>
            <div className="text-[10px] text-slate-500">/ day</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          <AuthorLabel author={entry.author} size={16} />
          <span className="text-slate-600">·</span>
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3 w-3" /> {entry.plots} plot{entry.plots === 1 ? "" : "s"}
            {steps !== null && steps > entry.plots ? `, ${steps} steps` : ""}
          </span>
          {summary?.scripted && (
            <span className="inline-flex items-center gap-1 text-violet-300">
              <Code2 className="h-3 w-3" /> scripted
            </span>
          )}
          <LikeButton
            count={(sort === "liked30d" ? entry.likes30d : entry.likes) ?? 0}
            liked={like.liked}
            busy={like.busy}
            onToggle={like.onToggle}
            needsLogin={like.needsLogin}
            title={sort === "liked30d" ? `${entry.likes30d ?? 0} likes in the last 30 days (${entry.likes ?? 0} all time)` : undefined}
          />
        </div>
        {topEarning.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {topEarning.map((t) => (
              <MutationChip key={t.id} id={t.id} earning={t.coinsPerDay} />
            ))}
            {moreTargets > 0 && (
              <span className="rounded-md border border-slate-700/50 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-400" title={row.earning.slice(3).map((t) => nameOf(t.id)).join(", ")}>
                +{moreTargets}
              </span>
            )}
          </div>
        )}
        {ironman && row.prep && <StartingItemsLine prep={row.prep} className="max-w-xl text-xs" />}
        {excerpt && <p className="hidden max-w-xl truncate text-xs italic text-slate-500 md:block">“{excerpt}”</p>}
        <div className="max-w-xl pt-0.5">
          <SplitBar split={row.split} fraction={top > 0 && row.profitPerDay !== null ? row.profitPerDay / top : 0} />
          <SplitLegend split={row.split} className="mt-1" />
        </div>
      </div>

      {/* Numbers: a compact strip under the content on phones, a right-hand column from sm. */}
      <div className="col-span-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 sm:col-span-1 sm:block sm:min-w-[11rem] sm:text-right">
        <div className="hidden sm:block">
          <div className={`text-xl font-semibold tabular-nums leading-tight ${row.profitPerDay !== null && row.profitPerDay < 0 ? "text-red-300" : "text-amber-300"}`} title={headlineTitle}>
            {row.profitPerDay === null ? "—" : formatCoins(row.profitPerDay)}
          </div>
          <div className="text-[11px] text-slate-500">coins / day{row.scaled ? " · est." : ""}</div>
        </div>
        <div className="space-y-0.5 text-[11px] tabular-nums text-slate-400 sm:mt-1.5">
          {ironman && entry.cell && (
            <div data-testid="row-upkeep" className="sm:flex sm:justify-end" title={kitSummaryText(entry.cell)}>
              <span className="text-slate-500">Upkeep </span>
              <UpkeepValue upkeep={entry.cell.upkeep} className="ml-1" />
            </div>
          )}
          {supply && <div>{supply}</div>}
          {normal && row.buildCost !== null && row.buildCost > 0 && <div className="text-sky-300/90">{formatCoins(row.buildCost)} to build</div>}
          <div className="flex items-center gap-2 sm:justify-end">
            <EffortMeter avg={row.effortAvg} peak={row.effortPeak} />
            {row.slack !== null && (
              <span className="text-slate-400" title="Forgiving: how much of the profit survives logging in late">
                {percent(row.slack)} forgiving
              </span>
            )}
          </div>
        </div>
        <div className="sm:mt-2 sm:flex sm:justify-end">
          <Sparkline points={row.curve} selected={every} />
        </div>
      </div>

      <button
        type="button"
        className="absolute right-2 top-2 hidden rounded-md p-1 text-slate-500 opacity-0 transition-opacity duration-150 hover:bg-slate-700/60 hover:text-emerald-300 group-hover:opacity-100 lg:block"
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/simulator?flow=${encodeURIComponent(entry.id)}&board=${board}`);
        }}
        title="Open in simulator"
        aria-label="Open in simulator"
      >
        <FlaskConical className="h-4 w-4" />
      </button>
    </li>
  );
};

/**
 * A flow set apart from the "from nothing" ranking: its starting items can't be made within the run,
 * or it stops once they run out (upkeep it never grows). No rank, a muted line saying which, and its
 * "with the starting items" number.
 */
export const CantMakeRow: React.FC<{ row: FlowRow }> = ({ row }) => {
  const { entry } = row;
  const startCode = entry.summary?.plots.find((p) => p.thumb)?.thumb ?? null;
  const thumbLayout = entry.thumb?.layout ?? (startCode ? { code: startCode } : null);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-2 py-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-3" data-testid="cant-make-row">
      <div className="hidden opacity-60 sm:block" aria-hidden>
        <LayoutBoxes layout={thumbLayout} cell={4} />
      </div>
      <div className="min-w-0 space-y-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link to={`/flows/${entry.id}?board=ironman`} className="break-words font-medium text-slate-300 transition-colors hover:text-emerald-200">
            {entry.title}
          </Link>
          <span className="text-slate-500">
            <AuthorLabel author={entry.author} size={14} />
          </span>
        </div>
        {row.cantMake ? (
          <p className="text-amber-200/80" title={haveText(row.cantMake) ? `By then the builder had ${haveText(row.cantMake)}` : `Starting items: ${kitListText(row.cantMake.kit)}`}>
            {prepText(row.cantMake)}
          </p>
        ) : row.stops ? (
          <p className="text-amber-200/80" data-testid="stops-line" title={row.prep ? prepText(row.prep) : undefined}>
            Stops once its starting items run out{upkeepNeedText(entry.cell?.upkeep) ? `: it needs ${upkeepNeedText(entry.cell?.upkeep)} it doesn't grow` : ""}
          </p>
        ) : null}
      </div>
      <Link
        to={`/flows/${entry.id}?board=ironman&kit=1`}
        className="whitespace-nowrap rounded-md border border-slate-600/40 px-2 py-1 text-right text-[11px] text-slate-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-200"
        title="This flow when you already own the starting items"
      >
        {row.altPerDay !== null ? (
          <>
            <span className="tabular-nums text-amber-300">{formatCoins(row.altPerDay)}</span>
            <span className="text-slate-500">/day with the starting items</span>
          </>
        ) : (
          "With the starting items"
        )}
        <ArrowUpRight className="ml-0.5 inline h-3 w-3 opacity-70" />
      </Link>
    </li>
  );
};

/** The "from nothing" ranking's collapsed list of flows set apart (can't make its starting items in time, or stops without them). */
export const CantMakeSection: React.FC<{ rows: FlowRow[]; onSwitch: () => void; defaultOpen?: boolean }> = ({ rows, onSwitch, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-2 rounded-lg border border-slate-700/50 bg-slate-900/30" data-testid="cant-make-section">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
        <Ban className="h-3.5 w-3.5 text-slate-500" />
        <span className="font-medium text-slate-300">Not ranked from nothing ({rows.length})</span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-slate-700/40">
          <p className="px-3 pt-2 text-[11px] text-slate-500">
            From an empty inventory these flows either can't get their starting items before the scored part of the run, or stop earning once the
            starting items run out (they use items every day that they don't grow). They are ranked with{" "}
            <button type="button" className="text-emerald-300 hover:underline" onClick={onSwitch}>
              "I have the starting items"
            </button>
            .
          </p>
          <ul className="divide-y divide-slate-700/30 pb-1">
            {rows.map((r) => (
              <CantMakeRow key={r.entry.id} row={r} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

const Legend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-3 rounded-full bg-emerald-400/80" /> crops
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-3 rounded-full bg-amber-400/80" /> mutation items
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-3 rounded-full bg-sky-400/80" /> rare crops and drops
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-end gap-[2px]">
        {[40, 70, 100].map((h) => (
          <span key={h} className="w-1 rounded-sm bg-emerald-400/40" style={{ height: h / 10 + 3 }} />
        ))}
      </span>
      profit if you log in every 1, 2, 3, 4, 6, 8, 12 cycles
    </span>
  </div>
);

const BOARD_INTRO: Record<"ironman" | "ironman_kit" | "normal", string> = {
  ironman: "From nothing: each flow's starting items are made first with the site's builder flow, then the flow runs; the time it takes counts. Upkeep is what it keeps needing every day.",
  ironman_kit: "As if you already own each flow's starting items. Upkeep is what it keeps needing every day.",
  normal: "Bazaar prices: shortfalls are bought and the starting layouts' cost is shown separately.",
};

/** The ranking's URL state: board, sort, plots and every filter (defaults are left out of the URL). */
function useListParams(): [ListParams, (patch: Partial<ListParams>) => void] {
  const [search, setSearch] = useSearchParams();
  const params = useMemo(() => readListParams(search), [search]);
  const set = useCallback(
    (patch: Partial<ListParams>) => {
      setSearch((cur) => writeListParams({ ...readListParams(cur), ...patch }), { replace: true });
    },
    [setSearch]
  );
  return [params, set];
}

export const FlowsPage: React.FC = () => {
  const [params, setParams] = useListParams();
  const viewer = useFlowViewer({ board: params.board, onBoard: (board) => setParams({ board }), kit: params.kit, onKit: (kit) => setParams({ kit }) });
  const board = viewer.board;
  const kit = viewer.kit;
  const now = useMinuteClock();
  const { user } = useAuth();
  const likes = useFlowLikes();
  const { toast } = useToast();
  const [owned, setOwned] = useOwnedItems();
  const [importing, setImporting] = useState(false);
  useLikeReplay(
    useCallback(
      (_id: string, ok: boolean, error?: string) =>
        toast(ok ? { title: "Logged in and liked", variant: "success" } : { title: "Logged in, but the like wasn't saved", description: error, variant: "warning" }),
      [toast]
    )
  );
  const { plots, sort, filters } = params;
  // The search box types into local state; the URL follows (so typing doesn't push history entries per key).
  const [query, setQuery] = useState(filters.query);
  useEffect(() => setQuery(filters.query), [filters.query]);
  useEffect(() => {
    if (query === filters.query) return;
    const t = setTimeout(() => setParams({ filters: { ...filters, query } }), 250);
    return () => clearTimeout(t);
  }, [query, filters, setParams]);
  const setFilters = (patch: Partial<RowFilters>) => setParams({ filters: { ...filters, ...patch } });
  // A sort that only means something on another board falls back to profit here.
  const sortShown: SortKey = SORT_BOARD[sort] && SORT_BOARD[sort] !== board ? "profit" : sort;

  const [result, setResult] = useState<{ key: string; data?: FlowListResponse; error?: string } | null>(null);
  const [reload, setReload] = useState(0);
  /** The reload count already served: only a new Refresh click bypasses the session cache. */
  const servedReload = useRef(0);
  const key = `${board}|${kit ? 1 : 0}|${viewer.tier}|${viewer.every}|${plots}|${reload}`;

  useEffect(() => {
    let live = true;
    const force = reload !== servedReload.current;
    servedReload.current = reload;
    listFlows({ board, kit, tier: viewer.tier, every: viewer.every, plots: plots === "any" ? undefined : Number(plots) }, { force })
      .then((data) => live && setResult({ key, data }))
      .catch((e: unknown) => live && setResult({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [key, board, kit, viewer.tier, viewer.every, plots, reload]);

  const loading = !result || result.key !== key;
  const all = useMemo(() => (result && !loading ? (result.data?.entries ?? []) : []), [result, loading]);
  const entries = useMemo(() => withLikeCounts(all, likes.counts), [all, likes.counts]);
  const ranked = useMemo(
    () => rankEntries(DATA, entries, { board, kit, quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: true, now }, viewer.every),
    [entries, board, kit, viewer.quotes, viewer.bazaar.pricing, viewer.viewerStats, viewer.every, now]
  );
  const options = useMemo(() => earningOptions(ranked), [ranked]);
  const effective = useMemo<RowFilters>(() => ({ ...filters, query }), [filters, query]);
  const shown = useMemo(
    () => sortRows(ranked.filter((r) => matchesFilters(r, effective, board, owned?.items ?? null)), sortShown),
    [ranked, effective, board, owned, sortShown]
  );
  // "From nothing": flows whose starting items can't be made within the run take no place; they are listed apart (filtered and sorted the same way).
  const { ranked: shownRanked, cantMake: shownBlocked } = useMemo(() => splitRanked(shown), [shown]);
  const top = maxProfit(ranked);
  const filtered = effective.query.trim() !== "" || JSON.stringify({ ...effective, query: "" }) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="space-y-4 py-2 sm:py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
            <Trophy className="h-5 w-5 text-amber-400" /> Flow rankings
            <InfoHint title="How flows are ranked" width={360}>
              <p className="mb-1.5">
                Every flow was simulated by the server under the same rules (empty start, default settings, secret seeds) at each online frequency and
                four stat tiers. Ironman ranks from nothing: the site's builder makes the flow's starting items first, then the flow runs from exactly them.
                "I have the starting items" ranks as if you already own them. Normal uses the normal profile.
              </p>
              <p>The server stores item counts per day; your browser prices them for your board and stats, so the ranking follows your inputs instantly.</p>
            </InfoHint>
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">Greenhouse flows from the community, ranked for how you play.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountControl />
          <Link
            to="/simulator"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-[background-color,transform] duration-150 hover:bg-emerald-500/25 active:scale-[0.97]"
          >
            <Sprout className="h-3.5 w-3.5" /> Submit a flow <ArrowUpRight className="h-3 w-3 opacity-70" />
          </Link>
        </div>
      </header>

      <StatsPanel viewer={viewer} />

      <section className="rounded-lg border border-slate-600/30 bg-slate-800/40">
        <div className="space-y-2.5 border-b border-slate-700/40 px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Sort by">
              {(Object.keys(SORT_LABEL) as SortKey[])
                .filter((k) => !SORT_BOARD[k] || SORT_BOARD[k] === board)
                .map((k) => (
                  <Chip key={k} active={sortShown === k} onClick={() => setParams({ sort: k })} title={SORT_HINT[k]}>
                    {SORT_LABEL[k]}
                  </Chip>
                ))}
            </div>
            <label className="relative ml-auto w-full min-w-[12rem] sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                className="w-full rounded-md border border-slate-600/40 bg-slate-900/60 py-1.5 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                placeholder="Search flows, authors, crops"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search flows"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1" role="tablist" aria-label="Plots">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-slate-500">Plots</span>
              {(["any", "1", "2", "3"] as PlotsFilter[]).map((p) => (
                <Chip key={p} active={plots === p} onClick={() => setParams({ plots: p })}>
                  {p === "any" ? "Any" : p}
                </Chip>
              ))}
            </div>
            <FilterBar board={board} filters={filters} earningOptions={options} owned={owned} onChange={setFilters} onImportOwned={() => setImporting(true)} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2.5 sm:px-4">
          <Legend />
          <div className="flex items-center gap-3">
            <PriceNote viewer={viewer} now={now} />
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-50"
              onClick={() => setReload((n) => n + 1)}
              disabled={loading}
              title="Fetch the list again"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Reload
            </button>
          </div>
        </div>
        <p className="px-3 pt-1 text-[11px] text-slate-500 sm:px-4" data-testid="board-intro">
          {BOARD_INTRO[viewer.cellKind]}
        </p>
        {viewer.scaling && <p className="px-3 pt-1 text-[11px] text-amber-200/70 sm:px-4">Crop and rare-crop numbers are scaled to your yield stats (an estimate).</p>}
        {board === "ironman" && filters.owned && !owned && (
          <p className="px-3 pt-1 text-[11px] text-amber-200/80 sm:px-4">
            "I own the starting items" needs your items:{" "}
            <button type="button" className="text-emerald-300 hover:underline" onClick={() => setImporting(true)}>
              import them from Hypixel
            </button>
            .
          </p>
        )}
        {!loading && result?.data?.truncated && (
          <p className="px-3 pt-1 text-[11px] text-amber-200/70 sm:px-4" data-testid="truncated-note">
            Showing the {all.length.toLocaleString()} most recently updated flows; older ones aren't included.
          </p>
        )}

        <div className="p-1.5 sm:p-2">
          {loading ? (
            <ul className="space-y-1" aria-busy>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex animate-pulse items-center gap-3 px-3 py-3">
                  <div className="h-5 w-6 rounded bg-slate-700/40" />
                  <div className="h-[59px] w-[59px] rounded-md bg-slate-700/40" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/3 rounded bg-slate-700/40" />
                    <div className="h-2.5 w-1/2 rounded bg-slate-700/30" />
                    <div className="h-1.5 w-2/3 rounded bg-slate-700/30" />
                  </div>
                  <div className="hidden h-6 w-20 rounded bg-slate-700/40 sm:block" />
                </li>
              ))}
              <li className="sr-only">Loading the rankings...</li>
            </ul>
          ) : result?.error ? (
            <div className="space-y-2 py-10 text-center text-xs">
              <div className="text-red-300">Could not load the rankings: {result.error}</div>
              <button type="button" className="mx-auto inline-flex items-center gap-1 rounded-md border border-slate-600/40 px-2.5 py-1.5 text-slate-300 hover:bg-slate-700/60" onClick={() => setReload((n) => n + 1)}>
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          ) : ranked.length === 0 ? (
            <div className="space-y-1 py-12 text-center text-xs text-slate-400">
              <Trophy className="mx-auto mb-2 h-6 w-6 text-slate-600" />
              <div>
                No flows on this board
                {plots !== "any" ? ` with ${plots} plot${plots === "1" ? "" : "s"}` : ""} yet.
              </div>
              <div>
                Be the first: build one in the{" "}
                <Link to="/simulator" className="text-emerald-300 hover:underline">
                  simulator
                </Link>{" "}
                and press "Submit to leaderboard".
              </div>
            </div>
          ) : shown.length === 0 ? (
            <div className="space-y-2 py-10 text-center text-xs text-slate-400">
              <div>{effective.query.trim() ? `Nothing matches "${effective.query.trim()}" with these filters.` : "No flow on this board matches these filters."}</div>
              {filtered && (
                <button
                  type="button"
                  className="mx-auto inline-flex items-center gap-1 rounded-md border border-slate-600/40 px-2.5 py-1.5 text-slate-300 hover:bg-slate-700/60"
                  onClick={() => {
                    setQuery("");
                    setParams({ filters: DEFAULT_FILTERS });
                  }}
                >
                  Clear search and filters
                </button>
              )}
            </div>
          ) : (
            <>
            {shownRanked.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-slate-400">
                {filtered ? "No flow ranked from nothing matches these filters." : "No flow is ranked from nothing yet."}
              </p>
            )}
            <ol className="divide-y divide-slate-700/30" data-testid="flows-list">
              {shownRanked.map((row, i) => (
                <FlowRowItem
                  key={row.entry.id}
                  row={row}
                  top={top}
                  every={viewer.every}
                  board={board}
                  kit={kit}
                  index={i}
                  sort={sortShown}
                  like={{
                    liked: likes.isLiked(row.entry.id),
                    busy: likes.busy(row.entry.id),
                    needsLogin: !likes.loggedIn,
                    onToggle:
                      user?.id === row.entry.author.id
                        ? undefined
                        : () =>
                            void likes
                              .toggle(row.entry.id, !likes.isLiked(row.entry.id))
                              .catch((e: unknown) => toast({ title: "Could not save your like", description: e instanceof Error ? e.message : String(e), variant: "error" })),
                  }}
                />
              ))}
            </ol>
            {shownBlocked.length > 0 && <CantMakeSection rows={shownBlocked} onSwitch={() => viewer.setKit(true)} />}
            </>
          )}
        </div>
      </section>
      {importing && (
        <OwnedImportDialog
          owned={owned}
          onSave={(o) => {
            setOwned(o);
            if (o) setFilters({ owned: true });
          }}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  );
};
