import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowUpRight, MoreHorizontal, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { AccountControl, BoardToggle, KitSwitch } from "../components/flows/FlowControls";
import { FilterBar, PlotsField, type PlotsFilter } from "../components/flows/FlowFilters";
import { FlowRowItem, PhoneRowItem } from "../components/flows/ranking/RankingRow";
import { KeyButton, ListEmpty, ListError, ListNoMatch, ListSkeleton, PricesChip, ReloadButton, SortHead, SortMenu } from "../components/flows/ranking/RankingParts";
import { EFFORT_HINT } from "../components/flows/flowsDisplay";
import { BazaarPriceDialog } from "../components/simulator/BazaarPanels";
import { CantMakeSection, NoneOfSection } from "../components/flows/ranking/SetApart";
import { nameOf } from "../components/simulator/format";
import { BOARD_INTRO, facetCounts, filtersActive, ROW_COLS, sortHint } from "../components/flows/ranking/rankingHelpers";
import { PHONE_QUERY, useMedia } from "../components/flows/ranking/useMedia";
import { FrequencyPicker } from "../components/flows/stats/FrequencyPicker";
import { StatsDrawer } from "../components/flows/stats/StatsDrawer";
import { isDefaultStats, statsSummary } from "../components/flows/stats/statsSummary";
import { InfoHint, useToast } from "../components/ui";
import { cn } from "../components/ui/cn";
import { KitButton, KitInput } from "../components/ui/kit";
import { Dropdown, MenuItem } from "../components/ui/Popover";
import { useAuth } from "../hooks/useAuth";
import { useFlowLikes, useLikeReplay } from "../hooks/useFlowLikes";
import { useFlowViewer, type FlowViewer } from "../hooks/useFlowViewer";
import type { FlowListResponse } from "../leaderboard/api";
import { cycleHours } from "../leaderboard/tiers";
import { RankByControl } from "../components/flows/ranking/RankByControl";
import {
  CELL_KIND_LABEL,
  DEFAULT_FILTERS,
  earningOptions,
  listMetric,
  matchesFilters,
  maxValue,
  metricName,
  metricUnit,
  rankEntries,
  readListParams,
  sortRows,
  splitRanked,
  tradedItems,
  withLikeCounts,
  writeListParams,
  type FlowRow,
  type ListParams,
  type RankMetric,
  type RowFilters,
  type SortKey,
} from "../leaderboard/view";
import { listFlows } from "../services/flowsService";
import { defaultGameData } from "../simulator";

/**
 * /flows: the flow rankings (research/flows-v2, direction A "Scan the board"). The list leads: a
 * thin toolbar (board, starting items, your-stats chip, search), the login frequency inline, filter
 * chips, then a sortable table whose rows peek open in place. "Your stats" is a drawer.
 * Every number is priced in the browser (`rankEntries`) for the viewer's board and stats.
 */

const DATA = defaultGameData();

/** The current time, refreshed every minute (price age, `new` badges). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The ranking's URL state: board, sort, plots and every filter (defaults are left out of the URL). */
function useListParams(): [ListParams, (patch: Partial<ListParams>) => void] {
  const [search, setSearch] = useSearchParams();
  const params = useMemo(() => readListParams(search), [search]);
  const set = useCallback(
    (patch: Partial<ListParams>) => {
      setSearch((cur) => writeListParams({ ...readListParams(cur), ...patch }), { replace: true });
    },
    [setSearch],
  );
  return [params, set];
}

const HowRanked: React.FC = () => (
  <InfoHint title="How flows are ranked" width={360} label="How flows are ranked">
    <p>
      Every flow was simulated by the server under the same rules (empty start, default settings, secret seeds) at each online frequency and four stat tiers. Ironman ranks from nothing: the site's builder makes the flow's starting
      items first, then the flow runs from exactly them. "I have the starting items" ranks as if you already own them. Normal uses the normal profile.
    </p>
    <p>The server stores item counts per day; your browser prices them for your board and stats, so the ranking follows your inputs instantly.</p>
  </InfoHint>
);

/** "Max tier · 3,059 FF" opens the drawer; while the stats are the defaults it says the numbers are for max stats. */
const StatsChip: React.FC<{ viewer: FlowViewer; onOpen: () => void; className?: string }> = ({ viewer, onOpen, className }) => {
  const max = isDefaultStats(viewer);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      title={max ? "Every number here is for maxed stats. Set yours (or import them from Hypixel) to rank for you" : "Your stats: tier, yield, armor"}
      className={cn(
        "focus-ring inline-flex h-8 min-w-0 shrink cursor-pointer items-center gap-1.5 rounded-control border px-2.5 text-body font-medium transition-colors duration-(--duration-hover) pointer-coarse:h-11",
        max ? "border-go/35 bg-go/10 text-go-fg hover:bg-go/20" : "border-line-control bg-surface-well text-fg hover:bg-surface-panel",
        className,
      )}
      data-testid="stats-chip"
    >
      <SlidersHorizontal aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate tabular-nums">{max ? "Max stats · set yours" : statsSummary(viewer)}</span>
    </button>
  );
};

const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; className?: string }> = ({ value, onChange, className }) => (
  <label className={cn("relative block min-w-0", className)}>
    <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-meta" />
    <KitInput type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search flows, authors, crops" aria-label="Search flows" className="w-full pl-8 pointer-coarse:h-11" />
  </label>
);

const submitLink =
  "focus-ring hit-area inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-control px-3 text-body font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover";

export const FlowsPage: React.FC = () => {
  const [params, setParams] = useListParams();
  const viewer = useFlowViewer({ board: params.board, onBoard: (board) => setParams({ board }), kit: params.kit, onKit: (kit) => setParams({ kit }) });
  const board = viewer.board;
  const kit = viewer.kit;
  const now = useMinuteClock();
  const { user } = useAuth();
  const likes = useFlowLikes();
  const { toast } = useToast();
  const location = useLocation();
  const phone = useMedia(PHONE_QUERY);
  useLikeReplay(
    useCallback(
      (_id: string, ok: boolean, error?: string) =>
        toast(ok ? { title: "Logged in and liked", variant: "success" } : { title: "Logged in, but the like wasn't saved", description: error, variant: "warning" }),
      [toast],
    ),
  );
  const { plots, sort, filters } = params;
  const metric = useMemo(() => listMetric(params), [params]);
  const setMetric = (m: RankMetric) => setParams({ by: m.by, crop: m.crop });
  // The search box types into local state; the URL follows (so typing doesn't push history entries per key).
  const [query, setQuery] = useState(filters.query);
  useEffect(() => setQuery(filters.query), [filters.query]);
  useEffect(() => {
    if (query === filters.query) return;
    const t = setTimeout(() => setParams({ filters: { ...filters, query } }), 250);
    return () => clearTimeout(t);
  }, [query, filters, setParams]);
  const setFilters = (patch: Partial<RowFilters>) => setParams({ filters: { ...filters, ...patch } });
  const setSort = (k: SortKey) => setParams({ sort: k });
  const setPlots = (p: PlotsFilter) => setParams({ plots: p });
  const [statsOpen, setStatsOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);

  const [result, setResult] = useState<{ key: string; data?: FlowListResponse; error?: string } | null>(null);
  const [reload, setReload] = useState(0);
  /** The reload count already served: only a new Reload click bypasses the session cache. */
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
    () =>
      rankEntries(DATA, entries, { board, kit, hideStalling: filters.noStall, quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: true, now, metric }, viewer.every),
    [entries, board, kit, filters.noStall, viewer.quotes, viewer.bazaar.pricing, viewer.viewerStats, viewer.every, now, metric],
  );
  const options = useMemo(() => earningOptions(ranked), [ranked]);
  const effective = useMemo<RowFilters>(() => ({ ...filters, query }), [filters, query]);
  const shown = useMemo(() => sortRows(ranked.filter((r) => matchesFilters(r, effective, board)), sort), [ranked, effective, board, sort]);
  // "From nothing": flows whose starting items can't be made (or that stop) take no place; they are listed apart (filtered and sorted the same way).
  // Ranked by a collection: flows that make none of the crop take no place either; they are listed after, collapsed.
  const { ranked: shownRanked, cantMake: shownBlocked, none: shownNone } = useMemo(() => splitRanked(shown), [shown]);
  const allSplit = useMemo(() => splitRanked(ranked), [ranked]);
  // Filter counts cover every flow the list can show (a crop ranking's "don't make" rows too), so they don't change with the crop.
  const listed = useMemo(() => [...allSplit.ranked, ...allSplit.none], [allSplit]);
  const counts = useMemo(() => facetCounts(listed), [listed]);
  // With the starting items: flows that stall from nothing (they need a large stockpile), counted whether or not they are set apart.
  const stockpileCount = useMemo(() => ranked.filter((r) => r.stallsFromNothing === true).length, [ranked]);
  const stockpileMode = board === "ironman" && kit;
  const plotCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of listed) out[String(r.entry.plots)] = (out[String(r.entry.plots)] ?? 0) + 1;
    return out;
  }, [listed]);
  const top = maxValue(ranked);
  const filtered = filtersActive(effective, board);
  const clearAll = () => {
    setQuery("");
    setParams({ filters: DEFAULT_FILTERS });
  };
  const rankingSearch = location.search;

  const likeFor = (row: FlowRow) => ({
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
  });

  const Row = phone ? PhoneRowItem : FlowRowItem;
  const hoursPerCycle = cycleHours(viewer.stats);
  const rowOf = (row: FlowRow, i: number) => (
    <Row
      key={row.entry.id}
      row={row}
      top={top}
      metric={metric}
      every={viewer.every}
      board={board}
      kit={kit}
      index={i}
      sort={sort}
      like={likeFor(row)}
      open={peek === row.entry.id}
      onPeek={() => setPeek((p) => (p === row.entry.id ? null : row.entry.id))}
      rankingSearch={rankingSearch}
      hoursPerCycle={hoursPerCycle}
      onEvery={viewer.setEvery}
    />
  );
  const crop = nameOf(metric.crop);
  const nothingRanked = shownNone.length
    ? filtered
      ? `No flow that makes ${crop} matches these filters.`
      : `No flow makes ${crop} yet.`
    : stockpileMode
      ? filtered
        ? "No flow that runs without a stockpile matches these filters."
        : "No flow runs without a stockpile yet."
      : filtered
        ? "No flow ranked from nothing matches these filters."
        : "No flow is ranked from nothing yet.";
  const list = loading ? (
    <ListSkeleton phone={phone} />
  ) : result?.error ? (
    <ListError error={result.error} onRetry={() => setReload((n) => n + 1)} />
  ) : ranked.length === 0 ? (
    <ListEmpty plots={plots} />
  ) : shown.length === 0 ? (
    <ListNoMatch query={effective.query} onClear={filtered ? clearAll : undefined} />
  ) : (
    <>
      {shownRanked.length === 0 && <p className="py-6 text-center text-body text-fg-muted">{nothingRanked}</p>}
      <ol data-testid="flows-list">{shownRanked.map(rowOf)}</ol>
      {shownNone.length > 0 && (
        <NoneOfSection key={`${metric.crop}-${shownRanked.length === 0 ? "only" : "rest"}`} crop={metric.crop} count={shownNone.length} defaultOpen={shownRanked.length === 0}>
          {shownNone.map(rowOf)}
        </NoneOfSection>
      )}
      {shownBlocked.length > 0 && (
        <CantMakeSection
          key={shownRanked.length === 0 ? "only" : "rest"}
          rows={shownBlocked}
          stockpile={stockpileMode}
          onSwitch={stockpileMode ? () => setFilters({ noStall: false }) : () => viewer.setKit(true)}
          defaultOpen={shownRanked.length === 0}
          rankingSearch={rankingSearch}
          phone={phone}
        />
      )}
    </>
  );

  const truncated = !loading && result?.data?.truncated && (
    <p className="text-meta text-warn" data-testid="truncated-note">
      Showing the {all.length.toLocaleString("en-US")} most recently updated flows; older ones aren't included.
    </p>
  );

  const counted = !loading && !result?.error && (
    <span className="text-secondary tabular-nums text-fg-meta">
      {allSplit.ranked.length} ranked{allSplit.cantMake.length ? ` · ${allSplit.cantMake.length} set apart` : ""}
      {allSplit.none.length ? ` · ${allSplit.none.length} without ${nameOf(metric.crop)}` : ""}
    </span>
  );

  const boardHint = (
    <InfoHint title={CELL_KIND_LABEL[viewer.cellKind]} label="About this board">
      <span data-testid="board-intro">{BOARD_INTRO[viewer.cellKind]}</span>
    </InfoHint>
  );

  const normal = board === "normal";
  const editPrices = normal ? () => setPricesOpen(true) : undefined;
  // The editor lists what the loaded flows trade first; "All items" adds the rest.
  const traded = useMemo(() => tradedItems(all.map((e) => e.cell)), [all]);
  const pricesDialog = normal && pricesOpen && (
    <BazaarPriceDialog bazaar={viewer.bazaar} focusItem={null} itemIds={traded} scope="These flows" withSides onClose={() => setPricesOpen(false)} />
  );

  const drawer = (
    <StatsDrawer
      viewer={viewer}
      open={statsOpen}
      onClose={() => setStatsOpen(false)}
      footer={
        <KitButton variant="primary" size={phone ? "touch" : "md"} className="w-full" onClick={() => setStatsOpen(false)}>
          {loading ? "Show the flows" : `Show ${listed.length} flows`}
        </KitButton>
      }
    />
  );

  if (phone)
    return (
      <div className="@container space-y-2.5 pb-6">
        <header className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <h1 className="text-title text-fg">Layout rankings</h1>
            <HowRanked />
          </div>
          <div className="flex items-center gap-1">
            <AccountControl />
            <Dropdown
              look="plain"
              chevron={false}
              label="More"
              width={210}
              align="end"
              className="focus-ring grid size-11 cursor-pointer place-items-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover"
              button={<MoreHorizontal aria-hidden className="size-4" />}
            >
              {(close) => (
                <>
                  <Link to="/simulator" role="menuitem" tabIndex={-1} className="focus-ring-inset flex h-11 items-center gap-2 rounded-inner px-2 text-body text-fg-body hover:bg-surface-hover" onClick={close}>
                    <ArrowUpRight aria-hidden className="size-3.5 text-fg-meta" /> Submit a flow
                  </Link>
                  <MenuItem icon={<RefreshCw />} disabled={loading} onSelect={() => (setReload((n) => n + 1), close())}>
                    Reload the list
                  </MenuItem>
                </>
              )}
            </Dropdown>
          </div>
        </header>
        <div className="flex items-center gap-2">
          <BoardToggle viewer={viewer} />
          {boardHint}
          <StatsChip viewer={viewer} onOpen={() => setStatsOpen(true)} className="flex-1" />
        </div>
        <FrequencyPicker viewer={viewer} className="[&>[role=radiogroup]]:flex-1" />
        <RankByControl metric={metric} onMetric={setMetric} phone />
        <SearchBox value={query} onChange={setQuery} />
        <FilterBar
          board={board}
          filters={filters}
          earningOptions={options}
          counts={counts}
          kit={kit}
          stockpileCount={stockpileCount}
          onChange={setFilters}
          plots={plots}
          onPlots={setPlots}
          plotCounts={plotCounts}
          className="overflow-x-auto pb-0.5 scrollbar-none"
          lead={
            <>
              <SortMenu sort={sort} onSort={setSort} all metric={metric} />
              {board === "ironman" && <KitSwitch viewer={viewer} className="shrink-0 px-1 whitespace-nowrap" />}
            </>
          }
        />
        <div className="flex items-center justify-between gap-2 border-b border-line pb-1">
          {counted || <span />}
          <span className="flex items-center gap-1">
            {editPrices && <PricesChip viewer={viewer} onOpen={editPrices} compact />}
            <KeyButton viewer={viewer} now={now} onEditPrices={editPrices} />
          </span>
        </div>
        {truncated}
        {list}
        {drawer}
        {pricesDialog}
      </div>
    );

  return (
    <div className="@container space-y-3 py-2 sm:py-3">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-hero text-fg">Layout rankings</h1>
          <HowRanked />
          {counted}
        </div>
        <div className="flex items-center gap-2">
          <AccountControl />
          <Link to="/simulator" className={submitLink}>
            Submit a flow <ArrowUpRight aria-hidden className="size-3.5 text-fg-meta" />
          </Link>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2" data-testid="viewer-tools">
        <BoardToggle viewer={viewer} />
        {boardHint}
        <KitSwitch viewer={viewer} className="mr-1" />
        <StatsChip viewer={viewer} onOpen={() => setStatsOpen(true)} className="max-w-[17rem]" />
        {editPrices && <PricesChip viewer={viewer} onOpen={editPrices} />}
        <SearchBox value={query} onChange={setQuery} className="ml-auto max-w-[15rem] min-w-[10rem] flex-1" />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* Frequency first: its position never depends on the rank-by control's width. */}
        <FrequencyPicker viewer={viewer} />
        <RankByControl metric={metric} onMetric={setMetric} />
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <FilterBar
          board={board}
          filters={filters}
          earningOptions={options}
          counts={counts}
          kit={kit}
          stockpileCount={stockpileCount}
          onChange={setFilters}
          className="flex-wrap"
          lead={<PlotsField value={plots} onChange={setPlots} counts={plotCounts} />}
        />
        <span className="ml-auto flex items-center gap-1.5">
          <SortMenu sort={sort} onSort={setSort} metric={metric} />
          <span aria-hidden className="h-4 w-px bg-line" />
          <KeyButton viewer={viewer} now={now} onEditPrices={editPrices} />
          <ReloadButton loading={loading} onReload={() => setReload((n) => n + 1)} />
        </span>
      </div>
      {truncated}
      <div role="table" aria-label="Ranked flows" aria-busy={loading || undefined}>
        <div role="row" className={cn("grid items-center gap-x-3 border-b border-line px-2 pb-1.5", ROW_COLS)}>
          <span role="columnheader" className="text-right text-label text-fg-meta" title={`Rank by ${metricName(metric).toLowerCase()} per day`}>
            #
          </span>
          <span role="columnheader">
            <span className="sr-only">Layout</span>
          </span>
          <span role="columnheader" className="text-label uppercase text-fg-meta">
            Flow
          </span>
          <span role="columnheader" className="hidden text-label uppercase text-fg-meta @min-[60rem]:block">
            {board === "ironman" ? "Earns most · upkeep" : "Earns most"}
          </span>
          <SortHead sort={sort} k="profit" onSort={setSort} label={metric.by === "coins" ? "profit" : metricName(metric).toLowerCase()} hintText={sortHint("profit", metric)} align="end">
            {/* The unit sits under every number, so a long one ("Farming XP/day") is just the name here. */}
            <span className="truncate" title={metricUnit(metric)}>
              {metric.by === "coins" ? "Coins/day" : metricName(metric)}
            </span>
          </SortHead>
          <SortHead sort={sort} k="effort" onSort={setSort} label="least effort" hint={<InfoHint title="Effort" label="What effort means" className="hidden @min-[60rem]:inline-flex">{EFFORT_HINT}</InfoHint>}>
            Effort
          </SortHead>
          <SortHead sort={sort} k="forgiving" onSort={setSort} label="most forgiving">
            Forgiving
          </SortHead>
          <SortHead sort={sort} k="liked" onSort={setSort} label="most liked">
            Likes
          </SortHead>
          <span role="columnheader">
            <span className="sr-only">Open in simulator</span>
          </span>
          <span role="columnheader">
            <span className="sr-only">Details</span>
          </span>
        </div>
        {list}
      </div>
      {drawer}
      {pricesDialog}
    </div>
  );
};
