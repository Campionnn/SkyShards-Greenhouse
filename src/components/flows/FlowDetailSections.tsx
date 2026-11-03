import React, { useEffect, useState } from "react";
import { ExternalLink, Flag, FlaskConical, LoaderCircle } from "lucide-react";
import type { FlowDetail, FlowSeedResult, FlowStatusResponse } from "../../leaderboard/api";
import type { Board, CellKind } from "../../leaderboard/rules";
import { valueResult, type Quotes } from "../../leaderboard/pricing";
import { spreadRatio, type RunResult } from "../../leaderboard/result";
import {
  BOARD_LABEL,
  KIT_MARGIN,
  kitSummaryText,
  needLines,
  OUTLIER_RATIO,
  percent,
  rampText,
  ratioText,
  REPORT_MAX,
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
import { layoutCode } from "../simulator/scenarioEdit";
import { formatCoins, formatRate, formatUnitPrice, nameOf } from "../simulator/format";
import { useToast } from "../ui";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { ButtonLink, KitButton, KitLabel, KitTextarea, Pill, Segmented } from "../ui/kit";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { LayoutThumb, MutationChip } from "./FlowVisuals";
import { KIND_BOARD, KIND_NAME, KIND_SHORT, LIST_ROWS, numberSub, SEEDS_MAX_TIER, SEEDS_OTHER_TIERS } from "./detail/detailText";

/**
 * The /flows/:id sections (FlowDetailPage composes them), on the design system: flat lists, the
 * kit, `coin` for coins. StatusBox, ReportDialog and FlowMarkdown are also used by the simulator's
 * Leaderboard tab and submit dialog.
 */

const DATA = defaultGameData();

/** A labelled number (kept for callers; the detail page uses the summary strip). */
export const StatTile: React.FC<{ label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: string; title?: string }> = ({ label, value, sub, tone = "text-fg", title }) => (
  <div className="min-w-0" title={title}>
    <div className="truncate text-meta text-fg-meta">{label}</div>
    <div className={cn("text-title tabular-nums", tone)}>{value}</div>
    {sub && <div className="text-meta text-fg-meta">{sub}</div>}
  </div>
);

/**
 * The three numbers side by side (from nothing, with the starting items, Normal), a radio group:
 * the current one is large in `coin` with the `select` underline, the others smaller and muted;
 * clicking one switches the board and the starting-items switch. `deltas` (optional) replaces each
 * sub-line with "−x% vs max stats".
 */
export const BoardNumbers: React.FC<{
  numbers: BoardNumber[];
  current: CellKind;
  onSelect: (k: CellKind) => void;
  tierLabel: string;
  every: number;
  deltas?: Partial<Record<CellKind, string | null>>;
  compact?: boolean;
}> = ({ numbers, current, onSelect, tierLabel, every, deltas, compact }) => (
  <div role="radiogroup" aria-label="Board" className={cn("grid grid-cols-3", compact ? "gap-1" : "divide-x divide-line")} data-testid="board-numbers">
    {numbers.map((n) => {
      const on = n.kind === current;
      const negative = n.profitPerDay !== null && n.profitPerDay < 0;
      const sub = numberSub(n, numbers);
      const delta = deltas?.[n.kind] ?? null;
      return (
        <button
          key={n.kind}
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => onSelect(n.kind)}
          title={on ? `${KIND_NAME[n.kind]}: ${tierLabel} tier, online every ${every}` : `Show this flow's ${KIND_NAME[n.kind].toLowerCase()} number`}
          data-testid={`board-number-${n.kind}`}
          className={cn(
            "focus-ring-inset relative min-w-0 cursor-pointer text-left transition-colors duration-(--duration-hover)",
            compact ? "rounded-control px-2 py-2" : "px-4 py-3",
            on ? "bg-surface-hover" : "hover:bg-surface-hover/50",
          )}
        >
          <span className={cn("block truncate text-meta", on ? "text-fg-body" : "text-fg-meta")}>
            {compact ? KIND_SHORT[n.kind] : `${KIND_NAME[n.kind]} · ${KIND_BOARD[n.kind]}`}
          </span>
          <span
            className={cn(
              "block truncate tabular-nums",
              on ? "text-hero" : "text-title",
              n.profitPerDay === null ? "text-fg-meta" : negative ? "text-problem" : on ? "text-coin" : "text-fg-muted",
            )}
          >
            {n.profitPerDay === null ? "—" : formatCoins(n.profitPerDay)}
            {on && !compact && <span className="ml-1 text-secondary text-fg-meta">/ day</span>}
          </span>
          {!compact && (
            <span className={cn("block text-meta", delta ? "text-fg-muted" : sub.warn ? "text-warn" : "text-fg-meta")}>{delta ?? sub.text}</span>
          )}
          {compact && delta && <span className="block truncate text-meta text-fg-muted">{delta.replace(" vs max stats", "")}</span>}
          {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-select" />}
        </button>
      );
    })}
  </div>
);

const ItemRow: React.FC<{ id: string; children: React.ReactNode; right?: React.ReactNode; size?: number }> = ({ id, children, right, size = 20 }) => (
  <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2.5 py-1.5">
    <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={size} height={size} showFallback />
    <div className="min-w-0">{children}</div>
    {right}
  </li>
);

/** What you need (F75): to start with (needs · bring), used up once, then per day (upkeep). */
export const WhatYouNeed: React.FC<{ result: Pick<RunResult, "startItems" | "sessionOnly" | "usedUp" | "upkeep">; children?: React.ReactNode }> = ({ result, children }) => {
  const need = needLines(result);
  const used = usedUpLines(result.usedUp);
  const upkeep = upkeepLines(result.upkeep);
  return (
    <div className="space-y-4" data-testid="what-you-need">
      <p className="text-body text-fg-body" data-testid="kit-summary">
        {kitSummaryText(result)}
      </p>
      <section aria-label="To start with">
        <KitLabel actions={need.length > 0 ? <span className="text-meta tabular-nums text-fg-meta">needs · bring (+{Math.round(KIT_MARGIN * 100)}%)</span> : null}>To start with</KitLabel>
        {need.length === 0 ? (
          <p className="mt-1 text-body text-fg-body">None: it starts from an empty inventory.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {need.map((l) => (
              <ItemRow
                key={l.item}
                id={l.item}
                right={
                  <span className="whitespace-nowrap text-body tabular-nums text-fg-muted">
                    needs {l.needs.toLocaleString("en-US")} · <b className="font-semibold text-fg">bring {l.bring.toLocaleString("en-US")}</b>
                  </span>
                }
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-body text-fg-body">{nameOf(l.item)}</span>
                  {l.sessionOnly && <Pill title="Only borrowed for a moment within a login and given back before it ends">returned each session</Pill>}
                </span>
              </ItemRow>
            ))}
          </ul>
        )}
      </section>
      {used.length > 0 && (
        <p className="text-secondary text-fg-muted" title="Part of the starting items that isn't given back by the end of the run (not counting the daily upkeep)">
          Used up once:{" "}
          {used.map((u, i) => (
            <span key={u.item}>
              {i > 0 ? ", " : ""}
              <b className="font-semibold tabular-nums text-fg-body">{u.units.toLocaleString("en-US")}</b> {nameOf(u.item)}
            </span>
          ))}
        </p>
      )}
      <section aria-label="Then per day (upkeep)">
        <KitLabel
          actions={
            upkeep.length > 0 ? (
              <InfoHint title="Upkeep">It uses these up faster than it grows them: you supply them every day, on top of the starting items.</InfoHint>
            ) : null
          }
        >
          Then per day (upkeep)
        </KitLabel>
        {upkeep.length === 0 ? (
          <p className="mt-1 text-body text-fg-body">None: it gives back everything it borrows.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {upkeep.map((u) => (
              <ItemRow key={u.item} id={u.item} size={18} right={<span className="text-body tabular-nums text-warn">{Math.ceil(u.perDay - 1e-9).toLocaleString("en-US")} / day</span>}>
                <span className="block truncate text-body text-fg-body">{nameOf(u.item)}</span>
              </ItemRow>
            ))}
          </ul>
        )}
      </section>
      {children}
    </div>
  );
};

/** "Layout complete after ~16 days · then 12.3M/day" (F61). */
export const RampLine: React.FC<{ result: Pick<RunResult, "ramp" | "days" | "cycles">; steadyPerDay: number | null }> = ({ result, steadyPerDay }) => {
  const text = rampText(result, steadyPerDay);
  if (!text) return null;
  const never = result.ramp?.complete === null;
  return (
    <p className={cn("text-secondary", never ? "text-warn" : "text-fg-muted")} data-testid="ramp-line" title="When the layouts first had every cell filled, and the rate over the second half of the run">
      {text}
    </p>
  );
};

/** Layout cells left empty for lack of stock (F76): the sentence in body text, the count in warn when it holds a plot back. */
export const EmptyCells: React.FC<{ starved: unknown; stepName: StepNamer; limit?: number }> = ({ starved, stepName, limit = LIST_ROWS }) => {
  const [all, setAll] = useState(false);
  const list = starvedList(starved);
  if (!list.length) return null;
  const rows = all ? list : list.slice(0, limit);
  return (
    <div data-testid="empty-cells">
      <ul className="divide-y divide-line">
        {rows.map((e) => {
          const hot = e.cells >= STALL_CELLS;
          const text = starvedText(e, stepName);
          const m = /^(.*?: )([\d.]+)( .*)$/.exec(text);
          return (
            <ItemRow key={`${e.plot}|${e.step}|${e.item}`} id={e.item} size={18}>
              <span className="block text-secondary text-fg-body">
                {m ? (
                  <>
                    {m[1]}
                    <b className={cn("font-semibold tabular-nums", hot ? "text-warn" : "text-fg")}>{m[2]}</b>
                    {m[3]}
                  </>
                ) : (
                  text
                )}
              </span>
            </ItemRow>
          );
        })}
      </ul>
      {list.length > limit && (
        <LinkButton className="mt-1" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </LinkButton>
      )}
    </div>
  );
};

/** A list that shows `LIST_ROWS` rows and a "Show all N" button (no inner scrolling). */
const ShowAll: React.FC<{ count: number; label: string; noun: string; children: (limit: number) => React.ReactNode }> = ({ count, label, noun, children }) => {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className="divide-y divide-line" aria-label={label}>
        {children(all ? count : LIST_ROWS)}
      </ul>
      {count > LIST_ROWS && (
        <LinkButton className="mt-1" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${count} ${noun}`}
        </LinkButton>
      )}
    </>
  );
};

/** Money by source (F79): which harvested plants the coins come from, each with what it drops. */
export const SourceBreakdown: React.FC<{ lines: SourceLine[] }> = ({ lines }) => {
  const shown = lines.filter((l) => l.coinsPerDay > 0);
  if (!shown.length) return <p className="text-secondary text-fg-meta">No per-plant numbers for this entry yet (it was verified before they were recorded).</p>;
  const total = shown.reduce((s, l) => s + l.coinsPerDay, 0);
  return (
    <ShowAll count={shown.length} label="Money by source" noun="plants">
      {(limit) =>
        shown.slice(0, limit).map((l) => {
          const share = total > 0 ? l.coinsPerDay / total : 0;
          const drops = Object.entries(l.items)
            .sort((a, b) => b[1] - a[1])
            .map(([i, n]) => `${formatRate(n)} ${nameOf(i)}`)
            .join(", ");
          return (
            <ItemRow key={l.kind} id={l.kind} size={22} right={<span className="w-14 text-right text-body font-semibold tabular-nums text-coin">{formatCoins(l.coinsPerDay)}</span>}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-body text-fg-body">
                  {nameOf(l.kind)} <span className="text-fg-meta">{l.isMutation ? "harvests" : "crops"}</span>
                </span>
                <span className="whitespace-nowrap text-meta tabular-nums text-fg-meta">{Math.round(share * 100)}%</span>
              </span>
              <span className="block truncate text-meta text-fg-meta" title={drops}>
                drops {drops} per day
              </span>
            </ItemRow>
          );
        })
      }
    </ShowAll>
  );
};

/**
 * Per-item value (F78): a ranked list with shares; purchases negative in `problem`. With
 * `onEditPrice` (Normal board) each unit price is a button that opens the price editor on that item;
 * `overridden` marks the items priced with your own price.
 */
export const ItemBreakdown: React.FC<{ lines: ItemLine[]; onEditPrice?: (item: string) => void; overridden?: Readonly<Record<string, unknown>> }> = ({ lines, onEditPrice, overridden }) => {
  if (!lines.length) return <p className="text-secondary text-fg-meta">Nothing produced in this cell.</p>;
  const positive = lines.filter((l) => l.coinsPerDay > 0).reduce((s, l) => s + l.coinsPerDay, 0);
  return (
    <ShowAll count={lines.length} label="Items per day" noun="items">
      {(limit) =>
        lines.slice(0, limit).map((l) => {
          const share = positive > 0 && l.coinsPerDay > 0 ? l.coinsPerDay / positive : 0;
          return (
            <ItemRow
              key={`${l.kind}-${l.item}`}
              id={l.item}
              size={22}
              right={<span className={cn("w-14 text-right text-body font-semibold tabular-nums", l.coinsPerDay < 0 ? "text-problem" : "text-coin")}>{formatCoins(l.coinsPerDay)}</span>}
            >
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate text-body text-fg-body">
                  {nameOf(l.item)}
                  {l.kind === "bought" && <span className="text-fg-meta"> bought</span>}
                </span>
                <span className="whitespace-nowrap text-meta tabular-nums text-fg-meta">
                  {formatRate(l.perDay)}/day ×{" "}
                  {onEditPrice ? (
                    <button
                      type="button"
                      onClick={() => onEditPrice(l.item)}
                      aria-haspopup="dialog"
                      aria-label={`${nameOf(l.item)}: ${l.unitPrice === null ? "no price" : formatUnitPrice(l.unitPrice)}. Set your own price`}
                      title={overridden && l.item in overridden ? "Your own price (click to change)" : "Click to set your own price"}
                      className={cn(
                        "focus-ring hit-area cursor-pointer rounded-inner underline decoration-dotted underline-offset-[3px] transition-colors duration-(--duration-hover) hover:text-fg-body",
                        overridden && l.item in overridden && "text-select-fg hover:text-select-fg",
                      )}
                    >
                      {l.unitPrice === null ? "no price" : formatUnitPrice(l.unitPrice)}
                    </button>
                  ) : l.unitPrice === null ? (
                    "no price"
                  ) : (
                    formatUnitPrice(l.unitPrice)
                  )}
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-hover">
                <span className={cn("block h-full origin-left rounded-full", l.coinsPerDay < 0 ? "bg-problem/70" : "bg-fg-meta/60")} style={{ transform: `scaleX(${l.coinsPerDay < 0 ? 1 : share})` }} />
              </span>
            </ItemRow>
          );
        })
      }
    </ShowAll>
  );
};

/** "to step 2 when 9 Chorus Fruit fully grown" for one step's exits. */
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

/**
 * Every plot's flow (F82), step by step, as the real layouts (hover a cell for what it is). Plots
 * that run the same flow fold into one; otherwise a plot switcher. Steps are a list beside the
 * picture, the current one with its exits.
 */
export const FlowWalkthrough: React.FC<{
  detail: FlowDetail;
  /** Fixed cell size; omitted, the picture fits its column (up to `maxCell`). */
  cellSize?: number;
  maxCell?: number;
  stacked?: boolean;
  /** The simulator link that opens a plot's step in the layout editor; shows "Edit in simulator". */
  simAt?: (plot: number, step: number) => string;
}> = ({ detail, cellSize, maxCell = 40, stacked, simAt }) => {
  const plots = detail.payload?.plots ?? [];
  const summaries = new Map((detail.summary?.plots ?? []).map((p) => [p.id, p]));
  const [plotIdx, setPlotIdx] = useState(0);
  const [active, setActive] = useState<Record<number, number>>({});
  if (!plots.length) return <p className="text-secondary text-fg-meta">No layouts in this entry.</p>;
  const key = (p: (typeof plots)[number]) => JSON.stringify([p.flow, p.script ?? null]);
  const same = plots.length > 1 && plots.every((p) => key(p) === key(plots[0]));
  const p = plots[same ? 0 : Math.min(plotIdx, plots.length - 1)];
  const steps = p.flow.steps;
  const idx = Math.min(active[p.id] ?? p.flow.startIndex ?? 0, steps.length - 1);
  const step = steps[idx];
  const targets = Object.entries(summaries.get(p.id)?.targets ?? {}).sort((a, b) => b[1] - a[1]);
  let code: string | null = null;
  try {
    code = layoutCode(step.layout);
  } catch {
    code = null;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {same ? (
          <span className="text-body text-fg-body">Plots 1–{plots.length} run the same flow</span>
        ) : plots.length > 1 ? (
          <Segmented label="Plot" value={String(plotIdx)} onChange={(x) => setPlotIdx(Number(x))} options={plots.map((q, i) => ({ value: String(i), label: `Plot ${q.id}` }))} />
        ) : (
          <span className="text-body text-fg-body">Plot {p.id}</span>
        )}
        <span className="text-secondary tabular-nums text-fg-meta">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
        {p.flow.loop && steps.length > 1 && <Pill tone="restart">loops</Pill>}
        {p.script?.source.trim() && <Pill tone="script">script</Pill>}
      </div>
      <div className={cn("grid gap-x-6 gap-y-4", stacked ? "grid-cols-1" : "grid-cols-[minmax(0,26.5rem)_minmax(0,1fr)] items-start")}>
        <figure className="min-w-0 space-y-2">
          <LayoutThumb layout={step.layout} cellSize={cellSize} maxCell={maxCell} tooltips />
          <figcaption className="flex flex-wrap items-center gap-2">
            {simAt && (
              <ButtonLink size={stacked ? "touch" : "md"} to={simAt(p.id, idx)} title={`Load this flow in the simulator and open step ${idx + 1}'s layout`}>
                <FlaskConical aria-hidden /> Edit in simulator
              </ButtonLink>
            )}
            {code && (
              <ButtonLink variant="ghost" size={stacked ? "touch" : "md"} href={`/designer?layout=${encodeURIComponent(code)}`} newTab title="Open this layout in the Designer (new tab)">
                Open in Designer <ExternalLink aria-hidden />
              </ButtonLink>
            )}
          </figcaption>
        </figure>
        <ol className="min-w-0 space-y-1" aria-label={`Plot ${p.id} steps`}>
          {steps.map((s, i) => {
            const on = i === idx;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActive((cur) => ({ ...cur, [p.id]: i }))}
                  className={cn(
                    "focus-ring flex min-h-8 w-full cursor-pointer items-start gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-(--duration-hover) pointer-coarse:min-h-11",
                    on ? "bg-surface-hover" : "hover:bg-surface-hover/60",
                  )}
                >
                  <span className={cn("mt-px w-4 shrink-0 text-secondary font-semibold tabular-nums", on ? "text-select-fg" : "text-fg-meta")}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className={cn("block text-body", on ? "text-fg" : "text-fg-body")}>{s.label || `Step ${i + 1}`}</span>
                    {on && steps.length > 1 && <span className="block break-words text-secondary text-fg-muted">→ {exitText(s, steps)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {targets.length > 0 && (
            <li className="flex flex-wrap gap-1 px-2 pt-2">
              {targets.map(([id, n]) => (
                <MutationChip key={id} id={id} count={n} />
              ))}
            </li>
          )}
        </ol>
      </div>
    </div>
  );
};

/** Per-seed results of the chosen cell (F84). */
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
          <li key={s.seedIndex} className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 text-secondary">
            <span className="tabular-nums text-fg-meta">#{s.seedIndex + 1}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
              <span className="block h-full origin-left rounded-full bg-fg-meta/60" style={{ transform: `scaleX(${Math.max(0, profit / best)})` }} />
            </span>
            <span className="w-14 text-right font-semibold tabular-nums text-coin">{formatCoins(profit)}</span>
            <span className="w-16 text-right tabular-nums text-fg-muted">{percent(s.result.uptime)} up</span>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-1.5 text-secondary text-fg-muted">
        Best / median <b className={cn("font-semibold tabular-nums", ratio > OUTLIER_RATIO ? "text-problem" : "text-fg-body")}>{ratioText(ratio)}</b>
        <InfoHint title="Consistency">
          The ranking uses the median seed, so no single lucky seed counts. The server rejects a flow whose best seed earns over {OUTLIER_RATIO}× its median.
        </InfoHint>
      </p>
    </div>
  );
};

const JOB_TONE: Record<string, string> = { done: "text-go-fg", running: "text-fg", failed: "text-problem", queued: "text-fg-muted" };
const STATUS_TONE: Record<string, "go" | "problem" | "neutral" | "script"> = { live: "go", rejected: "problem", hidden: "neutral", pending: "script" };

/**
 * Owner: verification progress (F70); polls every 5 s while pending and calls `onLive` when the
 * flow goes live. One row with the status, then the job list while pending.
 */
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
    <section aria-label="Verification" className="space-y-2" data-testid="flow-status">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-secondary text-fg-muted">
        <span className="font-semibold text-fg">Verification</span>
        <Pill tone={STATUS_TONE[s] ?? "neutral"}>{s === "hidden" ? "hidden pending review" : s}</Pill>
        {pending && <LoaderCircle aria-hidden className="size-3.5 animate-spin text-fg-muted motion-reduce:animate-pulse" />}
        {pending && <span aria-live="polite">goes live after the Max-tier jobs · updates by itself</span>}
        {s === "live" && <span>verified on Ironman and Normal</span>}
        <InfoHint title="Verification" width={320}>
          The server simulates every login frequency with {SEEDS_MAX_TIER} secret seeds at the Max tier ({SEEDS_OTHER_TIERS} at the others), for Ironman (with and without the starting items) and Normal. This
          takes a few minutes and updates by itself.
        </InfoHint>
      </div>
      {status?.rejectReason && <p className="break-words text-secondary text-problem">{status.rejectReason}</p>}
      {error && <p className="text-secondary text-warn">Could not refresh the status: {error}</p>}
      {status?.jobs.length ? (
        <ul className="grid gap-x-6 gap-y-1.5 text-secondary md:grid-cols-2">
          {status.jobs.map((j, i) => {
            const frac = j.total ? Math.min(1, (j.done ?? 0) / j.total) : 0;
            const label = j.status === "queued" && j.queuePosition ? `queued · #${j.queuePosition} in line` : j.status === "running" && j.total ? `running · ${j.done ?? 0}/${j.total} runs` : j.status;
            const b = (j.runKind === "normal" || j.board === "normal" ? "normal" : j.runKind || j.board ? "ironman" : null) as Board | null;
            return (
              <li key={j.id ?? i} className="min-w-0 space-y-1">
                <div className="flex min-w-0 flex-wrap justify-between gap-x-2">
                  <span className="text-fg-body">
                    {b ? BOARD_LABEL[b] : String(j.board)} · {TIER_LABEL[j.tier as TierId] ?? j.tier} tier <span className="text-fg-meta">· {j.priority === "A" ? "goes live after this" : "background"}</span>
                  </span>
                  <span className={JOB_TONE[j.status] ?? "text-fg-muted"}>{label}</span>
                </div>
                {j.error && <p className="break-words text-meta text-problem">{j.error}</p>}
                {j.status === "running" && j.total ? (
                  <div className="h-1 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-label="Runs done" aria-valuenow={j.done ?? 0} aria-valuemin={0} aria-valuemax={j.total}>
                    <div className="h-full origin-left rounded-full bg-fg-muted transition-transform duration-500" style={{ transform: `scaleX(${frac})` }} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
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
      title="Report this flow"
      onClose={onClose}
      footer={
        <>
          <KitButton variant="ghost" size="md" onClick={onClose}>
            Cancel
          </KitButton>
          <KitButton variant="danger" size="md" onClick={send} loading={busy} disabled={!reason.trim()}>
            <Flag /> Send report
          </KitButton>
        </>
      }
    >
      <label className="block space-y-1.5">
        <span className="flex items-center justify-between gap-2 text-secondary text-fg-muted">
          What's wrong? (offensive text, a copied flow, a broken entry...)
          <span className="shrink-0 text-meta tabular-nums text-fg-meta">
            {reason.length} / {REPORT_MAX}
          </span>
        </span>
        <KitTextarea className="h-24 w-full" maxLength={REPORT_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && (
        <p className="text-secondary text-problem" role="alert">
          {error}
        </p>
      )}
    </DialogFrame>
  );
};

export const ReportDialog: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => (
  <ModalDialog labelledBy="report-flow-title" onClose={onClose} maxWidth="max-w-md">
    <ReportPanel id={id} onClose={onClose} />
  </ModalDialog>
);
