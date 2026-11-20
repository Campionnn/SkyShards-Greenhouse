import React from "react";
import type { SimulationView } from "../../../hooks/useSimulation";
import { COINS_METRIC, type RankMetric } from "../../../leaderboard/metric";
import { uptimeRatio } from "../../../simulator";
import { cn } from "../../ui/cn";
import { formatFocus, focusUnit } from "../focusMetricUi";
import { formatCoins, formatDuration, formatPercent, spotFailureText } from "../format";
import { FocusName, FocusPicker } from "./FocusPicker";
import { focusValues, kpiValues, statusText, type PriceSummary } from "./pageHelpers";

// The numbers under the command bar: the focus metric per day (the hero, its label opens the focus
// picker), the other metrics per day as smaller numbers, profit, simulated time and uptime, plus a
// one-line status. While a run is in flight they follow the worker's running totals.
//
// Fits by the header's own width (it is an @container): the status line goes first, then the
// Simulated time detail, then Profit when coins/day is already shown beside the hero.

export interface KpiStripProps {
  view: SimulationView;
  plotCount: number;
  /** Normal profile: price a summary at Bazaar prices. */
  priceSummary?: PriceSummary;
  /** What the hero shows and the Monte Carlo test measures (default coins). */
  focus?: RankMetric;
  /** Changes the focus (the hero label becomes a picker); omitted, the label is plain. */
  onFocusChange?: (m: RankMetric) => void;
}

const Kpi: React.FC<{ label: React.ReactNode; hero?: boolean; children: React.ReactNode; title?: string; className?: string; testId?: string }> = ({
  label,
  hero,
  children,
  title,
  className,
  testId,
}) => (
  <div className={cn("flex min-w-0 shrink-0 flex-col leading-none", className)} title={title} data-testid={testId}>
    <span className="flex h-3.5 items-center text-label uppercase text-fg-meta">{label}</span>
    <span className={cn("mt-1.5 whitespace-nowrap font-semibold tabular-nums text-fg", hero ? "text-hero" : "text-title")}>{children}</span>
  </div>
);

const signed = (metric: RankMetric, d: number) => `${d > 0 ? "+" : "−"}${formatFocus(metric, Math.abs(d))}`;

export const KpiStrip: React.FC<KpiStripProps> = ({ view, plotCount, priceSummary, focus = COINS_METRIC, onFocusChange }) => {
  const { summary, profit, priced } = kpiValues(view, priceSummary);
  const { value, delta, side } = focusValues(view, focus, priceSummary);
  const u = summary?.uptime;
  const report = view.status === "running" ? null : view.snapshot?.report;
  const unsustainable = !!u && u.watched > 0 && u.requirements > 0;
  const first = report?.firstFailure;
  const status = statusText(view, plotCount);
  const coins = focus.by === "coins";
  const heroLabel = <FocusName metric={focus} />;
  // A delta smaller than the number's last shown digit reads "+0": hide it.
  const showDelta = delta !== null && formatFocus(focus, Math.abs(delta)) !== "0";
  return (
    <div className="flex items-end gap-7 px-1 pb-2.5 sm:px-2 max-md:hidden @max-[1240px]:gap-5 @max-[860px]:gap-4" data-testid="kpi-strip">
      <Kpi
        testId="kpi-hero"
        hero
        title={coins ? (priced ? "Profit per day at Bazaar prices" : "Profit per day at NPC prices") : `${focusUnit(focus)}: harvested per simulated day`}
        label={
          onFocusChange ? (
            <FocusPicker value={focus} onChange={onFocusChange} button={heroLabel} className="-mx-1 px-1 uppercase text-fg-meta" />
          ) : (
            heroLabel
          )
        }
      >
        <span className={value < 0 ? "text-problem" : undefined}>{formatFocus(focus, value)}</span>
        {showDelta && (
          <span className="ml-2 text-meta font-medium text-fg-muted">
            {signed(focus, delta!)}
            <span className="@max-[900px]:hidden"> last run</span>
          </span>
        )}
      </Kpi>
      {side.map(({ metric, value: v }) => (
        <Kpi
          key={metric.by}
          label={focusUnit(metric)}
          testId={`kpi-${metric.by}`}
          title={metric.by === "coins" ? (priced ? "Profit per day at Bazaar prices" : "Profit per day at NPC prices") : `${focusUnit(metric)}: earned per simulated day`}
        >
          <span className={v < 0 ? "text-problem" : undefined}>{metric.by === "coins" ? formatCoins(v) : formatFocus(metric, v)}</span>
        </Kpi>
      ))}
      {/* Coins/day already sits beside the hero when another metric is the focus: Profit goes first when narrow. */}
      <Kpi label="Profit" className={coins ? undefined : "@max-[1180px]:hidden"}>
        <span className={profit < 0 ? "text-problem" : "text-coin"}>{formatCoins(profit)}</span>
      </Kpi>
      <Kpi label="Simulated" title={`${(summary?.cyclesRun ?? 0).toLocaleString("en-US")} cycles · ${formatDuration(summary?.elapsedSeconds ?? 0)}`}>
        <span className="@max-[1100px]:hidden">{(summary?.cyclesRun ?? 0).toLocaleString("en-US")}</span>
        <span className="ml-1 text-secondary font-medium text-fg-meta @max-[1100px]:hidden">cycles ·</span>
        <span className="ml-1 text-secondary font-medium text-fg-meta @max-[1100px]:ml-0 @max-[1100px]:text-title @max-[1100px]:font-semibold @max-[1100px]:text-fg">
          {formatDuration(summary?.elapsedSeconds ?? 0)}
        </span>
      </Kpi>
      <Kpi label="Uptime" title={first ? spotFailureText(first) : "Checked target cells growing or ready to spawn"}>
        {!u || u.watched === 0 ? (
          <span className="text-body font-medium text-fg-meta">no targets checked</span>
        ) : (
          <>
            <span className={unsustainable ? "text-problem" : undefined}>{formatPercent(uptimeRatio(u))}</span>
            <span className={cn("ml-1 text-secondary font-medium @max-[900px]:hidden", unsustainable ? "text-problem/70" : "text-fg-meta")}>
              {unsustainable ? (first ? `short at cycle ${first.firstRequirementsCycle}` : "not sustainable") : "sustainable"}
            </span>
          </>
        )}
      </Kpi>
      {/* Narrow bars hide the line visually but keep it in the accessibility tree, so the polite
          live region still announces run progress. */}
      <p className="ml-auto min-w-0 max-w-[560px] truncate pb-0.5 text-right text-secondary text-fg-meta @max-[1360px]:sr-only" title={status} aria-live="polite">
        {status}
      </p>
      {view.error && view.status !== "error" && <p className="min-w-0 truncate pb-0.5 text-secondary text-problem" title={view.error}>{view.error}</p>}
    </div>
  );
};

/** The phone's second header line: profit, simulated time and the status (the desktop strip's other numbers). */
export const KpiCompactDetail: React.FC<KpiStripProps> = ({ view, plotCount, priceSummary }) => {
  const { summary, profit } = kpiValues(view, priceSummary);
  const status = statusText(view, plotCount);
  return (
    <div className="flex min-w-0 items-baseline gap-x-3 px-3 pb-2 text-secondary text-fg-meta md:hidden">
      <span className="shrink-0 whitespace-nowrap">
        <b className={cn("font-semibold tabular-nums", profit < 0 ? "text-problem" : "text-coin")}>{formatCoins(profit)}</b> profit
      </span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">
        {(summary?.cyclesRun ?? 0).toLocaleString("en-US")} cycles · {formatDuration(summary?.elapsedSeconds ?? 0)}
      </span>
      {/* The live region for run progress on phones (the desktop strip's is display: none here). */}
      <span className="min-w-0 truncate" title={status} aria-live="polite">
        {view.error && view.status !== "error" ? <span className="text-problem">{view.error}</span> : status}
      </span>
    </div>
  );
};

/** The phone header's compact numbers: the focus metric per day (its unit opens the picker) and uptime. */
export const KpiCompact: React.FC<KpiStripProps> = ({ view, priceSummary, focus = COINS_METRIC, onFocusChange }) => {
  const { summary } = kpiValues(view, priceSummary);
  const { value } = focusValues(view, focus, priceSummary);
  const u = summary?.uptime;
  const bad = !!u && u.watched > 0 && u.requirements > 0;
  const unit = focus.by === "coins" ? <span>/day</span> : <FocusName metric={focus} size={14} />;
  return (
    <span className="ml-auto flex min-w-0 items-baseline gap-2 md:hidden" data-testid="kpi-compact">
      <span className={cn("shrink-0 text-title tabular-nums", value < 0 ? "text-problem" : "text-fg")}>{formatFocus(focus, value)}</span>
      {onFocusChange ? (
        <FocusPicker value={focus} onChange={onFocusChange} align="end" button={unit} className="min-w-0 self-center text-meta text-fg-meta" />
      ) : (
        <span className="min-w-0 text-meta text-fg-meta">{unit}</span>
      )}
      {u && u.watched > 0 && (
        <span className={cn("shrink-0 rounded-full px-1.5 py-px text-meta font-semibold ring-1 ring-inset", bad ? "bg-problem/10 text-problem ring-problem/30" : "bg-fg-muted/10 text-fg-body ring-line-strong")}>
          {formatPercent(uptimeRatio(u))}
        </span>
      )}
    </span>
  );
};
