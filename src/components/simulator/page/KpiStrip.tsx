import React from "react";
import type { SimulationView } from "../../../hooks/useSimulation";
import { uptimeRatio } from "../../../simulator";
import { cn } from "../../ui/cn";
import { formatCoins, formatDuration, formatPercent, spotFailureText } from "../format";
import { kpiValues, statusText, type PriceSummary } from "./pageHelpers";

// The numbers under the command bar: per day (the hero), profit, simulated time and uptime, plus a
// one-line status. While a run is in flight they follow the worker's running totals.

export interface KpiStripProps {
  view: SimulationView;
  plotCount: number;
  /** Normal profile: price a summary at Bazaar prices. */
  priceSummary?: PriceSummary;
}

const Kpi: React.FC<{ label: string; hero?: boolean; children: React.ReactNode; title?: string }> = ({ label, hero, children, title }) => (
  <div className="flex min-w-0 flex-col leading-none" title={title}>
    <span className="text-label uppercase text-fg-meta">{label}</span>
    <span className={cn("mt-1.5 whitespace-nowrap font-semibold tabular-nums text-fg", hero ? "text-hero" : "text-title")}>{children}</span>
  </div>
);

export const KpiStrip: React.FC<KpiStripProps> = ({ view, plotCount, priceSummary }) => {
  const { summary, perDay, profit, delta, priced } = kpiValues(view, priceSummary);
  const u = summary?.uptime;
  const report = view.status === "running" ? null : view.snapshot?.report;
  const unsustainable = !!u && u.watched > 0 && u.requirements > 0;
  const first = report?.firstFailure;
  const status = statusText(view, plotCount);
  return (
    <div className="flex items-end gap-7 px-1 pb-2.5 sm:px-2 max-md:hidden">
      <Kpi label="Per day" hero title={priced ? "Profit per day at Bazaar prices" : "Profit per day at NPC prices"}>
        <span className={perDay < 0 ? "text-problem" : undefined}>{formatCoins(perDay)}</span>
        {delta !== null && Math.abs(delta) >= 1 && (
          <span className="ml-2 text-meta font-medium text-fg-muted">
            {delta > 0 ? "+" : "−"}
            {formatCoins(Math.abs(delta))} last run
          </span>
        )}
      </Kpi>
      <Kpi label="Profit">
        <span className={profit < 0 ? "text-problem" : "text-coin"}>{formatCoins(profit)}</span>
      </Kpi>
      <Kpi label="Simulated">
        {(summary?.cyclesRun ?? 0).toLocaleString("en-US")}
        <span className="ml-1 text-secondary font-medium text-fg-meta">cycles · {formatDuration(summary?.elapsedSeconds ?? 0)}</span>
      </Kpi>
      <Kpi label="Uptime" title={first ? spotFailureText(first) : "Checked target cells growing or ready to spawn"}>
        {!u || u.watched === 0 ? (
          <span className="text-body font-medium text-fg-meta">no targets checked</span>
        ) : (
          <>
            <span className={unsustainable ? "text-problem" : undefined}>{formatPercent(uptimeRatio(u))}</span>
            <span className={cn("ml-1 text-secondary font-medium", unsustainable ? "text-problem/70" : "text-fg-meta")}>
              {unsustainable ? (first ? `short at cycle ${first.firstRequirementsCycle}` : "not sustainable") : "sustainable"}
            </span>
          </>
        )}
      </Kpi>
      {/* Narrow bars hide the line visually but keep it in the accessibility tree, so the polite
          live region still announces run progress. */}
      <p className="ml-auto max-w-[560px] truncate pb-0.5 text-right text-secondary text-fg-meta @max-[1050px]:sr-only" title={status} aria-live="polite">
        {status}
      </p>
      {view.error && view.status !== "error" && <p className="pb-0.5 text-secondary text-problem">{view.error}</p>}
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

/** The phone header's compact numbers. */
export const KpiCompact: React.FC<KpiStripProps> = ({ view, priceSummary }) => {
  const { summary, perDay } = kpiValues(view, priceSummary);
  const u = summary?.uptime;
  const bad = !!u && u.watched > 0 && u.requirements > 0;
  return (
    <span className="ml-auto flex items-baseline gap-2 md:hidden">
      <span className="text-title tabular-nums text-fg">{formatCoins(perDay)}</span>
      <span className="text-meta text-fg-meta">/day</span>
      {u && u.watched > 0 && (
        <span className={cn("rounded-full px-1.5 py-px text-meta font-semibold ring-1 ring-inset", bad ? "bg-problem/10 text-problem ring-problem/30" : "bg-fg-muted/10 text-fg-body ring-line-strong")}>
          {formatPercent(uptimeRatio(u))}
        </span>
      )}
    </span>
  );
};
