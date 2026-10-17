import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FlaskConical, RefreshCw, Search, Trophy } from "lucide-react";
import { AuthorLabel, Badge, PriceNote, ViewerControls } from "../components/flows/FlowControls";
import { formatCoins } from "../components/simulator/format";
import { buttonClass, inputClass } from "../components/simulator/styles";
import { InfoHint, SegmentedControl } from "../components/ui";
import { useFlowViewer } from "../hooks/useFlowViewer";
import type { FlowListResponse } from "../leaderboard/api";
import { BADGE_TITLE, effortText, filterRows, percent, rankEntries, suppliesText, type FlowRow } from "../leaderboard/view";
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

const RowBadges: React.FC<{ row: FlowRow }> = ({ row }) => (
  <span className="inline-flex flex-wrap gap-1">
    {row.badges.new && <Badge tone="new" title={BADGE_TITLE.new}>new</Badge>}
    {row.badges.stale && <Badge tone="stale" title={BADGE_TITLE.stale}>stale</Badge>}
    {(row.badges.estimated || row.scaled) && (
      <Badge tone="estimated" title={[row.badges.estimated && BADGE_TITLE.estimated, row.scaled && BADGE_TITLE.scaled].filter(Boolean).join(" ")}>
        estimated
      </Badge>
    )}
    {row.profitPerDay === null && <Badge tone="pending" title="Not verified at this tier and frequency yet.">pending</Badge>}
  </span>
);

const profitTone = (row: FlowRow) => ((row.profitPerDay ?? 0) < 0 ? "text-red-300" : "text-emerald-300");
const profitText = (row: FlowRow) => (row.profitPerDay === null ? "—" : formatCoins(row.profitPerDay));
const supplyText = (row: FlowRow, normal: boolean) =>
  row.profitPerDay === null ? "—" : normal ? formatCoins(row.boughtPerDay ?? 0) : suppliesText(row.suppliesPerDay);

const OpenButton: React.FC<{ id: string }> = ({ id }) => {
  const navigate = useNavigate();
  return (
    <button type="button" className={buttonClass.icon} onClick={() => navigate(`/simulator?flow=${encodeURIComponent(id)}`)} title="Open in simulator" aria-label="Open in simulator">
      <FlaskConical className="w-4 h-4" />
    </button>
  );
};

const FlowsTable: React.FC<{ rows: FlowRow[]; normal: boolean; showSlack: boolean }> = ({ rows, normal, showSlack }) => (
  <div className="hidden lg:block overflow-x-auto">
    <table className="w-full text-xs" data-testid="flows-table">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-700/60 whitespace-nowrap">
          <th className="font-medium py-2 pr-2 w-10">#</th>
          <th className="font-medium py-2 pr-3">Flow</th>
          <th className="font-medium py-2 pr-3">Author</th>
          <th className="font-medium py-2 pr-3 text-right">Plots</th>
          <th className="font-medium py-2 pr-3 text-right">Profit / day</th>
          <th className="font-medium py-2 pr-3">{normal ? "Bought / day" : "Supplies / day"}</th>
          {normal && <th className="font-medium py-2 pr-3 text-right">Setup cost</th>}
          <th className="font-medium py-2 pr-3 text-right" title="Effort per login: average / heaviest session">
            Effort
          </th>
          {showSlack && (
            <th className="font-medium py-2 pr-3 text-right" title="How forgiving it is when you log in late (see the entry page)">
              Forgiving
            </th>
          )}
          <th className="font-medium py-2 pr-3 text-right">Cycles</th>
          <th className="font-medium py-2 pr-2" aria-label="Open in simulator" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.entry.id} className="border-b border-slate-700/30 align-top hover:bg-slate-700/20">
            <td className="py-2 pr-2 text-slate-400 tabular-nums">{row.rank}</td>
            <td className="py-2 pr-3 min-w-[12rem]">
              <Link to={`/flows/${row.entry.id}`} className="text-slate-100 hover:text-emerald-300 font-medium break-words">
                {row.entry.title}
              </Link>
              <div className="mt-1">
                <RowBadges row={row} />
              </div>
            </td>
            <td className="py-2 pr-3 text-slate-300 min-w-[8rem]">
              <AuthorLabel author={row.entry.author} />
            </td>
            <td className="py-2 pr-3 text-right text-slate-300 tabular-nums">{row.entry.plots}</td>
            <td className={`py-2 pr-3 text-right font-medium tabular-nums whitespace-nowrap ${profitTone(row)}`}>{profitText(row)}</td>
            <td className="py-2 pr-3 text-slate-300 min-w-[8rem]">{supplyText(row, normal)}</td>
            {normal && <td className="py-2 pr-3 text-right text-slate-300 tabular-nums whitespace-nowrap">{row.buildCost === null ? "—" : formatCoins(row.buildCost)}</td>}
            <td className="py-2 pr-3 text-right text-slate-300 tabular-nums whitespace-nowrap">{effortText(row.effortAvg, row.effortPeak)}</td>
            {showSlack && <td className="py-2 pr-3 text-right text-slate-300 tabular-nums">{percent(row.slack)}</td>}
            <td className="py-2 pr-3 text-right text-slate-400 tabular-nums">{row.entry.cycles.toLocaleString()}</td>
            <td className="py-1.5 pr-2 text-right">
              <OpenButton id={row.entry.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-slate-200 break-words">{children}</div>
  </div>
);

/** Phones: one card per entry instead of the table. */
const FlowsCards: React.FC<{ rows: FlowRow[]; normal: boolean }> = ({ rows, normal }) => (
  <ol className="lg:hidden space-y-2" data-testid="flows-cards">
    {rows.map((row) => (
      <li key={row.entry.id} className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3">
        <div className="flex items-start gap-2">
          <span className="text-slate-400 text-sm tabular-nums w-6 flex-shrink-0">{row.rank}</span>
          <div className="min-w-0 flex-1">
            <Link to={`/flows/${row.entry.id}`} className="text-sm text-slate-100 font-medium hover:text-emerald-300 break-words">
              {row.entry.title}
            </Link>
            <div className="mt-1 text-xs text-slate-400">
              <AuthorLabel author={row.entry.author} size={16} />
            </div>
          </div>
          <OpenButton id={row.entry.id} />
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-xs">
          <Fact label="Profit / day">
            <span className={`font-medium ${profitTone(row)}`}>{profitText(row)}</span>
          </Fact>
          <Fact label={normal ? "Bought / day" : "Supplies / day"}>{supplyText(row, normal)}</Fact>
          {normal && <Fact label="Setup cost">{row.buildCost === null ? "—" : formatCoins(row.buildCost)}</Fact>}
          <Fact label="Effort (avg / peak)">{effortText(row.effortAvg, row.effortPeak)}</Fact>
          <Fact label="Plots · cycles">
            {row.entry.plots} · {row.entry.cycles.toLocaleString()}
          </Fact>
        </div>
        {(row.badges.new || row.badges.stale || row.badges.estimated || row.scaled || row.profitPerDay === null) && (
          <div className="mt-2">
            <RowBadges row={row} />
          </div>
        )}
      </li>
    ))}
  </ol>
);

export const FlowsPage: React.FC = () => {
  const viewer = useFlowViewer();
  const now = useMinuteClock();
  const [plots, setPlots] = useState<PlotsFilter>("any");
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
  const entries = useMemo(() => (result && !loading ? (result.data?.entries ?? []) : []), [result, loading]);
  const rows = useMemo(
    () =>
      rankEntries(DATA, entries, {
        board: viewer.board,
        quotes: viewer.quotes,
        pricing: viewer.bazaar.pricing,
        viewerStats: viewer.viewerStats,
        useMyStats: viewer.useMyStats,
        now,
      }),
    [entries, viewer.board, viewer.quotes, viewer.bazaar.pricing, viewer.viewerStats, viewer.useMyStats, now]
  );
  const shown = useMemo(() => filterRows(rows, query), [rows, query]);
  const normal = viewer.board === "normal";

  return (
    <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-6 max-w-screen-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Trophy className="w-4 h-4 text-amber-400" />
        <h1 className="text-sm font-medium text-slate-200">Flow leaderboard</h1>
        <InfoHint title="How entries are ranked" width={340}>
          <p>
            Every flow was simulated by the server under the same rules (empty start, default settings, secret seeds) at each online frequency and stat
            tier. It stores item counts per day; your browser prices them with your board's prices, so the ranking follows the controls instantly.
          </p>
          <p>Submit your own from the simulator's Scenario panel.</p>
        </InfoHint>
        <span className="text-xs text-slate-500">Ranked by profit per day for how you play.</span>
      </div>

      <section className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-3 sm:p-4 space-y-3">
        <ViewerControls viewer={viewer}>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            <span>Plots</span>
            <SegmentedControl<PlotsFilter>
              size="xs"
              nowrap
              value={plots}
              onChange={setPlots}
              options={[
                { value: "any", label: "Any" },
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
              ]}
            />
          </label>
        </ViewerControls>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[14rem] max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input type="search" className={`${inputClass} w-full pl-7 py-1.5`} placeholder="Search title or author" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search flows" />
          </label>
          <button type="button" className={buttonClass.neutral} onClick={() => setReload((n) => n + 1)} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <div className="w-full sm:w-auto sm:ml-auto">
            <PriceNote viewer={viewer} now={now} />
          </div>
        </div>
        {viewer.scaling && (
          <p className="text-[11px] text-amber-200/80">Numbers are scaled to your yield stats from the simulator: estimated. Turn off "Use my yield stats" to see the server's maximum-stat numbers.</p>
        )}
      </section>

      <section className="bg-slate-800/40 border border-slate-600/30 rounded-lg p-2 sm:p-4">
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-400">Loading the leaderboard...</div>
        ) : result?.error ? (
          <div className="py-8 text-center text-xs space-y-2">
            <div className="text-red-300">Could not load the leaderboard: {result.error}</div>
            <button type="button" className={`${buttonClass.neutral} mx-auto`} onClick={() => setReload((n) => n + 1)}>
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400 space-y-1">
            <div>No flows on this board{plots !== "any" ? ` with ${plots} plot${plots === "1" ? "" : "s"}` : ""} yet.</div>
            <div>
              Be the first: build one in the <Link to="/simulator" className="text-emerald-300 hover:underline">simulator</Link> and press "Submit to leaderboard".
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">Nothing matches "{query}".</div>
        ) : (
          <>
            <FlowsTable rows={shown} normal={normal} showSlack={shown.some((r) => r.slack !== null)} />
            <FlowsCards rows={shown} normal={normal} />
          </>
        )}
      </section>
    </div>
  );
};
