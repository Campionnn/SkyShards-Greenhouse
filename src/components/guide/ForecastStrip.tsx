/**
 * The forecast (G14–G18): one line (time to Done, visits, Dead Plants / Fermento still to farm) at the
 * top of the status panel, a thin progress bar while runs are still simulating, and the plan as a
 * disclosure: a timeline of each plot's farms from a real simulated run, plus the supplies table.
 * It never shows a time to Done when no run finished.
 */
import React, { useState } from "react";
import { AlertTriangle, ChevronDown, LoaderCircle } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { farmOf, itemName, type Catalog, type Forecast, type Plan, type PlanSegment, type PlotOutcome } from "../../guide";
import { CropImage } from "../shared/CropImage";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { KitLabel } from "../ui/kit";
import { formatDuration } from "./format";

/** Two alternating neutral shades, so neighbouring farms on a lane read apart. */
const SHADES = ["border-line-strong bg-surface-hover text-fg-body", "border-line-control bg-surface-raised text-fg"];

/** Stable number per farm id, so the same farm gets the same shade on every lane. */
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
  /** Rendered at the end of the summary line (the panel's own actions). */
  className?: string;
}

/** The summary line: the forecast's state in one sentence. */
const Summary: React.FC<{ forecast: Forecast | null; error: string | null; data: GameData }> = ({ forecast, error, data }) => {
  if (error)
    return (
      <span className="flex items-center gap-1.5 text-body text-warn">
        <AlertTriangle aria-hidden className="size-4" /> Forecast failed: {error}
      </span>
    );
  if (!forecast)
    return (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-title text-fg">Calculating the forecast…</span>
        <span className="text-secondary text-fg-meta">simulating the flow to Done from your current state</span>
      </span>
    );
  if (!forecast.seconds)
    return (
      <span className="flex items-center gap-1.5 text-body text-warn">
        <AlertTriangle aria-hidden className="size-4" /> None of {forecast.seeds} simulated runs reached Done. Check your inventory and settings.
      </span>
    );
  const short = forecast.supplies.filter((r) => r.more > 0);
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-hero tabular-nums text-fg">~{formatDuration(forecast.seconds.median)}</span>
        <span className="text-body text-fg-muted">to Done</span>
      </span>
      <span className="text-secondary tabular-nums whitespace-nowrap text-fg-meta">
        {formatDuration(forecast.seconds.p10)} – {formatDuration(forecast.seconds.p90)}
        {forecast.logins && ` · ~${forecast.logins.median} visits`}
      </span>
      {short.length ? (
        <span className="text-secondary text-warn">
          Farm{" "}
          {short.map((r, i) => (
            <span key={r.item}>
              {i > 0 && ", "}
              {r.more} more {itemName(data, r.item)}
              {r.shortIn !== null && ` within ${formatDuration(r.shortIn)}`}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-secondary text-fg-muted">Your Dead Plants and Fermento should last</span>
      )}
      {forecast.completed < forecast.seeds && (
        <span className="text-meta text-warn">
          {forecast.seeds - forecast.completed} of {forecast.seeds} runs didn't finish
        </span>
      )}
    </span>
  );
};

export const ForecastStrip: React.FC<ForecastStripProps> = ({ forecast, plan, progress, error, catalog, data, outcomes, onOpenSettings, className }) => {
  const [open, setOpen] = useState(false);
  const running = progress !== null;
  // Where the simulated run's first farm on a plot differs from today's decision.
  // (A lane can open with a zero-length entry for the farm the plot is already on; skip it.)
  const divergent = plan
    ? outcomes.filter((o) => {
        const first = plan.lanes[o.plotId]?.find((s) => s.seconds > 0);
        return first && o.to !== "hub" && o.to !== "supplies" && o.to !== "done" && first.farm !== o.to;
      })
    : [];
  return (
    <section className={cn("min-w-0", className)} aria-label="Forecast">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Summary forecast={forecast} error={error} data={data} />
        {plan && forecast?.seconds && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-control px-1.5 text-secondary text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg pointer-coarse:h-11"
          >
            Plan <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-(--duration-ink)", open && "rotate-180")} />
          </button>
        )}
      </div>
      {running && forecast && !error && (
        <p className="mt-1 flex items-center gap-1.5 text-meta text-fg-meta" aria-label="Refining">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
          Still calculating: these numbers are early and will settle as more runs finish
        </p>
      )}
      {running && progress && !error && <ProgressBar done={progress.done} total={progress.total} />}
      {open && plan && forecast && (
        <div className="mt-3 space-y-4 border-t border-line pt-3">
          <Timeline plan={plan} catalog={catalog} />
          {divergent.length > 0 && (
            <p className="text-secondary text-fg-muted">
              The plan above is one simulated run, and on {divergent.map((o) => `Plot ${o.plotId}`).join(", ")} it started differently from today's cards, because harvests are
              random. Follow the cards; they are worked out from your exact situation.
            </p>
          )}
          <Supplies forecast={forecast} data={data} />
          <p className="text-meta text-fg-meta">
            From {forecast.seeds} simulated runs of the flow from your current check-in ({forecast.completed} reached Done). The plan is the most typical run (seed {plan.medoidSeed}).{" "}
            <LinkButton className="text-meta" onClick={onOpenSettings}>
              Change how often you play
            </LinkButton>
          </p>
        </div>
      )}
    </section>
  );
};

/** The page's one progress bar, while runs are still simulating: sweeps until the first run lands, then fills. */
const ProgressBar: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const pct = total ? Math.round((100 * done) / total) : 0;
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-meta text-fg-meta">
        <span>{done === 0 ? "Starting the simulations…" : `Simulated ${done} of ${total} runs`}</span>
        {done > 0 && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Forecast progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        {done === 0 ? <div className="guide-sweep h-full w-1/3 rounded-full bg-fg-meta" /> : <div className="guide-fill h-full rounded-full bg-fg-meta" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
};

const Supplies: React.FC<{ forecast: Forecast; data: GameData }> = ({ forecast, data }) => {
  if (!forecast.supplies.length) return null;
  return (
    <div>
      <KitLabel>Dead Plants & Fermento, to Done</KitLabel>
      <table className="mt-1.5 w-full max-w-md text-body">
        <thead>
          <tr className="text-left text-secondary text-fg-meta">
            <th className="py-1 font-normal">Item</th>
            <th className="py-1 text-right font-normal">Needed</th>
            <th className="py-1 text-right font-normal">You own</th>
            <th className="py-1 text-right font-normal">Still to farm</th>
          </tr>
        </thead>
        <tbody>
          {forecast.supplies.map((r) => (
            <tr key={r.item} className="border-t border-line">
              <td className="py-1">
                <span className="inline-flex items-center gap-1.5 text-fg-body">
                  <CropImage cropId={r.item} cropName={itemName(data, r.item)} width={18} height={18} showFallback={false} />
                  {itemName(data, r.item)}
                </span>
              </td>
              <td className="py-1 text-right tabular-nums text-fg-body">{r.needed}</td>
              <td className="py-1 text-right tabular-nums text-fg-body">{r.owned}</td>
              <td className={cn("py-1 text-right font-semibold tabular-nums", r.more > 0 ? "text-warn" : "text-fg-meta")}>{r.more > 0 ? r.more : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-meta text-fg-meta">"Needed" covers 9 in 10 simulated runs. Dead Plants and Fermento have to be farmed separately.</p>
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
      <KitLabel>The plan, plot by plot</KitLabel>
      <div className="mt-1.5 overflow-x-auto pb-1">
        <div className="min-w-[640px]">
          <div className="relative ml-14 h-4 text-meta text-fg-meta">
            {Array.from({ length: Math.floor(days / tickEvery) + 1 }, (_, i) => i * tickEvery).map((d) => (
              <span key={d} className="absolute -translate-x-1/2" style={{ left: `${Math.min(100, ((d * 86400) / total) * 100)}%` }}>
                {d === 0 ? "now" : `${d}d`}
              </span>
            ))}
          </div>
          {Object.entries(plan.lanes).map(([plotId, lane]) => (
            <div key={plotId} className="flex items-center gap-2 py-0.5">
              <span className="w-12 shrink-0 text-secondary text-fg-meta">Plot {plotId}</span>
              <div className="relative h-7 flex-1 rounded-inner bg-surface-well">
                {lane.map((seg, i) => {
                  const farm = farmOf(catalog, Number(plotId), seg.farm);
                  const left = (seg.startSeconds / total) * 100;
                  const width = Math.max(0.4, (seg.seconds / total) * 100);
                  const isHub = farm.kind !== "farm";
                  return (
                    <button
                      type="button"
                      key={`${seg.farm}-${i}`}
                      onClick={() => setPicked(seg)}
                      aria-label={`Plot ${plotId}: ${farm.name}, from ${formatDuration(seg.startSeconds)} in, for ${formatDuration(seg.seconds)}`}
                      className={cn(
                        "focus-ring absolute top-0.5 bottom-0.5 cursor-pointer overflow-hidden rounded-inner border px-1 text-left text-meta leading-6 transition-colors duration-(--duration-hover)",
                        isHub ? "border-line bg-surface-well text-fg-meta" : SHADES[hue(seg.farm) % SHADES.length],
                        picked === seg && "border-select",
                      )}
                      // Neutral shades (charts are neutral); the farm's name is on the block.
                      style={{ left: `${left}%`, width: `${width}%` }}
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
      <p className="mt-1 min-h-5 text-secondary text-fg-body" aria-live="polite">
        {picked ? (
          <>
            <span className="font-medium text-fg">
              Plot {picked.plotId}: {farmOf(catalog, picked.plotId, picked.farm).name}
            </span>{" "}
            from {formatDuration(picked.startSeconds)} in, for about {formatDuration(picked.seconds)}. {Math.round(picked.share * 100)}% of simulated runs use this farm on this plot.
          </>
        ) : (
          <span className="text-fg-meta">Tap a block for its timing. Later farms depend on what you harvest, so the order can shift.</span>
        )}
      </p>
    </div>
  );
};
