import React, { useMemo } from "react";
import { resolveLayout } from "../../simulator/flow/layout";
import type { StepLayout } from "../../simulator/flow/types";
import { defaultGameData } from "../../simulator";
import type { RevenueSplit, FrequencyPoint } from "../../leaderboard/view";
import { getRarityTextColor } from "../../utilities/rarity";
import { FarmPicture } from "../guide/FarmPicture";
import { CropImage } from "../shared";
import { formatCoins, nameOf, rarityOf } from "../simulator/format";
import { effortLevel, SPLIT_STYLE } from "./flowsDisplay";

/**
 * Small visual pieces for the leaderboard: the revenue split bar, the frequency sparkline, layout
 * thumbnails (drawn like the Guide's farm pictures), mutation chips and the effort meter.
 */

const DATA = defaultGameData();

// ---- Revenue split ---------------------------------------------------------------------------

/** A bar whose length is this row's share of the top profit, split by where the money comes from. */
export const SplitBar: React.FC<{ split: RevenueSplit | null; fraction: number; className?: string }> = ({ split, fraction, className = "" }) => {
  const total = split ? split.crops + split.mutations + split.rare : 0;
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-700/40 ${className}`} aria-hidden>
      <div className="flex h-full transition-[width] duration-300 ease-out" style={{ width }}>
        {total > 0 &&
          (["crops", "mutations", "rare"] as const).map((k) =>
            split![k] > 0 ? <div key={k} className={SPLIT_STYLE[k].bar} style={{ width: `${(split![k] / total) * 100}%` }} /> : null
          )}
      </div>
    </div>
  );
};

/** "crops 44.8M/day · mutation 54.9M/day · rare 4.7M/day" */
export const SplitLegend: React.FC<{ split: RevenueSplit | null; className?: string }> = ({ split, className = "" }) => {
  if (!split) return null;
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums ${className}`}>
      {(["crops", "mutations", "rare"] as const).map((k) =>
        split[k] > 0 ? (
          <span key={k} className="whitespace-nowrap">
            <span className={SPLIT_STYLE[k].text}>{SPLIT_STYLE[k].label}</span> <span className="text-slate-400">{formatCoins(split[k])}/day</span>
          </span>
        ) : null
      )}
    </div>
  );
};

// ---- Frequency sparkline ---------------------------------------------------------------------

/**
 * Profit per day across the online frequencies, as tiny bars (1, 2, 3, 4, 6, 8, 12 cycles). The
 * viewer's frequency is the bright one, so it reads as "how much do I lose by logging in less".
 */
export const Sparkline: React.FC<{ points: FrequencyPoint[]; selected: number; className?: string }> = ({ points, selected, className = "" }) => {
  const max = Math.max(1, ...points.map((p) => p.profitPerDay ?? 0));
  if (!points.some((p) => p.profitPerDay !== null)) return null;
  return (
    <div className={`flex h-7 items-end gap-[3px] ${className}`} role="img" aria-label="Profit by online frequency">
      {points.map((p) => {
        const v = Math.max(0, p.profitPerDay ?? 0);
        const h = p.profitPerDay === null ? 0 : Math.max(8, (v / max) * 100);
        const active = p.every === selected;
        return (
          <div key={p.every} className="flex h-full w-2 items-end" title={`Every ${p.every}: ${p.profitPerDay === null ? "not verified" : `${formatCoins(v)}/day`}`}>
            <div
              className={`w-full rounded-sm ${p.profitPerDay === null ? "bg-slate-700/40" : active ? "bg-emerald-400" : "bg-emerald-400/30"}`}
              style={{ height: p.profitPerDay === null ? "15%" : `${h}%` }}
            />
          </div>
        );
      })}
    </div>
  );
};

// ---- Layout thumbnails ---------------------------------------------------------------------

/** A layout drawn like the Guide's farm pictures (real crop and ground images), no tooltips. */
export const LayoutThumb: React.FC<{ layout: StepLayout | null; cellSize?: number; className?: string; tooltips?: boolean; compass?: boolean; maxCell?: number }> = ({
  layout,
  cellSize,
  className = "",
  tooltips = false,
  compass = false,
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
    return <div className={`grid place-items-center rounded-md border border-slate-700/60 bg-slate-900/60 text-[10px] text-slate-600 ${className}`} style={{ width: px, height: px }}>no picture</div>;
  }
  return (
    <div className={`rounded-md bg-slate-950/70 p-1 ring-1 ring-slate-700/50 ${className}`}>
      <FarmPicture layout={resolved} nameOf={nameOf} data={DATA} cellSize={cellSize} maxCell={maxCell} compass={compass} tooltips={tooltips} />
    </div>
  );
};

// ---- Mutation chips --------------------------------------------------------------------------

export const MutationChip: React.FC<{ id: string; count?: number; size?: "sm" | "md" }> = ({ id, count, size = "sm" }) => {
  const rarity = rarityOf(id);
  const px = size === "md" ? 20 : 16;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border border-slate-600/40 bg-slate-900/60 ${size === "md" ? "px-1.5 py-0.5 text-xs" : "px-1 py-0.5 text-[11px]"}`}>
      <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={px} height={px} showFallback />
      <span className={`whitespace-nowrap ${rarity ? getRarityTextColor(rarity) : "text-slate-300"}`}>{nameOf(id)}</span>
      {count !== undefined && count > 1 && <span className="text-slate-500 tabular-nums">×{count}</span>}
    </span>
  );
};

// ---- Effort meter --------------------------------------------------------------------------

export const EffortMeter: React.FC<{ avg: number | null; peak: number | null; compact?: boolean }> = ({ avg, peak, compact = false }) => {
  const lvl = effortLevel(avg);
  const color = ["", "bg-emerald-400", "bg-emerald-400", "bg-amber-300", "bg-orange-400", "bg-red-400"][lvl.bars];
  return (
    <span className="inline-flex items-center gap-1.5" title={avg === null ? "Effort unknown" : `Effort per login: ${Math.round(avg)} on average, ${Math.round(peak ?? 0)} at the heaviest`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`w-1 rounded-sm ${i <= lvl.bars ? color : "bg-slate-700/60"}`} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      {!compact && <span className={`text-[11px] ${lvl.tone}`}>{lvl.label}</span>}
    </span>
  );
};
