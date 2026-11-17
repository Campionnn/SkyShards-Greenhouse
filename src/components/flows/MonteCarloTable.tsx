import React from "react";
import { ROUGH_BELOW, type McPoint } from "../../leaderboard/montecarlo";
import { formatCoins } from "../simulator/format";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";

/**
 * A Monte Carlo test's numbers per online frequency (leaderboard/montecarlo.ts): median, average
 * with its 95% margin, the 90% range drawn as a bar on a shared scale, the worst and best seed, and
 * how many seeds lost money or failed. Used by the simulator's frequency sweep and the flow page's
 * "Test with your stats".
 */
export const MonteCarloTable: React.FC<{
  points: readonly McPoint[];
  /** The highlighted row (the selected frequency). */
  selected?: number | null;
  onSelect?: (every: number) => void;
  hoursPerCycle?: number;
}> = ({ points, selected, onSelect, hoursPerCycle }) => {
  const rows = points.filter((p) => p.runs > 0);
  if (!rows.length) return null;
  const ds = rows.flatMap((p) => (p.dist ? [p.dist] : []));
  // The bars share one scale over the data (0 included only when some seed lost money), with a
  // little room either side, so a tight range still reads as a range.
  const dMin = Math.min(...ds.map((d) => d.min));
  const dMax = Math.max(...ds.map((d) => d.max));
  const pad = (dMax - dMin) * 0.06 || Math.abs(dMax) * 0.05 || 1;
  const lo = dMin < 0 ? Math.min(dMin, 0) - pad : dMin - pad;
  const hi = dMax + pad;
  const span = hi - lo || 1;
  const pct = (v: number) => `${((v - lo) / span) * 100}%`;
  const rough = ds.some((d) => d.n < ROUGH_BELOW);
  const h = (every: number) => (hoursPerCycle ? (every * hoursPerCycle < 1 ? `${Math.round(every * hoursPerCycle * 60)}m` : `${(every * hoursPerCycle).toFixed(1).replace(/\.0$/, "")}h`) : null);
  return (
    <div className="@container min-w-0 space-y-1.5">
      <div>
        <table className="w-full table-fixed border-collapse text-secondary tabular-nums" data-testid="mc-table">
          <thead>
            <tr className="text-left text-meta text-fg-meta">
              <th className="w-28 py-1 pr-3 font-normal">Online every</th>
              <th className="w-16 py-1 pr-3 text-right font-normal">Median</th>
              <th className="w-28 py-1 pr-3 text-right font-normal @max-[30rem]:hidden" title="The mean over the seeds, ± its 95% margin of error">
                Average
              </th>
              <th className="py-1 pr-3 font-normal" title="90% of seeds land in this range (5th to 95th percentile); the tick is the median, the thin line worst to best">
                90% of seeds
              </th>
              <th className="w-16 py-1 pr-3 text-right font-normal @max-[44rem]:hidden">Worst</th>
              <th className="w-16 py-1 pr-3 text-right font-normal @max-[44rem]:hidden">Best</th>
              <th className="w-24 py-1 text-right font-normal">Seeds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const d = p.dist;
              const on = p.every === selected;
              return (
                <tr
                  key={p.every}
                  className={cn("border-t border-line", onSelect && "cursor-pointer hover:bg-surface-hover", on && "bg-surface-hover")}
                  onClick={onSelect ? () => onSelect(p.every) : undefined}
                  aria-selected={onSelect ? on : undefined}
                >
                  <td className={cn("py-1.5 pr-3 whitespace-nowrap", on ? "text-select-fg" : "text-fg-body")}>
                    {p.every} cycle{p.every === 1 ? "" : "s"}
                    {h(p.every) && <span className="ml-1.5 text-meta text-fg-meta">≈{h(p.every)}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-semibold whitespace-nowrap text-coin">{d ? formatCoins(d.median) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap text-fg-body @max-[30rem]:hidden">
                    {d ? (
                      <>
                        {formatCoins(d.mean)}
                        {d.n > 1 && <span className="ml-1 text-meta text-fg-meta">±{formatCoins(d.meanMargin)}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {d && (
                      <div className="flex items-center gap-2">
                        <div className="relative h-3 min-w-8 flex-1" title={`${formatCoins(d.lo)} to ${formatCoins(d.hi)} · median ${formatCoins(d.median)}`}>
                          {lo < 0 && <span aria-hidden className="absolute top-0 bottom-0 w-px bg-line-strong" style={{ left: pct(0) }} />}
                          <span aria-hidden className="absolute top-1/2 h-px -translate-y-1/2 bg-fg-meta/50" style={{ left: pct(d.min), width: `calc(${pct(d.max)} - ${pct(d.min)})` }} />
                          <span aria-hidden className="absolute top-0.5 bottom-0.5 rounded-full bg-go/40" style={{ left: pct(d.lo), width: `max(2px, calc(${pct(d.hi)} - ${pct(d.lo)}))` }} />
                          <span aria-hidden className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-coin" style={{ left: pct(d.median) }} />
                        </div>
                        <span className="shrink-0 text-right text-meta whitespace-nowrap text-fg-muted">
                          {formatCoins(d.lo)} – {formatCoins(d.hi)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className={cn("py-1.5 pr-3 text-right whitespace-nowrap @max-[44rem]:hidden", d && d.min < 0 ? "text-problem" : "text-fg-muted")}>{d ? formatCoins(d.min) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap text-fg-muted @max-[44rem]:hidden">{d ? formatCoins(d.max) : "—"}</td>
                  <td className="py-1.5 text-right text-fg-meta">
                    {d?.n ?? 0}
                    {p.failed > 0 && <span className="ml-1 text-problem">· {p.failed} failed</span>}
                    {d && d.lossShare > 0 && <span className="ml-1 text-warn">· {Math.round(d.lossShare * 100)}% lose</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-1.5 text-meta text-fg-meta">
        Coins per day{rough && ` · under ${ROUGH_BELOW} seeds the range is rough`}
        <InfoHint title="Reading the numbers" width={320}>
          Median: the middle seed, what a typical run makes. Average: the mean, ± its 95% margin of error (it shrinks as you add seeds). The bar: 90% of seeds land in
          the shaded range (5th to 95th percentile), the tick is the median and the thin line runs from the worst seed to the best. A wide range means the result
          depends a lot on luck.
        </InfoHint>
      </p>
    </div>
  );
};
