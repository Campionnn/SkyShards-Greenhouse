import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Code2, Flag, Loader2, Repeat } from "lucide-react";
import type { FlowDetail, FlowSeedResult, FlowStatusResponse } from "../../leaderboard/api";
import type { RunResult } from "../../leaderboard/result";
import type { Board } from "../../leaderboard/rules";
import { valueResult, type Quotes } from "../../leaderboard/pricing";
import { spreadRatio } from "../../leaderboard/result";
import { BOARD_LABEL, percent, ratioText, TIER_LABEL, type FrequencyPoint, type ItemLine, type SourceLine } from "../../leaderboard/view";
import type { TierId } from "../../leaderboard/tiers";
import type { BazaarPricing } from "../../simulator";
import { defaultGameData, describeConditions } from "../../simulator";
import type { FlowStep } from "../../simulator/flow/types";
import { getFlowStatus, reportFlow } from "../../services/flowsService";
import { CropImage } from "../shared";
import { formatCoins, formatRate, nameOf } from "../simulator/format";
import { buttonClass, inputClass } from "../simulator/styles";
import { useToast } from "../ui";
import { Badge } from "./FlowControls";
import { EFFORT_LABEL } from "./flowsDisplay";
import { LayoutThumb, MutationChip } from "./FlowVisuals";
import { DialogFrame, ModalDialog } from "./ModalDialog";

const DATA = defaultGameData();

/** Weight of each action kind (config.ts EFFORT_WEIGHTS), for the "share of the work" bars. */
const EFFORT_WEIGHT: Record<string, number> = { water: 1, harvest: 1, minigame: 2, replant: 1, place: 3, remove: 3, replace: 3, roots: 2, ground: 2, gate: 1, noctilume: 1, stepChange: 2, bazaar: 2 };

/** A labelled stat tile. */
export const StatTile: React.FC<{ label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: string; title?: string }> = ({ label, value, sub, tone = "text-slate-100", title }) => (
  <div className="min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2.5" title={title}>
    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-0.5 text-base font-semibold tabular-nums ${tone}`}>{value}</div>
    {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
  </div>
);

/** Effort per login, broken down by action, weighted by how much work each is. */
export const EffortBreakdown: React.FC<{ result: RunResult }> = ({ result }) => {
  const rows = Object.entries(result.effort.byKind)
    .map(([k, n]) => ({ k, n: n ?? 0, w: (n ?? 0) * (EFFORT_WEIGHT[k] ?? 1) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.w - a.w);
  const total = rows.reduce((s, r) => s + r.w, 0);
  if (!rows.length) return <p className="text-xs text-slate-500">No actions recorded.</p>;
  return (
    <ul className="space-y-1.5" aria-label="Effort by action">
      {rows.map((r) => (
        <li key={r.k} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-xs">
          <span className="truncate text-slate-300">{EFFORT_LABEL[r.k] ?? r.k}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-slate-700/40">
            <span className="block h-full rounded-full bg-emerald-400/70" style={{ width: `${total > 0 ? (r.w / total) * 100 : 0}%` }} />
          </span>
          <span className="w-24 text-right tabular-nums text-slate-400">{formatRate(r.n)} / login</span>
        </li>
      ))}
    </ul>
  );
};

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
export const FrequencyChart: React.FC<{ points: FrequencyPoint[]; selected: number; hoursPerCycle: number; onSelect?: (every: number) => void }> = ({ points, selected, hoursPerCycle, onSelect }) => {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
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

  if (!known.length) return <p className="text-xs text-slate-500">Not verified at any frequency for this tier yet.</p>;
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
            <linearGradient id="freq-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="freq-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgb(110 231 183)" />
              <stop offset="100%" stopColor="rgb(16 185 129)" />
            </linearGradient>
            <filter id="freq-glow" x="-50%" y="-50%" width="200%" height="200%">
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

          {area && <path d={area} fill="url(#freq-area)" />}
          <path d={line} fill="none" stroke="rgb(52 211 153 / 0.35)" strokeWidth={6} filter="url(#freq-glow)" />
          <path d={line} fill="none" stroke="url(#freq-line)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

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
                  {Math.round(((focusPoint.profitPerDay! - mineValue) / mineValue) * 100)}% vs yours
                </span>
              )}
              {focusPoint.every === selected && <span className="text-amber-200"> · yours</span>}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span>Online every N cycles (and the time between logins at your speed).</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300 ring-2 ring-amber-100/60" /> yours
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-amber-400/15" /> Forgiving range: what you'd make if you came back up to twice as late
        </span>
      </div>
    </div>
  );
};

/** Rows a breakdown list shows before the rest scrolls (like the simulator's inventory sections). */
const LIST_ROWS_SHOWN = 8;

/**
 * A `<ul>` that shows its first `LIST_ROWS_SHOWN` rows and scrolls the rest. The cap is measured from the rows
 * themselves (they differ in height between the two lists), with a rough rem estimate until the first measure.
 */
const ScrollList: React.FC<{ count: number; label: string; estimateRem: number; children: React.ReactNode }> = ({ count, label, estimateRem, children }) => {
  const ref = useRef<HTMLUListElement>(null);
  const scrolls = count > LIST_ROWS_SHOWN;
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!scrolls || !el) return;
    const measure = () => {
      const next = el.children[LIST_ROWS_SHOWN] as HTMLElement | undefined;
      // The list is `relative`, so a row's offsetTop is measured from the list's top. Cut a little into the
      // next row so it's clear there is more.
      if (next) setMaxHeight(next.offsetTop + Math.min(12, next.offsetHeight / 3));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrolls, count]);
  return (
    <>
      <ul
        ref={ref}
        className={`relative divide-y divide-slate-700/30 ${scrolls ? "overflow-y-auto overscroll-contain scrollbar-dark pr-3 [scrollbar-gutter:stable]" : ""}`}
        style={scrolls ? { maxHeight: maxHeight !== null ? `${maxHeight}px` : `${LIST_ROWS_SHOWN * estimateRem + 0.75}rem` } : undefined}
        aria-label={label}
        tabIndex={scrolls ? 0 : undefined}
      >
        {children}
      </ul>
      {scrolls && <p className="mt-1.5 text-[11px] text-slate-500">{count} total · scroll for more</p>}
    </>
  );
};

/** Money by source: which harvested plants the coins come from, each with what it drops. */
export const SourceBreakdown: React.FC<{ lines: SourceLine[] }> = ({ lines }) => {
  const shown = lines.filter((l) => l.coinsPerDay > 0);
  if (!shown.length) return <p className="text-xs text-slate-500">No per-plant numbers for this entry yet (it was verified before they were recorded).</p>;
  const total = shown.reduce((s, l) => s + l.coinsPerDay, 0);
  return (
    <ScrollList count={shown.length} label="Money by source" estimateRem={3.6}>
      {shown.map((l) => {
        const share = total > 0 ? l.coinsPerDay / total : 0;
        const items = Object.entries(l.items).sort((a, b) => b[1] - a[1]);
        return (
          <li key={l.kind} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
            <CropImage cropId={l.kind} cropName={nameOf(l.kind)} size="custom" width={22} height={22} showFallback />
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-slate-200">
                  {nameOf(l.kind)}
                  <span className="text-slate-500"> {l.isMutation ? "harvests" : "crops"}</span>
                </span>
                <span className="whitespace-nowrap tabular-nums text-slate-500">{Math.round(share * 100)}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-700/40">
                <div className={`h-full rounded-full ${l.isMutation ? "bg-amber-400/70" : "bg-emerald-400/70"}`} style={{ width: `${share * 100}%` }} />
              </div>
              <div className="mt-1 truncate text-[10px] text-slate-500" title={items.map(([i, n]) => `${formatRate(n)} ${nameOf(i)}`).join(", ")}>
                drops {items.slice(0, 3).map(([i, n]) => `${formatRate(n)} ${nameOf(i)}`).join(", ")}
                {items.length > 3 ? ", ..." : ""} per day
              </div>
            </div>
            <span className="w-16 text-right text-xs font-medium tabular-nums text-emerald-300">{formatCoins(l.coinsPerDay)}</span>
          </li>
        );
      })}
    </ScrollList>
  );
};

/** Per-item value: a ranked list with shares. */
export const ItemBreakdown: React.FC<{ lines: ItemLine[] }> = ({ lines }) => {
  if (!lines.length) return <p className="text-xs text-slate-500">Nothing produced in this cell.</p>;
  const positive = lines.filter((l) => l.coinsPerDay > 0).reduce((s, l) => s + l.coinsPerDay, 0);
  return (
    <ScrollList count={lines.length} label="Items per day" estimateRem={2.9}>
      {lines.map((l) => {
        const share = positive > 0 && l.coinsPerDay > 0 ? l.coinsPerDay / positive : 0;
        return (
          <li key={`${l.kind}-${l.item}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
            <CropImage cropId={l.item} cropName={nameOf(l.item)} size="custom" width={22} height={22} showFallback />
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-slate-200">
                  {nameOf(l.item)}
                  {l.kind === "bought" && <span className="text-slate-500"> bought</span>}
                </span>
                <span className="whitespace-nowrap tabular-nums text-slate-500">
                  {formatRate(l.perDay)}/day × {l.unitPrice === null ? "no price" : formatCoins(l.unitPrice)}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-700/40">
                <div className={`h-full rounded-full ${l.coinsPerDay < 0 ? "bg-red-400/70" : "bg-emerald-400/70"}`} style={{ width: `${l.coinsPerDay < 0 ? 100 : share * 100}%` }} />
              </div>
            </div>
            <span className={`w-16 text-right text-xs font-medium tabular-nums ${l.coinsPerDay < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatCoins(l.coinsPerDay)}</span>
          </li>
        );
      })}
    </ScrollList>
  );
};

/** "→ step 2 when 9 Chorus Fruit fully grown" for one step's exits. */
function exitText(step: FlowStep, steps: FlowStep[]): string {
  const name = (id: string) => {
    const i = steps.findIndex((s) => s.id === id);
    return i >= 0 ? `step ${i + 1}` : id;
  };
  if (!step.exits.length) return "stays here";
  return step.exits
    .map((e) => `${e.to !== undefined ? `to ${name(e.to)}` : "next"} when ${e.when.length ? describeConditions(e.when, e.match, name, nameOf) : "never"}`)
    .join("; otherwise ");
}

/** Every plot's flow, step by step, drawn as the real layouts. */
export const FlowWalkthrough: React.FC<{ detail: FlowDetail }> = ({ detail }) => {
  const plots = detail.payload?.plots ?? [];
  const summaries = new Map((detail.summary?.plots ?? []).map((p) => [p.id, p]));
  const [active, setActive] = useState<Record<number, number>>({});
  if (!plots.length) return <p className="text-xs text-slate-500">No layouts in this entry.</p>;
  return (
    <div className={`grid grid-cols-1 gap-4 ${plots.length > 1 ? "lg:grid-cols-2" : ""} ${plots.length > 2 ? "xl:grid-cols-3" : ""}`}>
      {plots.map((p) => {
        const steps = p.flow.steps;
        const idx = Math.min(active[p.id] ?? p.flow.startIndex ?? 0, steps.length - 1);
        const step = steps[idx];
        const sum = summaries.get(p.id);
        const targets = Object.entries(sum?.targets ?? {}).sort((a, b) => b[1] - a[1]);
        return (
          <article key={p.id} className="min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
            <header className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-100">Plot {p.id}</span>
              <span className="text-[11px] text-slate-500">
                {steps.length} step{steps.length === 1 ? "" : "s"}
              </span>
              {p.flow.loop && steps.length > 1 && (
                <Badge tone="info" icon={<Repeat />}>
                  loops
                </Badge>
              )}
              {p.script?.source.trim() && (
                <Badge tone="violet" icon={<Code2 />}>
                  script
                </Badge>
              )}
            </header>
            <LayoutThumb layout={step.layout} maxCell={30} tooltips compass className="w-full" />
            {steps.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label={`Plot ${p.id} steps`}>
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === idx}
                    onClick={() => setActive((cur) => ({ ...cur, [p.id]: i }))}
                    title={s.label || `Step ${i + 1}`}
                    className={`rounded-md border px-2 py-0.5 text-[11px] tabular-nums transition-colors ${
                      i === idx ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-200" : "border-slate-600/40 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 space-y-1 text-xs">
              <div className="font-medium text-slate-200">
                {steps.length > 1 ? `Step ${idx + 1}` : "Layout"}
                {step.label ? <span className="font-normal text-slate-400"> · {step.label}</span> : null}
              </div>
              {steps.length > 1 && (
                <p className="flex items-start gap-1 text-slate-400">
                  <ArrowRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-500" />
                  <span className="break-words">{exitText(step, steps)}</span>
                </p>
              )}
            </div>
            {targets.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {targets.map(([id, n]) => (
                  <MutationChip key={id} id={id} count={n} />
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};

/** Per-seed results of the chosen cell. */
export const SeedTable: React.FC<{ seeds: FlowSeedResult[]; board: Board; quotes: Quotes; pricing: BazaarPricing }> = ({ seeds, board, quotes, pricing }) => {
  const rows = seeds
    .slice()
    .sort((a, b) => a.seedIndex - b.seedIndex)
    .map((s) => ({ s, profit: valueResult(DATA, s.result, board, board === "normal" ? quotes : {}, pricing).profitPerDay }));
  const ratio = spreadRatio(rows.map((r) => r.profit));
  const best = Math.max(1, ...rows.map((r) => r.profit));
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {rows.map(({ s, profit }) => (
          <li key={s.seedIndex} className="grid grid-cols-[2.5rem_1fr_auto_auto] items-center gap-3 text-xs">
            <span className="text-slate-500">#{s.seedIndex + 1}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-slate-700/40">
              <span className="block h-full rounded-full bg-emerald-400/60" style={{ width: `${Math.max(0, profit / best) * 100}%` }} />
            </span>
            <span className="w-14 text-right tabular-nums text-emerald-300">{formatCoins(profit)}</span>
            <span className="w-16 text-right tabular-nums text-slate-500">{percent(s.result.uptime)} up</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-500">
        Best / median: <span className={ratio > 2 ? "text-red-300" : "text-slate-300"}>{ratioText(ratio)}</span> (the server rejects over 2×). The ranking uses
        the median of every item over these seeds, so no single lucky seed counts.
      </p>
    </div>
  );
};

const JOB_TONE: Record<string, string> = { done: "text-emerald-300", running: "text-blue-300", failed: "text-red-300", queued: "text-slate-400" };

/** Owner: verification progress; polls every 5 s while pending. */
export const StatusBox: React.FC<{ id: string; initial: string; onLive?: () => void }> = ({ id, initial, onLive }) => {
  const [status, setStatus] = useState<FlowStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = (status?.status ?? initial) === "pending";
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      getFlowStatus(id)
        .then((s) => {
          if (!live) return;
          setStatus(s);
          setError(null);
          if (s.status === "pending") timer = setTimeout(poll, 5000);
          else if (s.status === "live") onLive?.();
        })
        .catch((e: unknown) => {
          if (!live) return;
          setError(e instanceof Error ? e.message : String(e));
          timer = setTimeout(poll, 5000);
        });
    };
    poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // onLive is a notification only; re-polling on its identity would restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const s = status?.status ?? initial;
  return (
    <div className="space-y-2 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 text-xs" data-testid="flow-status">
      <div className="flex items-center gap-2">
        <span className="text-slate-300">Verification:</span>
        <Badge tone={s === "live" ? "new" : s === "rejected" ? "danger" : s === "hidden" ? "stale" : "pending"}>{s === "hidden" ? "hidden pending review" : s}</Badge>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-300" />}
      </div>
      {status?.rejectReason && <div className="break-words text-red-300">{status.rejectReason}</div>}
      {error && <div className="text-amber-300">Could not refresh the status: {error}</div>}
      {status?.jobs.length ? (
        <ul className="space-y-1.5">
          {status.jobs.map((j, i) => {
            const frac = j.total ? Math.min(1, (j.done ?? 0) / j.total) : 0;
            const label = j.status === "queued" && j.queuePosition ? `queued · #${j.queuePosition} in line` : j.status === "running" && j.total ? `running · ${j.done ?? 0}/${j.total} runs` : j.status;
            return (
              <li key={i} className="space-y-1">
                <div className="flex flex-wrap gap-x-2">
                  <span className="text-slate-400">
                    {BOARD_LABEL[j.board]} · {TIER_LABEL[j.tier as TierId] ?? j.tier} tier · {j.priority === "A" ? "goes live after this" : "background"}
                  </span>
                  <span className={JOB_TONE[j.status] ?? "text-slate-300"}>{label}</span>
                  {j.error && <span className="break-words text-red-300">{j.error}</span>}
                </div>
                {j.status === "running" && j.total ? (
                  <div className="h-1 overflow-hidden rounded bg-slate-700/60">
                    <div className="h-full bg-blue-400/70 transition-[width] duration-500" style={{ width: `${Math.round(frac * 100)}%` }} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {pending && <p className="text-slate-500">The server simulates every online frequency with 5 secret seeds; this takes a few minutes. This updates by itself.</p>}
    </div>
  );
};

/** The report dialog body (exported for SSR tests). */
export const ReportPanel: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await reportFlow(id, reason.trim());
      toast({ title: ok ? "Report sent" : "Already reported", description: ok ? "Thanks. A moderator will take a look." : "You reported this flow before.", variant: ok ? "success" : "info" });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogFrame
      id="report-flow-title"
      title={
        <>
          <Flag className="h-4 w-4 text-red-300" /> Report this flow
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonClass.neutral} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonClass.danger} onClick={send} disabled={busy || !reason.trim()}>
            <Flag className="h-3.5 w-3.5" /> {busy ? "Sending..." : "Send report"}
          </button>
        </>
      }
    >
      <label className="block space-y-1 text-xs text-slate-300">
        <span>What's wrong? (offensive text, a copied flow, a broken entry...)</span>
        <textarea className={`${inputClass} h-24 w-full`} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <span className="block text-right text-[11px] text-slate-500">{reason.length} / 200</span>
      </label>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </DialogFrame>
  );
};

export const ReportDialog: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => (
  <ModalDialog labelledBy="report-flow-title" onClose={onClose} maxWidth="max-w-md">
    <ReportPanel id={id} onClose={onClose} />
  </ModalDialog>
);
