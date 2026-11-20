import React from "react";
import { ChevronDown } from "lucide-react";
import { COLLECTION_CROPS, RANK_BY_LABEL, type RankBy, type RankMetric } from "../../../leaderboard/metric";
import { CropImage } from "../../shared";
import { cn } from "../../ui/cn";
import { Dropdown, MenuItem } from "../../ui/Popover";
import { useSlidingIndicator } from "../../ui/useSlidingIndicator";
import { focusUnit, formatFocus } from "../focusMetricUi";
import { nameOf } from "../format";
import type { MetricTile } from "./pageHelpers";

/**
 * The focus metric: what the user optimises for. On desktop the KPI strip's metric tiles are the
 * picker (`MetricTiles`): every metric shows its number per day, the focused one is larger and sits on
 * a highlight that slides to the tile you click. The Collection tile carries its crop, changed from the
 * crop name on the tile. The phone header has room for one number, so it keeps a small menu
 * (`FocusPicker`).
 */

/** A metric's name with the crop's icon for a collection ("[wheat] Wheat/day"). */
export const FocusName: React.FC<{ metric: RankMetric; size?: number; className?: string }> = ({ metric, size = 14, className }) => (
  <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
    {metric.by === "collection" && <CropImage cropId={metric.crop} cropName={nameOf(metric.crop)} size="custom" width={size} height={size} showFallback className="shrink-0" />}
    <span className="truncate">{focusUnit(metric)}</span>
  </span>
);

/** The tile labels: every tile is a rate, said in the label (the strip's Total profit is a total). */
const TILE_LABEL: Record<RankBy, string> = { coins: "Coins/day", sowdust: "Sowdust/day", xp: "Farming XP/day", collection: "Collection/day" };

const signed = (metric: RankMetric, d: number) => `${d > 0 ? "+" : "−"}${formatFocus(metric, Math.abs(d))}`;

/** The crop list: icon + name, two columns, the current one checked. */
const CropMenu: React.FC<{ value: string; onPick: (crop: string) => void; close: () => void }> = ({ value, onPick, close }) => (
  <div className="grid grid-cols-2 gap-px" data-testid="crop-menu">
    {COLLECTION_CROPS.map((crop) => (
      <MenuItem key={crop} checked={crop === value} icon={<CropImage cropId={crop} cropName={nameOf(crop)} size="custom" width={16} height={16} showFallback />} onSelect={() => (onPick(crop), close())}>
        {nameOf(crop)}
      </MenuItem>
    ))}
  </div>
);

/**
 * The strip's metric tiles with the sliding focus highlight. Each tile is a radio: clicking it makes it
 * the focus (no menu). The Collection tile's crop name opens the crop list; picking a crop also focuses
 * the collection.
 */
export const MetricTiles: React.FC<{
  tiles: MetricTile[];
  focus: RankMetric;
  onFocus: (m: RankMetric) => void;
  /** Coin values are worded as Bazaar or NPC profit in their tooltip. */
  priced?: boolean;
}> = ({ tiles, focus, onFocus, priced }) => {
  // Measures the tile (its offsetLeft is relative to the group); the radio inside it sits at 0.
  const { box, bar, style } = useSlidingIndicator('[data-focus="true"]', 0, [focus.by, focus.crop, tiles.length]);
  return (
    <div ref={box} role="radiogroup" aria-label="Focus: what the big number and the frequency test measure" className="relative flex min-w-0 shrink items-stretch gap-0.5" data-testid="metric-tiles">
      {style && (
        <span
          ref={bar}
          aria-hidden
          // The highlight is the hover fill with a hairline: the same "you picked this" as Segmented's
          // thumb, at tile size. Forced colours drop backgrounds, so it gets the system highlight edge there.
          className="pointer-events-none absolute inset-y-0 left-0 rounded-control border border-line-strong bg-surface-hover forced-colors:border-[Highlight]"
          style={style}
        />
      )}
      {tiles.map((t) => (
        <Tile key={t.metric.by} tile={t} on={t.metric.by === focus.by} onFocus={onFocus} priced={priced} />
      ))}
    </div>
  );
};

const Tile: React.FC<{ tile: MetricTile; on: boolean; onFocus: (m: RankMetric) => void; priced?: boolean }> = ({ tile, on, onFocus, priced }) => {
  const { metric, value, delta } = tile;
  const coins = metric.by === "coins";
  const collection = metric.by === "collection";
  const showDelta = on && delta !== null && formatFocus(metric, Math.abs(delta)) !== "0";
  const title = coins
    ? `Profit per simulated day at ${priced ? "Bazaar" : "NPC"} prices (Total profit ÷ days simulated)`
    : collection
      ? `${nameOf(metric.crop)} harvested per simulated day`
      : `${RANK_BY_LABEL[metric.by]} earned per simulated day`;
  return (
    <div className={cn("relative z-10 flex min-w-0 flex-col justify-end rounded-control px-2.5 pt-1.5 pb-2", collection && "@max-[860px]:hidden")} data-testid={`kpi-${metric.by}`} data-focus={on}>
      {/* The whole tile is the radio; the crop control sits above its stretched area. */}
      <button
        type="button"
        role="radio"
        aria-checked={on}
        title={on ? title : `${title}. Click to focus on it`}
        onClick={() => onFocus(metric)}
        className={cn(
          "focus-ring absolute inset-0 cursor-pointer rounded-control transition-colors duration-(--duration-hover)",
          !on && "hover:bg-surface-hover/60"
        )}
      >
        <span className="sr-only">
          {collection ? `${nameOf(metric.crop)} collection` : RANK_BY_LABEL[metric.by]}: {formatFocus(metric, value)} per day
        </span>
      </button>
      <span className="pointer-events-none flex h-4 items-center gap-1 text-label uppercase text-fg-meta">
        {TILE_LABEL[metric.by]}
      </span>
      {/* A fixed-height line, baseline at the bottom: the larger focused number doesn't move its neighbours. */}
      <span className="pointer-events-none mt-1 flex h-[26px] items-baseline gap-1.5 whitespace-nowrap tabular-nums [&>*]:leading-[26px]">
        <span className={cn("font-semibold", on ? "text-hero text-fg" : "text-title text-fg-body", value < 0 && "text-problem")}>{formatFocus(metric, value)}</span>
        {collection && <CropControl crop={metric.crop} onFocus={onFocus} />}
        {showDelta && (
          <span className="text-meta font-medium text-fg-muted" title="Change since the last Step / Run">
            {signed(metric, delta!)}
            <span className="@max-[1100px]:hidden"> last run</span>
          </span>
        )}
      </span>
    </div>
  );
};

/** The Collection tile's crop: icon + name + chevron, opens the crop list (above the tile's radio). */
const CropControl: React.FC<{ crop: string; onFocus: (m: RankMetric) => void }> = ({ crop, onFocus }) => (
  <Dropdown
    label={`Collection crop: ${nameOf(crop)}. Change the crop`}
    title="Change the crop"
    look="plain"
    chevron={false}
    width={300}
    className="pointer-events-auto relative z-10 -my-0.5 inline-flex h-6 min-w-0 items-center gap-1 self-center rounded-inner px-1 text-secondary font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg"
    button={
      <>
        <CropImage cropId={crop} cropName={nameOf(crop)} size="custom" width={14} height={14} showFallback className="shrink-0" />
        <span className="max-w-[7rem] truncate">{nameOf(crop)}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0 text-fg-meta" />
      </>
    }
  >
    {(close) => <CropMenu value={crop} onPick={(c) => onFocus({ by: "collection", crop: c })} close={close} />}
  </Dropdown>
);

/**
 * The phone header's picker: the focused metric's unit as a small chip that opens a menu (Coins,
 * Sowdust, Farming XP, then the crops).
 */
export const FocusPicker: React.FC<{
  value: RankMetric;
  onChange: (m: RankMetric) => void;
  className?: string;
  align?: "start" | "end";
}> = ({ value, onChange, className, align }) => {
  const item = (by: Exclude<RankBy, "collection">, close: () => void) => (
    <MenuItem key={by} checked={value.by === by} onSelect={() => (onChange({ ...value, by }), close())}>
      {RANK_BY_LABEL[by]}
    </MenuItem>
  );
  return (
    <Dropdown
      label={`Focus: ${focusUnit(value)}. Change what the big number and the frequency test measure`}
      look="plain"
      align={align}
      width={300}
      className={cn(
        "hit-area inline-flex h-7 min-w-0 items-center gap-1 rounded-control border border-line-strong bg-surface-control px-2 text-secondary font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover aria-expanded:border-select/60",
        className
      )}
      button={<FocusName metric={value} size={13} />}
    >
      {(close) => (
        <div data-testid="focus-menu">
          {item("coins", close)}
          {item("sowdust", close)}
          {item("xp", close)}
          <div role="separator" className="mx-1 my-1 h-px bg-line" />
          <CropMenu value={value.by === "collection" ? value.crop : ""} onPick={(crop) => onChange({ by: "collection", crop })} close={close} />
        </div>
      )}
    </Dropdown>
  );
};
