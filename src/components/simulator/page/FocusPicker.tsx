import React from "react";
import { Crosshair } from "lucide-react";
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

/**
 * The picker's trigger: a pill (target icon, the metric, a chevron) that reads as a control, like the
 * command bar's chips. `compact` is the phone header's smaller one.
 */
export const FocusTrigger: React.FC<{ metric: RankMetric; compact?: boolean }> = ({ metric, compact }) => (
  <>
    <Crosshair aria-hidden className={cn("shrink-0 text-go-fg", compact ? "size-3" : "size-3.5")} />
    <FocusName metric={metric} size={compact ? 13 : 14} />
  </>
);

/** The trigger's look: a field-like pill (border, well) that brightens on hover and while open. */
const TRIGGER =
  "inline-flex min-w-0 items-center gap-1.5 rounded-control border border-line-control bg-surface-well font-medium normal-case text-fg-body transition-colors duration-(--duration-hover) hover:border-fg-meta hover:bg-surface-panel hover:text-fg aria-expanded:border-select/60 aria-expanded:text-fg";

export const FocusPicker: React.FC<{
  value: RankMetric;
  onChange: (m: RankMetric) => void;
  /** The trigger's content; default the pill (`FocusTrigger`). */
  button?: React.ReactNode;
  /** The phone header's smaller pill. */
  compact?: boolean;
  className?: string;
  align?: "start" | "end";
}> = ({ value, onChange, button, compact, className, align }) => {
  const item = (by: Exclude<RankBy, "collection">, close: () => void) => (
    <MenuItem key={by} checked={value.by === by} hint={HINT[by]} onSelect={() => (onChange({ ...value, by }), close())}>
      {RANK_BY_LABEL[by]}
    </MenuItem>
  );
  return (
    <Dropdown
      label={`Focus: ${focusUnit(value)}. Change what the headline and the frequency test measure`}
      title="Click to choose what you're optimising for: coins, a crop's collection, Sowdust or Farming XP. The big number and the frequency test measure it."
      look="plain"
      align={align}
      width={272}
      className={cn(TRIGGER, compact ? "hit-area h-6 px-1.5 text-meta" : "h-6 px-2 text-secondary", className)}
      button={button ?? <FocusTrigger metric={value} compact={compact} />}
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
