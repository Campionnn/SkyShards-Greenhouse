import React, { useEffect, useId, useRef, useState } from "react";
import type { FrequencyPoint } from "../../leaderboard/view";
import { formatCoins } from "../simulator/format";

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
    m.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i].x + h},${pts[i].y + h * t[i]} ${pts[i + 1].x - h},${pts[i + 1].y - h * t[i + 1]} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/** Round a maximum up to a tidy axis top (1, 2, 2.5 or 5 × a power of ten). */
function niceTop(max: number): number {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= max * 1.08) return f * p;
  return 10 * p;
}

/**
 * Profit per day against how often you log in: a smooth line over a doubling scale (1, 2, 4, 8...
 * cycles sit evenly apart), with the area under it, your frequency marked, and the "late-login
 * window" (your frequency to twice it, what Forgiving measures) shaded. Hover a point for its
 * numbers; click to switch to it.
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
}> = ({ points, selected, hoursPerCycle, onSelect, selectedLabel = "yours", emptyText }) => {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  // Unique gradient / filter ids, so two charts on one page never share them.
  const uid = useId().replace(/:/g, "");
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 240;
  const pad = { l: 46, r: 18, t: 18, b: 40 };
  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const lo = Math.log2(points[0]?.every ?? 1);
  const hi = Math.log2(points[points.length - 1]?.every ?? 12);
  const xOf = (every: number) => pad.l + (hi > lo ? ((Math.log2(every) - lo) / (hi - lo)) * iw : iw / 2);
  const best = Math.max(0, ...points.map((p) => p.profitPerDay ?? 0));
  const top = niceTop(best);
  const yOf = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const known = points.filter((p) => p.profitPerDay !== null).map((p) => ({ ...p, x: xOf(p.every), y: yOf(p.profitPerDay!) }));
  const line = monotonePath(known);
  const area = known.length > 1 ? `${line} L${known[known.length - 1].x},${pad.t + ih} L${known[0].x},${pad.t + ih} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const mine = points.find((p) => p.every === selected) ?? null;
  const windowEnd = Math.min(selected * 2, points[points.length - 1]?.every ?? selected);
  const focus = hover ?? selected;
  const focusPoint = known.find((p) => p.every === focus) ?? null;
  const mineValue = mine?.profitPerDay ?? null;

  const nearest = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || !known.length) return null;
    const x = clientX - rect.left;
    return known.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a)).every;
  };

  if (!known.length)
    return (
      <p className="text-xs text-slate-500">
        {points.some((p) => p.insolvent)
          ? "Doesn't pay its starting layout back in time at any verified frequency."
          : emptyText ?? "Not verified at any frequency for this tier yet."}
      </p>
    );
  return (
    <div className="space-y-2">
      <div
        ref={wrap}
        className="relative select-none"
        onPointerMove={(e) => setHover(nearest(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const n = nearest(e.clientX);
          if (n !== null) onSelect?.(n);
        }}
        style={{ cursor: onSelect ? "pointer" : undefined }}
      >
        <svg width={width} height={H} className="block max-w-full" role="img" aria-label="Profit per day by online frequency">
          <defs>
            <linearGradient id={`freq-area-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`freq-line-${uid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgb(110 231 183)" />
              <stop offset="100%" stopColor="rgb(16 185 129)" />
            </linearGradient>
            <filter id={`freq-glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>

          {/* Late-login window: your frequency to twice it. */}
          {windowEnd > selected && (
            <g>
              <rect x={xOf(selected)} y={pad.t} width={xOf(windowEnd) - xOf(selected)} height={ih} fill="rgb(251 191 36 / 0.06)" />
              <text x={(xOf(selected) + xOf(windowEnd)) / 2} y={pad.t + ih - 7} textAnchor="middle" fontSize={10} fill="rgb(252 211 77 / 0.7)">
                Forgiving range
              </text>
            </g>
          )}

          {/* Y grid and labels. */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={yOf(v)} y2={yOf(v)} stroke={v === 0 ? "rgb(71 85 105)" : "rgb(51 65 85 / 0.5)"} strokeDasharray={v === 0 ? undefined : "2 5"} />
              <text x={pad.l - 8} y={yOf(v) + 3.5} textAnchor="end" fontSize={10.5} fill="rgb(100 116 139)">
                {v === 0 ? "0" : formatCoins(v)}
              </text>
            </g>
          ))}

          {/* Your profit as a reference line. */}
          {mineValue !== null && mineValue > 0 && (
            <line x1={pad.l} x2={width - pad.r} y1={yOf(mineValue)} y2={yOf(mineValue)} stroke="rgb(252 211 77 / 0.35)" strokeDasharray="4 4" />
          )}

          {area && <path d={area} fill={`url(#freq-area-${uid})`} />}
          <path d={line} fill="none" stroke="rgb(52 211 153 / 0.35)" strokeWidth={6} filter={`url(#freq-glow-${uid})`} />
          <path d={line} fill="none" stroke={`url(#freq-line-${uid})`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* Focus guide. */}
          {focusPoint && <line x1={focusPoint.x} x2={focusPoint.x} y1={pad.t} y2={pad.t + ih} stroke="rgb(148 163 184 / 0.35)" strokeDasharray="3 3" />}

          {/* Points. */}
          {known.map((p) => {
            const isMine = p.every === selected;
            const isHover = p.every === hover;
            return (
              <g key={p.every}>
                {isMine && <circle cx={p.x} cy={p.y} r={11} fill="rgb(252 211 77 / 0.15)" />}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isMine ? 6 : isHover ? 5 : 3.5}
                  fill={isMine ? "rgb(252 211 77)" : "rgb(15 23 42)"}
                  stroke={isMine ? "rgb(254 243 199)" : "rgb(52 211 153)"}
                  strokeWidth={isMine ? 2 : 2}
                  style={{ transition: "r 150ms ease-out" }}
                />
              </g>
            );
          })}

          {/* Frequencies where the starting layout isn't paid back in time: not ranked. */}
          {points
            .filter((p) => p.insolvent)
            .map((p) => (
              <g key={`x${p.every}`} stroke="rgb(248 113 113)" strokeWidth={2} strokeLinecap="round">
                <title>Online every {p.every}: doesn't pay its starting layout back in time, not ranked</title>
                <line x1={xOf(p.every) - 4} x2={xOf(p.every) + 4} y1={yOf(0) - 4} y2={yOf(0) + 4} />
                <line x1={xOf(p.every) - 4} x2={xOf(p.every) + 4} y1={yOf(0) + 4} y2={yOf(0) - 4} />
              </g>
            ))}

          {/* X labels: cycles, and the real time between logins. */}
          {points.map((p) => {
            const x = xOf(p.every);
            const isMine = p.every === selected;
            return (
              <g key={p.every}>
                <text x={x} y={pad.t + ih + 16} textAnchor="middle" fontSize={12} fontWeight={isMine ? 700 : 500} fill={isMine ? "rgb(253 230 138)" : "rgb(148 163 184)"}>
                  {p.every}
                </text>
                <text x={x} y={pad.t + ih + 30} textAnchor="middle" fontSize={9.5} fill="rgb(100 116 139)">
                  {fmtHours(p.every * hoursPerCycle)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Tooltip for the focused point. */}
        {focusPoint && (
          <div
            className={`pointer-events-none absolute z-10 min-w-[9.5rem] -translate-x-1/2 rounded-lg border border-slate-600/60 bg-slate-900/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur-sm transition-[left,top] duration-150 ease-out ${
              focusPoint.y > 90 ? "-translate-y-full" : ""
            }`}
            style={{
              left: Math.min(width - 84, Math.max(84, focusPoint.x)),
              // Above the point when there is room, else below it; never over the point itself.
              top: focusPoint.y > 90 ? focusPoint.y - 14 : focusPoint.y + 14,
            }}
          >
            <div className="text-[10px] uppercase tracking-wide text-slate-500">
              every {focusPoint.every} cycle{focusPoint.every === 1 ? "" : "s"} · ≈ {fmtHours(focusPoint.every * hoursPerCycle)}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-sm font-semibold tabular-nums text-amber-300">{formatCoins(focusPoint.profitPerDay!)}</span>
              <span className="text-slate-500">/ day</span>
            </div>
            <div className="text-[11px] tabular-nums text-slate-400">
              {best > 0 ? `${Math.round((focusPoint.profitPerDay! / best) * 100)}% of the best` : ""}
              {mineValue !== null && mineValue > 0 && focusPoint.every !== selected && (
                <span className={focusPoint.profitPerDay! >= mineValue ? " text-emerald-300" : " text-red-300"}>
                  {" "}
                  · {focusPoint.profitPerDay! >= mineValue ? "+" : ""}
                  {Math.round(((focusPoint.profitPerDay! - mineValue) / mineValue) * 100)}% vs {selectedLabel}
                </span>
              )}
              {focusPoint.every === selected && <span className="text-amber-200"> · {selectedLabel}</span>}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>Online every N cycles (and the time between logins at your speed).</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-amber-100/60" /> {selectedLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-amber-400/15" /> Forgiving range: what you'd make if you came back up to twice as late
        </span>
      </div>
    </div>
  );
};
