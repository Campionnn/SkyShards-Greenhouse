import React, { useLayoutEffect, useRef, useState } from "react";
import type { FrequencyPoint } from "../../leaderboard/view";
import { formatCoins } from "../simulator/format";
import { cn } from "../ui/cn";

const fmtHours = (h: number) => (h < 1 ? `${Math.round(h * 60)}m` : h < 10 ? `${h.toFixed(1).replace(/\.0$/, "")}h` : `${Math.round(h)}h`);

/** A monotone cubic path through points (Fritsch-Carlson): smooth, never overshoots between them. */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    m.push((pts[i + 1].y - pts[i].y) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i].x + h)},${f(pts[i].y + h * t[i])} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - h * t[i + 1])} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

/** Round a maximum up to a tidy axis top (1, 1.2, 1.5, 2, 2.5 … × a power of ten). */
function niceTop(max: number): number {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= max * 1.05) return f * p;
  return 10 * p;
}

/**
 * Profit per day against how often you log in (design system: one smooth `go` line over a flat,
 * faint `go` area, the selected point in `select`, no gradients or glows). A doubling x scale
 * (1, 2, 4, 8… sit evenly apart); the "Forgiving range" (your frequency to twice it) is a quiet
 * band. The line above the plot always states the selected point. Hovering anywhere over the plot
 * snaps to the nearest point and shows a `raised` tooltip next to it; clicking the plot picks that
 * frequency (`onSelect`). The x labels are also a radio group of real buttons (click, tap or the
 * arrow keys), so it works without a pointer. Without `onSelect` it only shows the tooltip.
 * Used by /flows/:id, the ranking peek and the simulator's Frequency tab.
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

  const pad = { l: 46, r: 18, t: 20, b: 8 };
  const iw = Math.max(1, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const lo = Math.log2(points[0]?.every ?? 1);
  const hi = Math.log2(points[points.length - 1]?.every ?? 12);
  const xOf = (every: number) => pad.l + (hi > lo ? ((Math.log2(every) - lo) / (hi - lo)) * iw : iw / 2);
  const best = Math.max(0, ...known.map((p) => p.profitPerDay ?? 0));
  const top = niceTop(best);
  const yOf = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const xy = known.map((p) => ({ x: xOf(p.every), y: yOf(p.profitPerDay!) }));
  const line = monotonePath(xy);
  const base = pad.t + ih;
  const area = xy.length > 1 ? `${line} L${xy[xy.length - 1].x.toFixed(1)},${base} L${xy[0].x.toFixed(1)},${base} Z` : "";
  const mine = points.find((p) => p.every === selected)?.profitPerDay ?? null;
  const focus = hover === null ? null : (points.find((p) => p.every === hover) ?? null);
  const windowEnd = Math.min(selected * 2, points[points.length - 1]?.every ?? selected);
  const delta = focus && focus.profitPerDay !== null && mine && mine > 0 && focus.every !== selected ? (focus.profitPerDay - mine) / mine : null;
  const at = Math.max(0, points.findIndex((p) => p.every === selected));

  /** The point nearest the pointer, by x (the plot is one row of points, so x alone decides). */
  const nearest = (clientX: number): number | null => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || !points.length) return null;
    const x = clientX - rect.left;
    return points.reduce((a, b) => (Math.abs(xOf(b.every) - x) < Math.abs(xOf(a.every) - x) ? b : a)).every;
  };

  // The tooltip sits beside its point (right of it, or left near the right edge), vertically centred
  // on it but kept inside the plot, so it never covers the point or anything outside the chart.
  const tipW = 196;
  const fx = focus ? xOf(focus.every) : 0;
  const fy = focus ? (focus.profitPerDay === null ? base : yOf(focus.profitPerDay)) : 0;
  const tipRight = fx + 16 + tipW <= width;
  const tipX = tipRight ? fx + 16 : Math.max(0, fx - 16 - tipW);
  const tipY = Math.max(0, Math.min(fy, height));
  const mineXY = mine !== null ? { x: xOf(selected), y: yOf(mine) } : null;

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
        {mine !== null && (
          <>
            <span className="text-select-fg">{selectedLabel[0].toUpperCase() + selectedLabel.slice(1)}</span>: every {selected} · ≈{fmtHours(selected * hoursPerCycle)} ·{" "}
            <b className="font-semibold text-coin">{formatCoins(mine)}</b>/day
            {best > 0 && <> · {Math.round((mine / best) * 100)}% of the best</>}
          </>
        )}
      </p>
      <div
        ref={wrap}
        className={cn("relative w-full min-w-0 select-none", onSelect && "cursor-pointer")}
        onPointerMove={(e) => setHover(nearest(e.clientX))}
        onPointerDown={(e) => setHover(nearest(e.clientX))}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className="block"
            role="img"
            aria-label="Profit per day by online frequency"
            onClick={(e) => {
              const n = nearest(e.clientX);
              if (n !== null) onSelect?.(n);
            }}
          >
            {windowEnd > selected && (
              <g>
                <rect x={xOf(selected)} y={pad.t} width={xOf(windowEnd) - xOf(selected)} height={ih} fill="var(--color-fg-meta)" opacity={0.08} />
                {xOf(windowEnd) - xOf(selected) > 92 && (
                  <text x={(xOf(selected) + xOf(windowEnd)) / 2} y={pad.t - 6} textAnchor="middle" fontSize={11} fill="var(--color-fg-meta)">
                    Forgiving range
                  </text>
                )}
              </g>
            )}
            {(best > 0 ? [0, 0.25, 0.5, 0.75, 1] : [0]).map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={width - pad.r} y1={yOf(f * top)} y2={yOf(f * top)} stroke={f ? "var(--color-line)" : "var(--color-line-strong)"} strokeDasharray={f ? "2 4" : undefined} />
                {(f === 0 || f === 0.5 || f === 1 || height >= 180) && (
                  <text x={pad.l - 6} y={yOf(f * top) + 4} textAnchor="end" fontSize={11} fill="var(--color-fg-meta)">
                    {f ? formatCoins(f * top) : "0"}
                  </text>
                )}
              </g>
            ))}
            {mine !== null && mine > 0 && <line x1={pad.l} x2={width - pad.r} y1={yOf(mine)} y2={yOf(mine)} stroke="var(--color-select)" strokeOpacity={0.35} strokeDasharray="4 4" />}
            {area && <path d={area} fill="var(--color-go)" fillOpacity={0.1} />}
            {focus && <line x1={fx} x2={fx} y1={pad.t} y2={base} stroke="var(--color-line-strong)" strokeDasharray="3 3" />}
            <path d={line} fill="none" stroke="var(--color-go)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {mineXY && <circle cx={mineXY.x} cy={mineXY.y} r={10} fill="var(--color-select)" fillOpacity={0.16} />}
            {known.map((p) => {
              const isMine = p.every === selected;
              const isHover = p.every === hover;
              return (
                <circle
                  key={p.every}
                  cx={xOf(p.every)}
                  cy={yOf(p.profitPerDay!)}
                  r={isMine ? 5 : isHover ? 5 : 3.5}
                  fill={isMine ? "var(--color-select)" : isHover ? "var(--color-go)" : "var(--color-surface-page)"}
                  stroke={isMine ? "var(--color-select)" : "var(--color-go)"}
                  strokeWidth={2}
                />
              );
            })}
          </svg>
        )}
        {width > 0 && focus && (
          <div
            role="presentation"
            data-testid="frequency-tip"
            className="kit-fade-in pointer-events-none absolute top-0 left-0 z-(--z-tooltip) rounded-control border border-line-strong bg-surface-raised px-2.5 py-1.5 text-meta shadow-raised transition-transform duration-(--duration-hover) ease-snappy"
            style={{ width: tipW, transform: `translate(${tipX}px, clamp(0px, calc(${tipY}px - 50%), calc(${height}px - 100%)))` }}
          >
            <span className="block text-fg-meta">
              Every {focus.every} cycle{focus.every === 1 ? "" : "s"} · ≈{fmtHours(focus.every * hoursPerCycle)}
              {focus.every === selected && <span className="text-select-fg"> · {selectedLabel}</span>}
            </span>
            {focus.profitPerDay === null ? (
              <span className="mt-0.5 block text-fg-meta">Not verified</span>
            ) : (
              <>
                <span className="mt-0.5 flex items-baseline gap-1 tabular-nums">
                  <span className="text-title font-semibold text-coin">{formatCoins(focus.profitPerDay)}</span>
                  <span className="text-fg-meta">/ day</span>
                </span>
                <span className="block tabular-nums text-fg-muted">
                  {best > 0 && `${Math.round((focus.profitPerDay / best) * 100)}% of the best`}
                  {delta !== null && <span className={delta >= 0 ? "text-go-fg" : "text-problem"}>{` · ${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}% vs ${selectedLabel}`}</span>}
                </span>
                {focus.effortAvg != null && <span className="block tabular-nums text-fg-muted">Effort {Math.round(focus.effortAvg)} / login</span>}
              </>
            )}
            {onSelect && focus.every !== selected && <span className="mt-1 block border-t border-line pt-1 text-fg-meta">Click to switch to every {focus.every}</span>}
          </div>
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
