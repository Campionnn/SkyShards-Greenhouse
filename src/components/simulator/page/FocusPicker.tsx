import React from "react";
import { COLLECTION_CROPS, RANK_BY_LABEL, sameMetric, type RankBy, type RankMetric } from "../../../leaderboard/metric";
import { CropImage } from "../../shared";
import { cn } from "../../ui/cn";
import { Dropdown, MenuItem, MenuLabel, MenuSeparator } from "../../ui/Popover";
import { focusUnit } from "../focusMetricUi";
import { nameOf } from "../format";

// The focus metric picker: opens from the KPI strip's hero label (and the phone header's unit).
// Coins · Collection (a crop grid) · Sowdust · Farming XP.

const HINT: Record<Exclude<RankBy, "collection">, string> = {
  coins: "Profit at NPC or Bazaar prices",
  sowdust: "From crop drops, scaled by fortune",
  xp: "With XP effects and Farming Wisdom",
};

/** A metric's name with the crop's icon for a collection ("[wheat] Wheat/day"). */
export const FocusName: React.FC<{ metric: RankMetric; size?: number; className?: string }> = ({ metric, size = 14, className }) => (
  <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
    {metric.by === "collection" && <CropImage cropId={metric.crop} cropName={nameOf(metric.crop)} size="custom" width={size} height={size} showFallback className="shrink-0" />}
    <span className="truncate">{focusUnit(metric)}</span>
  </span>
);

export const FocusPicker: React.FC<{
  value: RankMetric;
  onChange: (m: RankMetric) => void;
  /** The trigger's content (the hero label, the phone unit). */
  button: React.ReactNode;
  className?: string;
  align?: "start" | "end";
}> = ({ value, onChange, button, className, align }) => {
  const item = (by: Exclude<RankBy, "collection">, close: () => void) => (
    <MenuItem key={by} checked={value.by === by} hint={HINT[by]} onSelect={() => (onChange({ ...value, by }), close())}>
      {RANK_BY_LABEL[by]}
    </MenuItem>
  );
  return (
    <Dropdown
      label={`Focus: ${focusUnit(value)}. Change what the headline and the frequency test measure`}
      title="What you're optimising for: the headline number and the Monte Carlo test measure it"
      look="plain"
      align={align}
      width={272}
      className={cn("hit-area inline-flex min-w-0 items-center gap-1 rounded-inner transition-colors duration-(--duration-hover) hover:text-fg-body aria-expanded:text-fg-body", className)}
      button={button}
    >
      {(close) => (
        <div data-testid="focus-menu">
          <MenuLabel>Focus on</MenuLabel>
          {item("coins", close)}
          <MenuSeparator />
          <MenuLabel>Collection</MenuLabel>
          <div className="grid grid-cols-7 gap-0.5 px-1 pb-1">
            {COLLECTION_CROPS.map((crop) => {
              const m: RankMetric = { by: "collection", crop };
              const on = sameMetric(value, m);
              return (
                <button
                  key={crop}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  aria-label={`${nameOf(crop)} collection`}
                  title={nameOf(crop)}
                  onClick={() => (onChange(m), close())}
                  className={cn(
                    "focus-ring-inset grid size-8 cursor-pointer place-items-center rounded-control border transition-colors duration-(--duration-hover)",
                    on ? "border-select/60 bg-select/10" : "border-transparent hover:bg-surface-hover focus-visible:bg-surface-hover"
                  )}
                >
                  <CropImage cropId={crop} cropName={nameOf(crop)} size="custom" width={20} height={20} showFallback />
                </button>
              );
            })}
          </div>
          <MenuSeparator />
          {item("sowdust", close)}
          {item("xp", close)}
        </div>
      )}
    </Dropdown>
  );
};
