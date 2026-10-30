import React from "react";
import type { SimulationView } from "../../../hooks/useSimulation";
import { uptimeRatio } from "../../../simulator";
import { formatCoins, formatDuration, spotFailureText } from "../format";
import { kpiValues, statusText, type PriceSummary } from "./pageHelpers";

// The numbers under the command bar: per day (the hero), profit, simulated time and uptime, plus a
// one-line status. While a run is in flight they follow the worker's running totals.

export interface KpiStripProps {
  view: SimulationView;
  plotCount: number;
  /** Normal profile: price a summary at Bazaar prices. */
  priceSummary?: PriceSummary;
}

const fmtPct = (r: number) => (r >= 1 ? "100%" : `${(Math.floor(r * 1000) / 10).toFixed(1)}%`);

const Kpi: React.FC<{ label: string; hero?: boolean; children: React.ReactNode; title?: string }> = ({ label, hero, children, title }) => (
  <div className="flex min-w-0 flex-col leading-none" title={title}>
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</span>
    <span className={`mt-1.5 whitespace-nowrap font-semibold tabular-nums text-slate-100 ${hero ? "text-[22px]" : "text-[15px]"}`}>{children}</span>
  </div>
);

export const KpiStrip: React.FC<KpiStripProps> = ({ view, plotCount, priceSummary }) => {
  const { summary, perDay, profit, delta, priced } = kpiValues(view, priceSummary);
  const u = summary?.uptime;
  const report = view.status === "running" ? null : view.snapshot?.report;
  const unsustainable = !!u && u.watched > 0 && u.requirements > 0;
  const first = report?.firstFailure;
  return (
    <div className="flex items-end gap-7 px-1 pb-2.5 sm:px-2 max-md:hidden">
      <Kpi label="Per day" hero title={priced ? "Profit per day at Bazaar prices" : "Profit per day at NPC prices"}>
        <span className={perDay < 0 ? "text-red-300" : ""}>{formatCoins(perDay)}</span>
        {delta !== null && Math.abs(delta) >= 1 && (
          <span className="ml-2 text-[11px] font-medium text-slate-400">
            {delta > 0 ? "+" : "−"}
            {formatCoins(Math.abs(delta))} last run
          </span>
        )}
      </Kpi>
      <Kpi label="Profit">
        <span className={profit < 0 ? "text-red-300" : "text-yellow-400"}>{formatCoins(profit)}</span>
      </Kpi>
      <Kpi label="Simulated">
        {(summary?.cyclesRun ?? 0).toLocaleString("en-US")}
        <span className="ml-1 text-[12px] font-medium text-slate-500">cycles · {formatDuration(summary?.elapsedSeconds ?? 0)}</span>
      </Kpi>
      <Kpi label="Uptime" title={first ? spotFailureText(first) : "Checked target cells growing or ready to spawn"}>
        {!u || u.watched === 0 ? (
          <span className="text-[13px] font-medium text-slate-500">no targets checked</span>
        ) : (
          <>
            <span className={unsustainable ? "text-red-300" : ""}>{fmtPct(uptimeRatio(u))}</span>
            <span className={`ml-1 text-[12px] font-medium ${unsustainable ? "text-red-300/70" : "text-slate-500"}`}>
              {unsustainable ? (first ? `short at cycle ${first.firstRequirementsCycle}` : "not sustainable") : "sustainable"}
            </span>
          </>
        )}
      </Kpi>
      <p className="ml-auto max-w-[560px] truncate pb-0.5 text-right text-[12px] text-slate-500 @max-[1050px]:hidden" title={statusText(view, plotCount)} aria-live="polite">
        {statusText(view, plotCount)}
      </p>
      {view.error && view.status !== "error" && <p className="pb-0.5 text-[12px] text-red-300">{view.error}</p>}
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
      <span className="text-[15px] font-semibold tabular-nums text-slate-100">{formatCoins(perDay)}</span>
      <span className="text-[11px] text-slate-500">/day</span>
      {u && u.watched > 0 && (
        <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ring-1 ring-inset ${bad ? "bg-red-500/10 text-red-300 ring-red-500/30" : "bg-slate-400/10 text-slate-300 ring-slate-500/30"}`}>
          {fmtPct(uptimeRatio(u))}
        </span>
      )}
    </span>
  );
};
