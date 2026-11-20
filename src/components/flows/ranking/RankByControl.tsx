import React from "react";
import { ChevronDown } from "lucide-react";
import { COLLECTION_CROPS, RANK_BY_LABEL, type RankBy, type RankMetric } from "../../../leaderboard/metric";
import type { ItemId } from "../../../simulator/data/types";
import { CropImage } from "../../shared";
import { nameOf } from "../../simulator/format";
import { cn } from "../../ui/cn";
import { menuRowClass } from "../../ui/contextMenuContext";
import { Dropdown } from "../../ui/Popover";
import { surface } from "../../ui/surface";
import { useSlidingIndicator } from "../../ui/useSlidingIndicator";

/**
 * What the ranking measures (docs/plans/sowdust-xp-collection.md), in the simulator's picker language:
 * one track, Coins · Sowdust · Farming XP · Collection [crop ▾], a highlight that slides to the
 * segment you click. The Collection segment always carries its crop chip (so the control never
 * changes width when you switch); the chip opens the 14 crops. The page keeps both in its URL
 * (`by`, `crop`).
 */

const ORDER: readonly RankBy[] = ["coins", "sowdust", "xp", "collection"];

const RANK_BY_TITLE: Record<RankBy, string> = {
  coins: "Rank by coins per day at your stats and prices",
  collection: "Rank by units of one base crop harvested per day (pick the crop)",
  sowdust: "Rank by Sowdust per day (scaled by your fortune)",
  xp: "Rank by Farming XP per day (scaled by your Farming Wisdom)",
};

/** A crop image at a fixed size, with initials when the image is missing. */
const CropIcon: React.FC<{ id: ItemId; size?: number }> = ({ id, size = 16 }) => <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={size} height={size} showFallback />;

/** The 14 crops as a 2-column menu, the current one checked. */
const CropMenu: React.FC<{ crop: ItemId; onCrop: (crop: ItemId) => void; close: () => void }> = ({ crop, onCrop, close }) => (
  <div className="grid grid-cols-2 gap-0.5" data-testid="crop-picker-menu">
    {COLLECTION_CROPS.map((id) => {
      const on = id === crop;
      return (
        <button
          key={id}
          type="button"
          role="menuitemradio"
          aria-checked={on}
          onClick={() => {
            onCrop(id);
            close();
          }}
          className={cn(menuRowClass(), "gap-2 pointer-coarse:min-h-11", on && "bg-surface-hover text-fg")}
        >
          <CropIcon id={id} size={20} />
          <span className="min-w-0 truncate">{nameOf(id)}</span>
        </button>
      );
    })}
  </div>
);

/** The crop chip inside the Collection segment: icon, name, chevron; opens the crop menu. */
export const CropPicker: React.FC<{ crop: ItemId; onCrop: (crop: ItemId) => void; className?: string; touch?: boolean; active?: boolean }> = ({ crop, onCrop, className, touch, active }) => (
  <Dropdown
    label={`Collection crop: ${nameOf(crop)}. Change the crop`}
    title="Which base crop's collection to rank by"
    look="plain"
    chevron={false}
    width={320}
    className={cn(
      "relative z-10 inline-flex h-6 min-w-0 items-center gap-1 rounded-inner px-1.5 text-secondary font-medium transition-colors duration-(--duration-hover) hover:bg-surface-control hover:text-fg",
      active ? "text-fg" : "text-fg-meta",
      touch && "pointer-coarse:h-9",
      className
    )}
    button={
      <span className="flex min-w-0 items-center gap-1" data-testid="crop-picker">
        <CropIcon id={crop} size={14} />
        <span className="max-w-[7.5rem] truncate">{nameOf(crop)}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0 text-fg-meta" />
      </span>
    }
  >
    {(close) => <CropMenu crop={crop} onCrop={onCrop} close={close} />}
  </Dropdown>
);

/**
 * "Rank by [Coins | Sowdust | Farming XP | Collection 🌾 Wheat ▾]". `phone` stretches the segments
 * over the row (Farming XP → XP).
 */
export const RankByControl: React.FC<{ metric: RankMetric; onMetric: (m: RankMetric) => void; phone?: boolean; className?: string }> = ({ phone = false, ...props }) =>
  // Phones: two rows in one track (Coins · Sowdust · XP, then Collection [crop ▾] across). The
  // indicator slides along one axis, so there the picked radio gets the thumb fill instead.
  phone ? <PhoneRankBy {...props} /> : <DesktopRankBy {...props} />;

const DesktopRankBy: React.FC<{ metric: RankMetric; onMetric: (m: RankMetric) => void; className?: string }> = ({ metric, onMetric, className }) => {
  const { box, bar, style } = useSlidingIndicator('[data-on="true"]', 0, [metric.by, metric.crop]);
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)} data-testid="rank-by">
      <span className="shrink-0 text-secondary whitespace-nowrap text-fg-meta">Rank by</span>
      <div ref={box} role="radiogroup" aria-label="Rank by" className={cn("relative inline-flex min-w-0 p-0.5", surface.well)}>
        {style && (
          <span
            ref={bar}
            aria-hidden
            // Segmented's thumb: the hover fill, one step lighter than the well; the system highlight in forced colours.
            className="pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-inner bg-surface-hover forced-colors:bg-[Highlight]"
            style={style}
          />
        )}
        {ORDER.map((by) => {
          const on = metric.by === by;
          return (
            <div key={by} data-on={on} className="relative flex min-w-0 items-center">
              <Segment by={by} on={on} onPick={() => onMetric({ ...metric, by })} className={by === "collection" ? "pr-1" : undefined} />
              {by === "collection" && (
                // Picking a crop focuses the collection too.
                <CropPicker crop={metric.crop} active={on} onCrop={(crop) => onMetric({ by: "collection", crop })} className="mr-0.5" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** One rank-by radio: the label button. */
const Segment: React.FC<{ by: RankBy; on: boolean; onPick: () => void; label?: string; className?: string }> = ({ by, on, onPick, label, className }) => (
  <button
    type="button"
    role="radio"
    aria-checked={on}
    title={RANK_BY_TITLE[by]}
    onClick={onPick}
    className={cn(
      "hit-area focus-ring z-10 h-7 cursor-pointer whitespace-nowrap rounded-inner px-2.5 text-secondary font-semibold transition-colors duration-(--duration-hover) pointer-coarse:h-9",
      on ? "text-fg forced-colors:text-[HighlightText]" : "text-fg-meta hover:text-fg-body",
      className
    )}
  >
    {label ?? RANK_BY_LABEL[by]}
  </button>
);

/** The phone layout: the same radios in one well, two rows; the picked one gets the thumb fill. */
const PhoneRankBy: React.FC<{ metric: RankMetric; onMetric: (m: RankMetric) => void; className?: string }> = ({ metric, onMetric, className }) => {
  const fill = (on: boolean) => (on ? "bg-surface-hover forced-colors:bg-[Highlight]" : undefined);
  const collecting = metric.by === "collection";
  return (
    <div role="radiogroup" aria-label="Rank by" className={cn("grid w-full grid-cols-3 gap-0.5 p-0.5", surface.well, className)} data-testid="rank-by">
      {(["coins", "sowdust", "xp"] as const).map((by) => (
        <Segment key={by} by={by} on={metric.by === by} onPick={() => onMetric({ ...metric, by })} label={by === "xp" ? "XP" : undefined} className={cn("w-full", fill(metric.by === by))} />
      ))}
      <div className={cn("col-span-3 flex min-w-0 items-center rounded-inner", fill(collecting))}>
        <Segment by="collection" on={collecting} onPick={() => onMetric({ ...metric, by: "collection" })} className="pr-1" />
        <CropPicker crop={metric.crop} active={collecting} touch onCrop={(crop) => onMetric({ by: "collection", crop })} className="mr-0.5 ml-auto" />
      </div>
    </div>
  );
};
