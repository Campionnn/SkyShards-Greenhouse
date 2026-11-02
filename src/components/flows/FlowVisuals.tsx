import React, { useMemo, useState } from "react";
import { resolveLayout } from "../../simulator/flow/layout";
import type { StepLayout } from "../../simulator/flow/types";
import { defaultGameData, EFFORT_WEIGHTS } from "../../simulator";
import type { EffortKind } from "../../simulator/sim/state";
import type { EffortResult } from "../../leaderboard/result";
import type { RevenueSplit, FrequencyPoint } from "../../leaderboard/view";
import { getRarityTextColor } from "../../utilities/rarity";
import { getCropPreviewColor } from "../../data/cropColors";
import { FarmPicture } from "../guide/FarmPicture";
import { CropImage } from "../shared";
import { formatCoins, formatRate, nameOf, rarityOf } from "../simulator/format";
import { cn } from "../ui/cn";
import { EFFORT_LABEL, effortLevel, SPLIT_STYLE } from "./flowsDisplay";

/**
 * Small visual pieces for the leaderboard: the revenue split bar, the frequency sparkline, layout
 * thumbnails (drawn like the Guide's farm pictures), mutation chips and the effort meter. Also used
 * by the simulator (StepNode: LayoutBoxes, MutationChip). On the design system: neutral data marks,
 * `select` for "yours", `coin` for money.
 */

const DATA = defaultGameData();

// ---- Revenue split ---------------------------------------------------------------------------

/** A bar whose length is this row's share of the top profit, split by where the money comes from. */
export const SplitBar: React.FC<{ split: RevenueSplit | null; fraction: number; className?: string }> = ({ split, fraction, className = "" }) => {
  const total = split ? split.crops + split.mutations + split.rare : 0;
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-line", className)} aria-hidden>
      <div className="flex h-full gap-px" style={{ width }}>
        {total > 0 &&
          (["crops", "mutations", "rare"] as const).map((k) =>
            split![k] > 0 ? <div key={k} className={SPLIT_STYLE[k].bar} style={{ width: `${(split![k] / total) * 100}%` }} /> : null
          )}
      </div>
    </div>
  );
};

/** "▬ crops 44.8M/day · ▬ mutations 54.9M/day · ▬ rare 4.7M/day": names the bar's three shades. */
export const SplitLegend: React.FC<{ split: RevenueSplit | null; className?: string }> = ({ split, className = "" }) => {
  if (!split) return null;
  return (
    <div className={cn("flex flex-wrap gap-x-3 gap-y-0.5 text-meta tabular-nums", className)}>
      {(["crops", "mutations", "rare"] as const).map((k) =>
        split[k] > 0 ? (
          <span key={k} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden className={cn("h-1.5 w-2.5 rounded-full", SPLIT_STYLE[k].bar)} />
            <span className={SPLIT_STYLE[k].text}>{SPLIT_STYLE[k].label}</span> <span className="text-fg-body">{formatCoins(split[k])}/day</span>
          </span>
        ) : null
      )}
    </div>
  );
};

// ---- Frequency sparkline ---------------------------------------------------------------------

const fmtHours = (h: number) => (h < 1 ? `${Math.round(h * 60)}m` : h < 10 ? `${h.toFixed(1).replace(/\.0$/, "")}h` : `${Math.round(h)}h`);

/**
 * Profit per day across the online frequencies, as tiny bars (1, 2, 3, 4, 6, 8, 12 cycles). Neutral
 * bars; the viewer's frequency is the `select` one, so it reads as "how much do I lose by logging in
 * less". Hovering (or tapping) a bar shows its numbers in a small tooltip; the values are also in the
 * label for screen readers. Sits above a stretched row link, so it lifts itself (`relative z-10`).
 */
export const Sparkline: React.FC<{ points: FrequencyPoint[]; selected: number; className?: string; hoursPerCycle?: number }> = ({ points, selected, className = "", hoursPerCycle }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.profitPerDay ?? 0));
  if (!points.some((p) => p.profitPerDay !== null)) return null;
  const label = `Profit by login frequency: ${points.map((p) => `every ${p.every} ${p.profitPerDay === null ? "not verified" : formatCoins(Math.max(0, p.profitPerDay))}`).join(", ")}`;
  const mine = points.find((p) => p.every === selected)?.profitPerDay ?? null;
  const focus = hover === null ? null : (points.find((p) => p.every === hover) ?? null);
  const delta = focus && focus.profitPerDay !== null && mine && mine > 0 && focus.every !== selected ? (focus.profitPerDay - mine) / mine : null;
  return (
    <div className={cn("relative z-10 flex h-7 items-end", className)} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
      {points.map((p) => {
        const v = Math.max(0, p.profitPerDay ?? 0);
        const h = p.profitPerDay === null ? 0 : Math.max(8, (v / max) * 100);
        const active = p.every === selected;
        const hovered = p.every === hover;
        return (
          <div key={p.every} className="flex h-full w-2.5 cursor-default items-end justify-center" onPointerEnter={() => setHover(p.every)} data-every={p.every}>
            <div
              className={cn("w-1.5 rounded-full transition-colors duration-(--duration-hover)", p.profitPerDay === null ? "bg-line" : active ? "bg-select" : hovered ? "bg-fg-muted" : "bg-line-control")}
              style={{ height: p.profitPerDay === null ? "15%" : `${h}%` }}
            />
          </div>
        );
      })}
      {focus && (
        <div
          role="presentation"
          className="pointer-events-none absolute bottom-full left-1/2 z-(--z-tooltip) mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-control border border-line-strong bg-surface-raised px-2 py-1 text-meta shadow-raised"
          data-testid="sparkline-tip"
        >
          <span className="block text-fg-body">
            Every {focus.every}
            {hoursPerCycle ? ` · ≈${fmtHours(focus.every * hoursPerCycle)}` : ""}
            {focus.every === selected && <span className="text-select-fg"> · yours</span>}
          </span>
          <span className="block tabular-nums">
            {focus.profitPerDay === null ? (
              <span className="text-fg-meta">not verified</span>
            ) : (
              <>
                <span className="font-semibold text-coin">{formatCoins(focus.profitPerDay)}</span>
                <span className="text-fg-meta">/day</span>
                {delta !== null && <span className={delta >= 0 ? "text-go-fg" : "text-problem"}> {`${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%`}</span>}
              </>
            )}
          </span>
        </div>
      )}
    </div>
  );
};

// ---- Layout thumbnails ---------------------------------------------------------------------

/** A layout drawn like the Guide's farm pictures (real crop and ground images), no tooltips. */
export const LayoutThumb: React.FC<{ layout: StepLayout | null; cellSize?: number; className?: string; tooltips?: boolean; maxCell?: number }> = ({
  layout,
  cellSize,
  className = "",
  tooltips = false,
  maxCell,
}) => {
  const resolved = useMemo(() => {
    if (!layout) return null;
    try {
      return resolveLayout(layout, DATA).resolved;
    } catch {
      return null;
    }
  }, [layout]);
  if (!resolved) {
    const px = (cellSize ?? 8) * 10 + 9;
    return (
      <div className={cn("grid place-items-center rounded-inner border border-line bg-surface-well text-meta text-fg-meta", className)} style={{ width: px, height: px }}>
        no picture
      </div>
    );
  }
  return (
    <div className={cn("rounded-inner bg-surface-well p-1 ring-1 ring-line", className)}>
      <FarmPicture layout={resolved} nameOf={nameOf} data={DATA} cellSize={cellSize} maxCell={maxCell} tooltips={tooltips} />
    </div>
  );
};

/**
 * A tiny layout as coloured boxes (the Designer's preview colours): readable at sizes where crop
 * images are not. Inputs are solid, targets are outlined in their mutation's colour.
 */
export const LayoutBoxes: React.FC<{ layout: StepLayout | null; cell?: number; className?: string }> = ({ layout, cell = 7, className = "" }) => {
  const cells = useMemo(() => {
    if (!layout) return null;
    try {
      const r = resolveLayout(layout, DATA).resolved;
      const map = new Map<number, { id: string; target: boolean }>();
      for (const p of r.plants) for (let dr = 0; dr < p.size; dr++) for (let dc = 0; dc < p.size; dc++) map.set((p.row + dr) * 10 + p.col + dc, { id: p.kindId, target: false });
      for (const s of r.slots) for (let dr = 0; dr < s.size; dr++) for (let dc = 0; dc < s.size; dc++) if (!map.has((s.row + dr) * 10 + s.col + dc)) map.set((s.row + dr) * 10 + s.col + dc, { id: s.mutationId, target: true });
      return map;
    } catch {
      return null;
    }
  }, [layout]);
  const gap = 1;
  const px = cell * 10 + gap * 9;
  return (
    <div className={cn("rounded-inner bg-surface-well p-1 ring-1 ring-line", className)} style={{ width: px + 8, height: px + 8 }} aria-hidden>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(10, ${cell}px)`, gap }}>
        {Array.from({ length: 100 }, (_, i) => {
          const c = cells?.get(i);
          if (!c) return <div key={i} className="bg-line" style={{ width: cell, height: cell, borderRadius: 1.5 }} />;
          const color = getCropPreviewColor(c.id, c.target);
          return (
            <div
              key={i}
              style={{
                width: cell,
                height: cell,
                borderRadius: 1.5,
                background: c.target ? `${color}33` : color,
                boxShadow: c.target ? `inset 0 0 0 1px ${color}` : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

// ---- Mutation chips --------------------------------------------------------------------------

export const MutationChip: React.FC<{ id: string; count?: number; size?: "sm" | "md"; earning?: number | null; className?: string }> = ({ id, count, size = "sm", earning, className }) => {
  const rarity = rarityOf(id);
  const px = size === "md" ? 20 : 16;
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 rounded-inner border border-line bg-surface-well", size === "md" ? "px-1.5 py-0.5 text-secondary" : "px-1 py-px text-meta", className)}
      title={earning != null ? `${nameOf(id)}: ${formatCoins(earning)} / day from its harvests` : undefined}
    >
      <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={px} height={px} showFallback />
      <span className={cn("truncate whitespace-nowrap", rarity ? getRarityTextColor(rarity) : "text-fg-body")}>{nameOf(id)}</span>
      {count !== undefined && count > 1 && <span className="tabular-nums text-fg-meta">×{count}</span>}
      {earning != null && earning > 0 && <span className="tabular-nums text-fg-muted">{formatCoins(earning)}</span>}
    </span>
  );
};

// ---- Effort meter --------------------------------------------------------------------------

/** Effort per login: 5 neutral bars and the level's word. A cost to weigh, never a warning colour. */
export const EffortMeter: React.FC<{ avg: number | null; peak: number | null; compact?: boolean }> = ({ avg, peak, compact = false }) => {
  const lvl = effortLevel(avg);
  return (
    <span className="inline-flex items-center gap-1.5" title={avg === null ? "Effort unknown" : `Effort per login: ${Math.round(avg)} on average, ${Math.round(peak ?? 0)} at the heaviest`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={cn("w-1 rounded-full", i <= lvl.bars ? "bg-fg-muted" : "bg-line")} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      {compact ? <span className="sr-only">Effort: {lvl.label}</span> : <span className={cn("text-meta", lvl.tone)}>{lvl.label}</span>}
    </span>
  );
};

/**
 * Effort per login, broken down by action: how many of each per login, with a bar for its share of
 * the work (count × the engine's `EFFORT_WEIGHTS`). Used by the leaderboard detail page.
 */
export const EffortBreakdown: React.FC<{ effort: EffortResult }> = ({ effort }) => {
  const rows = Object.entries(effort.byKind)
    .map(([k, n]) => ({ k, n: n ?? 0, w: (n ?? 0) * (EFFORT_WEIGHTS[k as EffortKind] ?? 1) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.w - a.w);
  const total = rows.reduce((s, r) => s + r.w, 0);
  if (!rows.length) return <p className="text-secondary text-fg-meta">No actions recorded.</p>;
  return (
    <ul className="space-y-1.5" aria-label="Effort by action">
      {rows.map((r) => {
        const share = total > 0 ? r.w / total : 0;
        return (
          <li
            key={r.k}
            className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-secondary"
            title={`${EFFORT_LABEL[r.k] ?? r.k}: ${EFFORT_WEIGHTS[r.k as EffortKind] ?? 1} effort each, ${Math.round(share * 100)}% of the work`}
          >
            <span className="truncate text-fg-body">{EFFORT_LABEL[r.k] ?? r.k}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-fg-meta" style={{ width: `${share * 100}%` }} />
            </span>
            <span className="w-24 text-right tabular-nums text-fg-muted">{formatRate(r.n)} / login</span>
          </li>
        );
      })}
    </ul>
  );
};
