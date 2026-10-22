import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Code2, FlaskConical, Layers, RefreshCw, Search, Sprout, Trophy } from "lucide-react";
import { AuthorLabel, Badge, LikeButton, PriceNote, StatsPanel } from "../components/flows/FlowControls";
import { EffortMeter, LayoutBoxes, MutationChip, Sparkline, SplitBar, SplitLegend } from "../components/flows/FlowVisuals";
import { formatCoins, nameOf } from "../components/simulator/format";
import { InfoHint, useToast } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useFlowLikes } from "../hooks/useFlowLikes";
import { useFlowViewer } from "../hooks/useFlowViewer";
import type { FlowListResponse } from "../leaderboard/api";
import { BADGE_TITLE, filterRows, maxProfit, percent, rankEntries, SORT_LABEL, sortRows, splitSolvent, suppliesText, withLikeCounts, type FlowRow, type SortKey } from "../leaderboard/view";
import { PAYBACK_CYCLES } from "../leaderboard/rules";
import { listFlows } from "../services/flowsService";
import { defaultGameData } from "../simulator";

const DATA = defaultGameData();

type PlotsFilter = "any" | "1" | "2" | "3";

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
  </>
);

/** One ranked flow. */
interface RowLike {
  liked: boolean;
  busy: boolean;
  /** Omitted on the viewer's own flows (count only). */
  onToggle?: () => void;
}

const FlowRowItem: React.FC<{ row: FlowRow; top: number; every: number; normal: boolean; index: number; like: RowLike; sort: SortKey }> = ({ row, top, every, normal, index, like, sort }) => {
  const navigate = useNavigate();
  const { entry } = row;
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
  const open = () => navigate(`/flows/${entry.id}`);
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
            <Link to={`/flows/${entry.id}`} onClick={(e) => e.stopPropagation()} className="break-words text-sm font-semibold text-slate-100 transition-colors group-hover:text-emerald-200">
              {entry.title}
            </Link>
            <RowBadges row={row} />
          </div>
          {/* Phones: the headline number sits beside the title. */}
          <div className="text-right sm:hidden">
            <div className={`text-base font-semibold tabular-nums leading-tight ${row.profitPerDay !== null && row.profitPerDay < 0 ? "text-red-300" : "text-amber-300"}`}>
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
        {excerpt && <p className="hidden max-w-xl truncate text-xs italic text-slate-500 md:block">“{excerpt}”</p>}
        <div className="max-w-xl pt-0.5">
          <SplitBar split={row.split} fraction={top > 0 && row.profitPerDay !== null ? row.profitPerDay / top : 0} />
          <SplitLegend split={row.split} className="mt-1" />
        </div>
      </div>

      {/* Numbers: a compact strip under the content on phones, a right-hand column from sm. */}
      <div className="col-span-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 sm:col-span-1 sm:block sm:min-w-[11rem] sm:text-right">
        <div className="hidden sm:block">
          <div className={`text-xl font-semibold tabular-nums leading-tight ${row.profitPerDay !== null && row.profitPerDay < 0 ? "text-red-300" : "text-amber-300"}`}>
            {row.profitPerDay === null ? "—" : formatCoins(row.profitPerDay)}
          </div>
          <div className="text-[11px] text-slate-500">coins / day{row.scaled ? " · est." : ""}</div>
        </div>
        <div className="space-y-0.5 text-[11px] tabular-nums text-slate-400 sm:mt-1.5">
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
          navigate(`/simulator?flow=${encodeURIComponent(entry.id)}`);
        }}
        title="Open in simulator"
        aria-label="Open in simulator"
      >
        <FlaskConical className="h-4 w-4" />
      </button>
    </li>
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

export const FlowsPage: React.FC = () => {
  const viewer = useFlowViewer();
  const now = useMinuteClock();
  const { user } = useAuth();
  const likes = useFlowLikes();
  const { toast } = useToast();
  const [plots, setPlots] = useState<PlotsFilter>("any");
  const [sort, setSort] = useState<SortKey>("profit");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ key: string; data?: FlowListResponse; error?: string } | null>(null);
  const [reload, setReload] = useState(0);
  /** The reload count already served: only a new Refresh click bypasses the session cache. */
  const servedReload = useRef(0);
  const key = `${viewer.board}|${viewer.tier}|${viewer.every}|${plots}|${reload}`;

  useEffect(() => {
    let live = true;
    const force = reload !== servedReload.current;
    servedReload.current = reload;
    listFlows({ board: viewer.board, tier: viewer.tier, every: viewer.every, plots: plots === "any" ? undefined : Number(plots) }, { force })
      .then((data) => live && setResult({ key, data }))
      .catch((e: unknown) => live && setResult({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [key, viewer.board, viewer.tier, viewer.every, plots, reload]);

  const loading = !result || result.key !== key;
  const all = useMemo(() => (result && !loading ? (result.data?.entries ?? []) : []), [result, loading]);
  // Ironman: cells that don't pay their starting layout back in time are left out of this frequency's ranking.
  const { solvent: entries, insolvent } = useMemo(() => splitSolvent(withLikeCounts(all, likes.counts)), [all, likes.counts]);
  const ranked = useMemo(
    () =>
      rankEntries(
        DATA,
        entries,
        { board: viewer.board, quotes: viewer.quotes, pricing: viewer.bazaar.pricing, viewerStats: viewer.viewerStats, useMyStats: true, now },
        viewer.every
      ),
    [entries, viewer.board, viewer.quotes, viewer.bazaar.pricing, viewer.viewerStats, viewer.every, now]
  );
  const shown = useMemo(() => sortRows(filterRows(ranked, query), sort), [ranked, query, sort]);
  const top = maxProfit(ranked);
  const normal = viewer.board === "normal";

  return (
    <div className="space-y-4 py-2 sm:py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
            <Trophy className="h-5 w-5 text-amber-400" /> Flow rankings
            <InfoHint title="How flows are ranked" width={340}>
              <p className="mb-1.5">
                Every flow was simulated by the server under the same rules (empty start, default settings, secret seeds) at each online frequency and
                four stat tiers.
              </p>
              <p>The server stores item counts per day; your browser prices them for your board and stats, so the ranking follows your inputs instantly.</p>
            </InfoHint>
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">Greenhouse flows from the community, ranked for how you play.</p>
        </div>
        <Link
          to="/simulator"
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-[background-color,transform] duration-150 hover:bg-emerald-500/25 active:scale-[0.97]"
        >
          <Sprout className="h-3.5 w-3.5" /> Submit a flow <ArrowUpRight className="h-3 w-3 opacity-70" />
        </Link>
      </header>

      <StatsPanel viewer={viewer} />

      <section className="rounded-lg border border-slate-600/30 bg-slate-800/40">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-700/40 px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Sort by">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <Chip key={k} active={sort === k} onClick={() => setSort(k)} title={SORT_HINT[k]}>
                {SORT_LABEL[k]}
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-1" role="tablist" aria-label="Plots">
            <span className="mr-1 text-[11px] uppercase tracking-wide text-slate-500">Plots</span>
            {(["any", "1", "2", "3"] as PlotsFilter[]).map((p) => (
              <Chip key={p} active={plots === p} onClick={() => setPlots(p)}>
                {p === "any" ? "Any" : p}
              </Chip>
            ))}
          </div>
          <label className="relative ml-auto w-full min-w-[12rem] sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              className="w-full rounded-md border border-slate-600/40 bg-slate-900/60 py-1.5 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              placeholder="Search title or author"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search flows"
            />
          </label>
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
        {viewer.scaling && <p className="px-3 pt-1 text-[11px] text-amber-200/70 sm:px-4">Crop and rare-crop numbers are scaled to your yield stats (an estimate).</p>}
        {!loading && insolvent.length > 0 && (
          <p className="px-3 pt-1 text-[11px] text-slate-400 sm:px-4" data-testid="insolvent-note">
            {insolvent.length} flow{insolvent.length === 1 ? " doesn't" : "s don't"} pay back {insolvent.length === 1 ? "its" : "their"} starting layout by cycle{" "}
            {PAYBACK_CYCLES.toLocaleString()} when online every {viewer.every} cycle{viewer.every === 1 ? "" : "s"}, so {insolvent.length === 1 ? "it isn't" : "they aren't"} ranked here.
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
                {insolvent.length > 0 ? "No flows pay back at this frequency" : "No flows on this board"}
                {plots !== "any" ? ` with ${plots} plot${plots === "1" ? "" : "s"}` : ""}
                {insolvent.length > 0 ? "." : " yet."}
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
            <div className="py-10 text-center text-xs text-slate-400">Nothing matches "{query}".</div>
          ) : (
            <ol className="divide-y divide-slate-700/30" data-testid="flows-list">
              {shown.map((row, i) => (
                <FlowRowItem
                  key={row.entry.id}
                  row={row}
                  top={top}
                  every={viewer.every}
                  normal={normal}
                  index={i}
                  sort={sort}
                  like={{
                    liked: likes.isLiked(row.entry.id),
                    busy: likes.busy(row.entry.id),
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
          )}
        </div>
      </section>
    </div>
  );
};
