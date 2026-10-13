/**
 * The compact forecast: one line (time to Done, visits, Dead Plants / Fermento) that expands into the plan, a
 * timeline of each plot's farms from a real simulated run.
 */
import React, { useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Package, Timer } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { farmOf, itemName, type Catalog, type Forecast, type Plan, type PlanSegment, type PlotOutcome } from "../../guide";
import { CropImage } from "../shared/CropImage";
import { formatDuration } from "./format";

/** Stable hue per farm id, so the same farm reads the same colour on every lane. */
function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export interface ForecastStripProps {
  forecast: Forecast | null;
  plan: Plan | null;
  progress: { done: number; total: number } | null;
  error: string | null;
  catalog: Catalog;
  data: GameData;
  /** This login's decisions, to flag where the forecast's first move differs. */
  outcomes: PlotOutcome[];
  onOpenSettings: () => void;
}

export const ForecastStrip: React.FC<ForecastStripProps> = ({ forecast, plan, progress, error, catalog, data, outcomes, onOpenSettings }) => {
  const [open, setOpen] = useState(false);
  const running = progress !== null;
  const short = forecast?.supplies.filter((r) => r.more > 0) ?? [];

  let summary: React.ReactNode;
  if (error) {
    summary = (
      <span className="flex items-center gap-1.5 text-amber-200">
        <AlertTriangle className="h-4 w-4" /> Forecast failed: {error}
      </span>
    );
  } else if (!forecast) {
    summary = (
      <span className="flex items-center gap-2 text-slate-200">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-400 motion-reduce:animate-none" aria-hidden />
        <span className="font-medium">Calculating the forecast…</span>
        <span className="text-xs text-slate-400">simulating the flow to Done from your current state</span>
      </span>
    );
  } else if (!forecast.seconds) {
    summary = (
      <span className="flex items-center gap-1.5 text-amber-200">
        <AlertTriangle className="h-4 w-4" /> None of {forecast.seeds} simulated runs reached Done. Check your inventory and settings.
      </span>
    );
  } else {
    summary = (
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <Timer className="h-4 w-4 text-emerald-400" />
          <span className="font-semibold text-slate-100">~{formatDuration(forecast.seconds.median)}</span>
          <span className="text-slate-400">to Done</span>
          <span className="text-xs text-slate-400">
            ({formatDuration(forecast.seconds.p10)}–{formatDuration(forecast.seconds.p90)})
          </span>
        </span>
        {forecast.logins && <span className="text-slate-400">~{forecast.logins.median} visits</span>}
        <span className="flex items-center gap-1.5">
          <Package className="h-4 w-4 text-slate-400" />
          {short.length ? (
            <span className="text-amber-100">
              Farm{" "}
              {short.map((r, i) => (
                <span key={r.item}>
                  {i > 0 && ", "}
                  {r.more} more {itemName(data, r.item)}
                  {r.shortIn !== null && <span className="text-amber-200/80"> within {formatDuration(r.shortIn)}</span>}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-emerald-200">Your Dead Plants and Fermento should last</span>
          )}
        </span>
        {forecast.completed < forecast.seeds && (
          <span className="text-xs text-amber-300">
            {forecast.seeds - forecast.completed} of {forecast.seeds} runs didn't finish
          </span>
        )}
      </span>
    );
  }

  // Where the simulated run's first farm on a plot differs from today's decision.
  // (A lane can open with a zero-length entry for the farm the plot is already on; skip it.)
  const divergent = plan
    ? outcomes.filter((o) => {
        const first = plan.lanes[o.plotId]?.find((s) => s.seconds > 0);
        return first && o.to !== "hub" && o.to !== "supplies" && o.to !== "done" && first.farm !== o.to;
      })
    : [];

  return (
    <section className="rounded-lg border border-slate-600/30 bg-slate-800/40" aria-label="Forecast">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors enabled:hover:bg-slate-700/20 disabled:cursor-default"
        disabled={!plan}
      >
        <span className="min-w-0 flex-1">
          {summary}
          {running && forecast && !error && (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-emerald-300" aria-label="Refining">
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              Still calculating: these numbers are early and will settle as more runs finish
            </span>
          )}
        </span>
        {plan && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
            Plan <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </span>
        )}
      </button>
      {running && progress && !error && <ProgressBar done={progress.done} total={progress.total} />}
      {open && plan && forecast && (
        <div className="space-y-4 border-t border-slate-600/30 px-4 py-3">
          <Timeline plan={plan} catalog={catalog} />
          {divergent.length > 0 && (
            <p className="text-xs text-slate-400">
              The plan above is one simulated run, and on {divergent.map((o) => `Plot ${o.plotId}`).join(", ")} it started differently from today's cards, because harvests are random.
              Follow the cards; they are worked out from your exact situation.
            </p>
          )}
          <Supplies forecast={forecast} data={data} />
          <p className="text-[11px] text-slate-400">
            From {forecast.seeds} simulated runs of the flow from your current check-in ({forecast.completed} reached Done). The plan is the most typical run (seed {plan.medoidSeed}).{" "}
            <button type="button" onClick={onOpenSettings} className="cursor-pointer text-emerald-400 underline-offset-2 hover:underline">
              Change how often you play
            </button>
          </p>
        </div>
      )}
    </section>
  );
};

/** Thin bar under the strip while runs are still simulating: sweeps until the first run lands, then fills. */
const ProgressBar: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return (
    <div className="px-4 pb-3">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>{done === 0 ? "Starting the simulations…" : `Simulated ${done} of ${total} runs`}</span>
        {done > 0 && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-700/70"
        role="progressbar"
        aria-label="Forecast progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        {done === 0 ? (
          <div className="guide-sweep h-full w-1/3 rounded-full bg-emerald-400/80" />
        ) : (
          <div className="guide-fill h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
};

const Supplies: React.FC<{ forecast: Forecast; data: GameData }> = ({ forecast, data }) => {
  if (!forecast.supplies.length) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Dead Plants & Fermento, to Done</h4>
      <table className="w-full max-w-md text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="py-1 font-normal">Item</th>
            <th className="py-1 text-right font-normal">Needed</th>
            <th className="py-1 text-right font-normal">You own</th>
            <th className="py-1 text-right font-normal">Still to farm</th>
          </tr>
        </thead>
        <tbody>
          {forecast.supplies.map((r) => (
            <tr key={r.item} className="border-t border-slate-700/60">
              <td className="py-1">
                <span className="inline-flex items-center gap-1.5 text-slate-200">
                  <CropImage cropId={r.item} cropName={itemName(data, r.item)} width={18} height={18} showFallback={false} />
                  {itemName(data, r.item)}
                </span>
              </td>
              <td className="py-1 text-right tabular-nums text-slate-300">{r.needed}</td>
              <td className="py-1 text-right tabular-nums text-slate-300">{r.owned}</td>
              <td className={`py-1 text-right font-semibold tabular-nums ${r.more > 0 ? "text-amber-200" : "text-emerald-300"}`}>{r.more > 0 ? r.more : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-400">"Needed" covers 9 in 10 simulated runs. Dead Plants and Fermento have to be farmed separately.</p>
    </div>
  );
};

const Timeline: React.FC<{ plan: Plan; catalog: Catalog }> = ({ plan, catalog }) => {
  const [picked, setPicked] = useState<PlanSegment | null>(null);
  const total = Math.max(1, plan.totalSeconds);
  const days = Math.ceil(total / 86400);
  const tickEvery = days > 20 ? 7 : days > 8 ? 2 : 1;
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">The plan, plot by plot</h4>
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[640px]">
          <div className="relative ml-14 h-4 text-[10px] text-slate-400">
            {Array.from({ length: Math.floor(days / tickEvery) + 1 }, (_, i) => i * tickEvery).map((d) => (
              <span key={d} className="absolute -translate-x-1/2" style={{ left: `${Math.min(100, ((d * 86400) / total) * 100)}%` }}>
                {d === 0 ? "now" : `${d}d`}
              </span>
            ))}
          </div>
          {Object.entries(plan.lanes).map(([plotId, lane]) => (
            <div key={plotId} className="flex items-center gap-2 py-0.5">
              <span className="w-12 shrink-0 text-xs text-slate-400">Plot {plotId}</span>
              <div className="relative h-7 flex-1 rounded bg-slate-900/60">
                {lane.map((seg, i) => {
                  const farm = farmOf(catalog, Number(plotId), seg.farm);
                  const left = (seg.startSeconds / total) * 100;
                  const width = Math.max(0.4, (seg.seconds / total) * 100);
                  const h = hue(seg.farm);
                  const isHub = farm.kind !== "farm";
                  return (
                    <button
                      type="button"
                      key={`${seg.farm}-${i}`}
                      onClick={() => setPicked(seg)}
                      aria-label={`Plot ${plotId}: ${farm.name}, from ${formatDuration(seg.startSeconds)} in, for ${formatDuration(seg.seconds)}`}
                      className="absolute top-0.5 bottom-0.5 cursor-pointer overflow-hidden rounded-sm px-1 text-left text-[10px] leading-6 text-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: isHub ? "rgba(71,85,105,0.5)" : `hsl(${h} 45% 32%)`,
                        boxShadow: `inset 0 0 0 1px hsl(${h} 50% 45% / 0.7)`,
                      }}
                      title={`${farm.name}: from ${formatDuration(seg.startSeconds)} in, for ${formatDuration(seg.seconds)} (in ${Math.round(seg.share * 100)}% of runs)`}
                    >
                      <span className="whitespace-nowrap">{farm.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-1 min-h-5 text-xs text-slate-300" aria-live="polite">
        {picked ? (
          <>
            <span className="font-medium text-slate-100">
              Plot {picked.plotId}: {farmOf(catalog, picked.plotId, picked.farm).name}
            </span>{" "}
            from {formatDuration(picked.startSeconds)} in, for about {formatDuration(picked.seconds)}. {Math.round(picked.share * 100)}% of simulated runs use this farm on this plot.
          </>
        ) : (
          <span className="text-slate-400">Tap a block for its timing. Later farms depend on what you harvest, so the order can shift.</span>
        )}
      </p>
    </div>
  );
};
