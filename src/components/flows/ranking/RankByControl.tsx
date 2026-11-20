import React from "react";
import { COLLECTION_CROPS, RANK_BY_LABEL, RANK_BYS, type RankBy, type RankMetric } from "../../../leaderboard/metric";
import type { ItemId } from "../../../simulator/data/types";
import { CropImage } from "../../shared";
import { nameOf } from "../../simulator/format";
import { cn } from "../../ui/cn";
import { menuRowClass } from "../../ui/contextMenuContext";
import { Segmented } from "../../ui/kit";
import { Dropdown } from "../../ui/Popover";

/**
 * What the ranking measures (docs/plans/sowdust-xp-collection.md): Coins · Collection · Sowdust ·
 * Farming XP as a Segmented, and for Collection the crop it counts (a Dropdown of the 14 base crops
 * as a 2-column grid of image chips). The page keeps both in its URL (`by`, `crop`).
 */

const RANK_BY_TITLE: Record<RankBy, string> = {
  coins: "Coins per day at your stats and prices",
  collection: "Units of one base crop harvested per day (pick the crop)",
  sowdust: "Sowdust per day from the harvested base crops (scaled by your fortune)",
  xp: "Farming XP per day from every harvest (scaled by your Farming Wisdom)",
};

/** A crop image at a fixed size, with initials when the image is missing. */
const CropIcon: React.FC<{ id: ItemId; size?: number }> = ({ id, size = 16 }) => <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={size} height={size} showFallback />;

/** The crop picker: a field-look Dropdown showing the picked crop; the menu is a 2-column grid of the 14 crops. */
export const CropPicker: React.FC<{ crop: ItemId; onCrop: (crop: ItemId) => void; className?: string; touch?: boolean }> = ({ crop, onCrop, className, touch }) => (
  <Dropdown
    label="Collection crop"
    title="Which base crop's collection to rank by"
    width={320}
    className={cn("h-7 pl-2", touch && "pointer-coarse:h-11", className)}
    button={
      <span className="flex min-w-0 items-center gap-1.5" data-testid="crop-picker">
        <CropIcon id={crop} />
        <span className="truncate">{nameOf(crop)}</span>
      </span>
    }
  >
    {(close) => (
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
    )}
  </Dropdown>
);

/**
 * "Rank by [Coins | Collection | Sowdust | Farming XP] [Wheat ▾]". `phone` stretches the segments
 * over the row and puts the crop picker on its own line under them.
 */
export const RankByControl: React.FC<{ metric: RankMetric; onMetric: (m: RankMetric) => void; phone?: boolean; className?: string }> = ({ metric, onMetric, phone = false, className }) => {
  const segments = (
    <Segmented
      label="Rank by"
      value={metric.by}
      onChange={(by) => onMetric({ ...metric, by })}
      options={RANK_BYS.map((by) => ({ value: by, label: phone && by === "xp" ? "XP" : RANK_BY_LABEL[by], title: RANK_BY_TITLE[by] }))}
      className={cn(phone && "flex w-full [&>button]:flex-1 [&>button]:px-1.5")}
    />
  );
  const picker = metric.by === "collection" && <CropPicker crop={metric.crop} onCrop={(crop) => onMetric({ by: "collection", crop })} touch={phone} className={phone ? "w-full justify-between" : "max-w-[11rem]"} />;
  if (phone)
    return (
      <div className={cn("space-y-1.5", className)} data-testid="rank-by">
        {segments}
        {picker && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-secondary text-fg-meta">Collection of</span>
            {picker}
          </div>
        )}
      </div>
    );
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)} data-testid="rank-by">
      <span className="shrink-0 text-secondary whitespace-nowrap text-fg-meta">Rank by</span>
      {segments}
      {picker}
    </div>
  );
};
