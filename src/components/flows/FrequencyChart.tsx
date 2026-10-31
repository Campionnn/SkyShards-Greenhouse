import React, { useLayoutEffect, useRef, useState } from "react";
import type { FrequencyPoint } from "../../leaderboard/view";
import { formatCoins } from "../simulator/format";
import { cn } from "../ui/cn";

const fmtHours = (h: number) => (h < 1 ? `${Math.round(h * 60)}m` : h < 10 ? `${h.toFixed(1).replace(/\.0$/, "")}h` : `${Math.round(h)}h`);

/** Round a maximum up to a tidy axis top (1, 1.2, 1.5, 2, 2.5 … × a power of ten). */
function niceTop(max: number): number {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= max * 1.05) return f * p;
  return 10 * p;
}

/**
 * Profit per day against how often you log in, flat (design system: one `go` line, the selected
 * point in `select`, no gradients or glows). A doubling x scale (1, 2, 4, 8… sit evenly apart);
 * the "Forgiving range" (your frequency to twice it) is a quiet band. The readout sits above the
 * plot instead of covering it. The x labels are a radio group of real buttons: click, tap or the
 * arrow keys pick a frequency (`onSelect`); without `onSelect` they only show the readout.
 * Used by /flows/:id and the simulator's Frequency tab.
 */
export const FrequencyChart: React.FC<{
  points: FrequencyPoint[];
  selected: number;
  hoursPerCycle: number;
  onSelect?: (every: number) => void;
  /** What the highlighted point is called ("yours" on the leaderboard, "selected" in the simulator). */
  selectedLabel?: string;
  /** Shown instead of the chart when no point has a value. */
  emptyText?: string;
  /** Plot height in px (default 200). */
  height?: number;
}> = ({ points, selected, hoursPerCycle, onSelect, selectedLabel = "yours", emptyText, height = 200 }) => {
  const wrap = useRef<HTMLDivElement>(null);
  const axis = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const known = points.filter((p) => p.profitPerDay !== null);
  const empty = known.length === 0;
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [empty]);

  if (empty) return <p className="text-secondary text-fg-meta">{emptyText ?? "Not verified at any frequency for this tier yet."}</p>;

  const pad = { l: 46, r: 18, t: 10, b: 8 };
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const lo = Math.log2(points[0]?.every ?? 1);
  const hi = Math.log2(points[points.length - 1]?.every ?? 12);
  const xOf = (every: number) => pad.l + (hi > lo ? ((Math.log2(every) - lo) / (hi - lo)) * iw : iw / 2);
  const best = Math.max(0, ...known.map((p) => p.profitPerDay ?? 0));
  const top = niceTop(best);
  const yOf = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const line = known.map((p, i) => `${i ? "L" : "M"}${xOf(p.every).toFixed(1)},${yOf(p.profitPerDay!).toFixed(1)}`).join(" ");
  const mine = points.find((p) => p.every === selected)?.profitPerDay ?? null;
  const focus = points.find((p) => p.every === (hover ?? selected)) ?? null;
  const windowEnd = Math.min(selected * 2, points[points.length - 1]?.every ?? selected);
  const delta = focus && focus.profitPerDay !== null && mine && mine > 0 && focus.every !== selected ? (focus.profitPerDay - mine) / mine : null;
  const at = Math.max(0, points.findIndex((p) => p.every === selected));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!onSelect) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : step ? Math.max(0, Math.min(points.length - 1, at + step)) : null;
    if (to === null) return;
    e.preventDefault();
    const next = points[to];
    onSelect(next.every);
    axis.current?.querySelector<HTMLButtonElement>(`[data-every="${next.every}"]`)?.focus();
  };

  return (
    <div className="space-y-1.5">
      <p className="min-h-5 text-secondary tabular-nums text-fg-muted" aria-live="polite">
        {focus && focus.profitPerDay !== null && (
          <>
            Every {focus.every} · ≈{fmtHours(focus.every * hoursPerCycle)} · <b className="font-semibold text-coin">{formatCoins(focus.profitPerDay)}</b>/day
            {best > 0 && <> · {Math.round((focus.profitPerDay / best) * 100)}% of the best</>}
            {delta !== null && (
              <span className={delta >= 0 ? "text-go-fg" : "text-problem"}>
                {" "}
                · {delta >= 0 ? "+" : ""}
                {Math.round(delta * 100)}% vs {selectedLabel}
              </span>
            )}
            {focus.every === selected && <span className="text-select-fg"> · {selectedLabel}</span>}
            {focus.effortAvg != null && <> · effort {Math.round(focus.effortAvg)} / login</>}
          </>
        )}
      </p>
      <div ref={wrap} className="relative w-full min-w-0" onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} className="block" role="img" aria-label="Profit per day by online frequency">
            {windowEnd > selected && <rect x={xOf(selected)} y={pad.t} width={xOf(windowEnd) - xOf(selected)} height={ih} fill="var(--color-fg-meta)" opacity={0.08} />}
            {(best > 0 ? [0, 0.5, 1] : [0]).map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={width - pad.r} y1={yOf(f * top)} y2={yOf(f * top)} stroke="var(--color-line)" strokeDasharray={f ? "2 4" : undefined} />
                <text x={pad.l - 6} y={yOf(f * top) + 4} textAnchor="end" fontSize={11} fill="var(--color-fg-meta)">
                  {f ? formatCoins(f * top) : "0"}
                </text>
              </g>
            ))}
            {mine !== null && mine > 0 && <line x1={pad.l} x2={width - pad.r} y1={yOf(mine)} y2={yOf(mine)} stroke="var(--color-select)" strokeOpacity={0.35} strokeDasharray="4 4" />}
            {focus && <line x1={xOf(focus.every)} x2={xOf(focus.every)} y1={pad.t} y2={pad.t + ih} stroke="var(--color-line-strong)" strokeDasharray="3 3" />}
            <path d={line} fill="none" stroke="var(--color-go)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {known.map((p) => (
              <circle
                key={p.every}
                cx={xOf(p.every)}
                cy={yOf(p.profitPerDay!)}
                r={p.every === selected ? 5 : 3.5}
                fill={p.every === selected ? "var(--color-select)" : "var(--color-surface-page)"}
                stroke={p.every === selected ? "var(--color-select)" : "var(--color-go)"}
                strokeWidth={2}
              />
            ))}
          </svg>
        )}
        <div ref={axis} className="relative h-9" role={onSelect ? "radiogroup" : undefined} aria-label={onSelect ? "Online frequency" : undefined} onKeyDown={onKeyDown}>
          {width > 0 &&
            points.map((p) => {
              const on = p.every === selected;
              return (
                <button
                  key={p.every}
                  type="button"
                  role={onSelect ? "radio" : undefined}
                  aria-checked={onSelect ? on : undefined}
                  aria-label={`Online every ${p.every} (about every ${fmtHours(p.every * hoursPerCycle)}): ${p.profitPerDay === null ? "not verified" : `${formatCoins(p.profitPerDay)} a day`}`}
                  data-every={p.every}
                  tabIndex={onSelect && on ? 0 : -1}
                  onClick={() => onSelect?.(p.every)}
                  onPointerEnter={() => setHover(p.every)}
                  onFocus={() => setHover(p.every)}
                  onBlur={() => setHover(null)}
                  className={cn(
                    "focus-ring absolute top-0 flex w-10 -translate-x-1/2 flex-col items-center rounded-inner py-0.5 leading-none transition-colors duration-(--duration-hover)",
                    onSelect ? "cursor-pointer hover:bg-surface-hover" : "cursor-default",
                    on ? "text-select-fg" : "text-fg-muted",
                  )}
                  style={{ left: xOf(p.every) }}
                >
                  <span className="text-secondary font-semibold tabular-nums">{p.every}</span>
                  <span className="mt-0.5 text-meta tabular-nums text-fg-meta">{fmtHours(p.every * hoursPerCycle)}</span>
                </button>
              );
            })}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-meta">
        <span>Online every N cycles (and the time between logins at your speed)</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-select" /> {selectedLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-4 rounded-inner bg-fg-meta/20" /> Forgiving range: up to twice as late
        </span>
      </p>
    </div>
  );
};
