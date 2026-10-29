import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Code2, Flag, Loader2, Repeat, RotateCcw, TrendingUp } from "lucide-react";
import type { FlowDetail, FlowSeedResult, FlowStatusResponse } from "../../leaderboard/api";
import type { Board, CellKind } from "../../leaderboard/rules";
import { valueResult, type Quotes } from "../../leaderboard/pricing";
import { spreadRatio, type RunResult } from "../../leaderboard/result";
import {
  BOARD_LABEL,
  CELL_KIND_LABEL,
  KIT_MARGIN,
  prepDays,
  stopsAt,
  kitSummaryText,
  needLines,
  percent,
  rampText,
  ratioText,
  starvedList,
  starvedText,
  STALL_CELLS,
  TIER_LABEL,
  upkeepLines,
  usedUpLines,
  type BoardNumber,
  type ItemLine,
  type SourceLine,
  type StepNamer,
} from "../../leaderboard/view";
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
import { LayoutThumb, MutationChip } from "./FlowVisuals";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";

const DATA = defaultGameData();

/** A labelled stat tile. */
export const StatTile: React.FC<{ label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: string; title?: string }> = ({ label, value, sub, tone = "text-slate-100", title }) => (
  <div className="min-w-0 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2.5" title={title}>
    <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-0.5 text-base font-semibold tabular-nums ${tone}`}>{value}</div>
    {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
  </div>
);

const KIND_SUB: Record<CellKind, string> = {
  ironman: "Ironman · from nothing",
  ironman_kit: "Ironman · with the starting items",
  normal: "Normal · Bazaar",
};

/** The three numbers side by side (from nothing, with the starting items, normal); the current one highlighted, the others switch to theirs. */
export const BoardNumbers: React.FC<{ numbers: BoardNumber[]; current: CellKind; onSelect: (k: CellKind) => void; tierLabel: string; every: number }> = ({ numbers, current, onSelect, tierLabel, every }) => (
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-label="Boards" data-testid="board-numbers">
    {numbers.map((n) => {
      const active = n.kind === current;
      const negative = n.profitPerDay !== null && n.profitPerDay < 0;
      const cantMake = n.kind === "ironman" && n.prep !== null && !n.prep.done;
      const kitValue = numbers.find((x) => x.kind === "ironman_kit")?.profitPerDay ?? null;
      const stops = n.kind === "ironman" && stopsAt(n.slowing, n.profitPerDay, kitValue);
      const sub =
        n.profitPerDay === null
          ? "not verified yet"
          : n.kind === "normal"
            ? [n.boughtPerDay > 0 ? `${formatCoins(n.boughtPerDay)}/day bought` : null, n.buildCost > 0 ? `${formatCoins(n.buildCost)} to build` : null].filter(Boolean).join(" · ") || "nothing to buy"
            : cantMake
              ? "can't make its starting items in time"
              : stops
                ? "stops once its starting items run out"
                : n.slowing
                  ? "settles lower once its starting items run out"
                  : n.kind === "ironman"
                    ? n.prep
                      ? Object.keys(n.prep.kit).length === 0
                        ? "no starting items needed"
                        : `starting items made in ${Math.max(1, Math.round(prepDays(n.prep)))} day${Math.round(prepDays(n.prep)) <= 1 ? "" : "s"}`
                      : "builder first, then the flow"
                    : "if you own the starting items";
      return (
        <button
          key={n.kind}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onSelect(n.kind)}
          title={active ? `${CELL_KIND_LABEL[n.kind]}: ${tierLabel} tier, online every ${every}` : `Show this flow's ${CELL_KIND_LABEL[n.kind]} number`}
          className={`min-w-0 rounded-lg border px-3 py-2.5 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] ${
            active ? "border-emerald-500/50 bg-emerald-500/10 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)]" : "border-slate-700/50 bg-slate-900/40 hover:border-slate-500/50 hover:bg-slate-800/60"
          }`}
          data-testid={`board-number-${n.kind}`}
        >
          <div className={`text-[10px] font-medium uppercase tracking-wide ${active ? "text-emerald-300" : "text-slate-500"}`}>{KIND_SUB[n.kind]}</div>
          <div className={`mt-0.5 font-bold tabular-nums leading-tight ${active ? "text-3xl" : "text-2xl"} ${n.profitPerDay === null ? "text-slate-500" : negative ? "text-red-300" : active ? "text-amber-300" : "text-amber-200/80"}`}>
            {n.profitPerDay === null ? "—" : formatCoins(n.profitPerDay)}
            <span className="ml-1 text-xs font-normal text-slate-500">/ day</span>
          </div>
          <div className={`mt-0.5 min-h-[1rem] text-[11px] ${cantMake || stops ? "text-amber-300/90" : "text-slate-500"}`}>{sub}</div>
        </button>
      );
    })}
  </div>
);

/** "With starting items": what to start with, what is used up once, and what it needs every day after that. */
export const WhatYouNeed: React.FC<{ result: Pick<RunResult, "startItems" | "sessionOnly" | "usedUp" | "upkeep"> }> = ({ result }) => {
  const need = needLines(result);
  const used = usedUpLines(result.usedUp);
  const upkeep = upkeepLines(result.upkeep);
  return (
    <div className="space-y-3 text-xs" data-testid="what-you-need">
      <p className="text-slate-200" data-testid="kit-summary">
        {kitSummaryText(result)}
      </p>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-slate-500">
          <span>To start with</span>
          {need.length > 0 && <span className="normal-case tracking-normal">needs · bring (+{Math.round(KIT_MARGIN * 100)}%)</span>}
        </div>
        {need.length === 0 ? (
          <p className="text-emerald-300">None: it starts from an empty inventory.</p>
        ) : (
          <ul className="space-y-1">
            {need.map((l) => (
              <li key={l.item} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2">
                <CropImage cropId={l.item} cropName={nameOf(l.item)} size="custom" width={18} height={18} showFallback />
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-slate-200">{nameOf(l.item)}</span>
                  {l.sessionOnly && (
                    <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-cyan-500/30 bg-cyan-500/10 px-1 text-[10px] text-cyan-200" title="Only borrowed for a moment within a login and given back before it ends">
                      <RotateCcw className="h-2.5 w-2.5" /> returned each session
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap tabular-nums text-slate-400">
                  needs {l.needs.toLocaleString("en-US")} · <span className="font-medium text-slate-100">bring {l.bring.toLocaleString("en-US")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {used.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Used up once</div>
          <p className="text-slate-300" title="Part of the starting items that isn't given back by the end of the run (not counting the daily upkeep)">
            {used.map((u, i) => (
              <span key={u.item}>
                {i > 0 ? ", " : ""}
                uses up <span className="tabular-nums text-amber-200">{u.units.toLocaleString("en-US")}</span> {nameOf(u.item)} once
              </span>
            ))}
          </p>
        </div>
      )}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Then per day (upkeep)</div>
        {upkeep.length === 0 ? (
          <p className="text-emerald-300">None: it gives back everything it borrows.</p>
        ) : (
          <ul className="space-y-0.5">
            {upkeep.map((u) => (
              <li key={u.item} className="flex items-center gap-2 text-amber-300">
                <CropImage cropId={u.item} cropName={nameOf(u.item)} size="custom" width={16} height={16} showFallback />
                <span className="tabular-nums">{Math.ceil(u.perDay - 1e-9).toLocaleString("en-US")}</span> {nameOf(u.item)} / day
              </li>
            ))}
            <li className="pt-0.5 text-[11px] text-slate-500">It uses these up faster than it grows them: you supply them every day, on top of the starting items.</li>
          </ul>
        )}
      </div>
    </div>
  );
};

/** "Layout complete after ~16 days · then 12.3M/day". */
export const RampLine: React.FC<{ result: Pick<RunResult, "ramp" | "days" | "cycles">; steadyPerDay: number | null }> = ({ result, steadyPerDay }) => {
  const text = rampText(result, steadyPerDay);
  if (!text) return null;
  const never = result.ramp?.complete === null;
  return (
    <p className={`flex items-center gap-1.5 text-xs ${never ? "text-amber-200/90" : "text-slate-300"}`} data-testid="ramp-line" title="When the layouts first had every cell filled, and the rate over the second half of the run">
      <TrendingUp className={`h-3.5 w-3.5 ${never ? "text-amber-400" : "text-emerald-400"}`} /> {text}
    </p>
  );
};

/** Layout cells left empty for lack of stock (author feedback); ≥ STALL_CELLS highlighted. Null when there are none. */
export const EmptyCells: React.FC<{ starved: unknown; stepName: StepNamer }> = ({ starved, stepName }) => {
  const list = starvedList(starved);
  if (!list.length) return null;
  return (
    <ul className="space-y-1 text-xs" data-testid="empty-cells">
      {list.map((e) => {
        const hot = e.cells >= STALL_CELLS;
        return (
          <li key={`${e.plot}|${e.step}|${e.item}`} className={`flex items-center gap-2 rounded-md px-2 py-1 ${hot ? "border border-amber-500/30 bg-amber-500/10 text-amber-200" : "text-slate-300"}`}>
            <CropImage cropId={e.item} cropName={nameOf(e.item)} size="custom" width={16} height={16} showFallback />
            <span className="min-w-0 break-words">{starvedText(e, stepName)}</span>
          </li>
        );
      })}
    </ul>
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
            <LayoutThumb layout={step.layout} maxCell={30} tooltips className="w-full" />
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
        the median seed, so no single lucky seed counts.
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
            const b = (j.runKind === "normal" || j.board === "normal" ? "normal" : j.runKind || j.board ? "ironman" : null) as Board | null;
            return (
              <li key={j.id ?? i} className="space-y-1">
                <div className="flex flex-wrap gap-x-2">
                  <span className="text-slate-400">
                    {b ? BOARD_LABEL[b] : String(j.board)} · {TIER_LABEL[j.tier as TierId] ?? j.tier} tier · {j.priority === "A" ? "goes live after this" : "background"}
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
      {pending && <p className="text-slate-500">The server simulates every online frequency with 5 secret seeds, for Ironman (with and without the starting items) and Normal; this takes a few minutes. This updates by itself.</p>}
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
