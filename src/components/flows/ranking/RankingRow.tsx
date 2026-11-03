import React from "react";
import { Link } from "react-router-dom";
import { ChevronDown, FlaskConical, RefreshCcw } from "lucide-react";
import type { Board } from "../../../leaderboard/rules";
import { BADGE_TITLE, kitListText, percent, starvedText, upkeepText, type FlowRow, type SortKey } from "../../../leaderboard/view";
import { formatCoins, nameOf } from "../../simulator/format";
import { cn } from "../../ui/cn";
import { ButtonLink, IconButton } from "../../ui/kit";
import { SlowingBadge, StallChip, StartingItemsLine } from "../FlowChips";
import { Avatar, Badge, LikeButton } from "../FlowControls";
import { EffortMeter, LayoutBoxes, LayoutThumb, MutationChip, Sparkline, SplitBar, SplitLegend } from "../FlowVisuals";
import { FrequencyChart } from "../FrequencyChart";
import { SPLIT_STYLE } from "../flowsDisplay";
import { InfoHint } from "../../ui/InfoHint";
import { excerptOf, flowHref, FORGIVING_HINT, forgivingText, peekLayouts, plotsLabel, shapeText, simHref, startShort, supplyText, thumbOf, upkeepShort, ROW_COLS, type RankingLinkState } from "./rankingHelpers";

/**
 * One ranked flow (F27–F42). The title is the row's real link, stretched over the whole row with
 * ::after (middle-click, keyboard and text selection work; no row onClick). The like, open-in-
 * simulator and peek controls sit above the stretch. The peek holds everything the one-line row
 * leaves out, as visible text.
 */

export interface RowLike {
  liked: boolean;
  busy: boolean;
  /** Omitted on the viewer's own flows (count only). */
  onToggle?: () => void;
  /** Logged out: a click asks to log in first. */
  needsLogin?: boolean;
}

export interface RowProps {
  row: FlowRow;
  /** The largest profit on the board (the split bar's scale). */
  top: number;
  /** The viewer's grid frequency (the sparkline's bright bar). */
  every: number;
  board: Board;
  kit?: boolean;
  index: number;
  like: RowLike;
  sort: SortKey;
  /** The peek is open. */
  open?: boolean;
  onPeek?: () => void;
  /** The ranking's query, handed to the detail page so its back link restores it. */
  rankingSearch?: string;
  /** Hours per cycle at the viewer's speed (the sparkline tooltip and the peek's chart). */
  hoursPerCycle?: number;
  /** Set the viewer's frequency (the peek's chart is clickable when given). */
  onEvery?: (every: number) => void;
}

const splitTitle = (row: FlowRow) =>
  row.split
    ? (["crops", "mutations", "rare"] as const)
        .filter((k) => row.split![k] > 0)
        .map((k) => `${SPLIT_STYLE[k].label} ${formatCoins(row.split![k])}/day`)
        .join(" · ")
    : undefined;


/**
 * "Needs 256 Turtlellini +2 more/day" in the warn colour: upkeep is never hidden behind the peek.
 * `bare` drops "Needs" where the column head already says "Upkeep".
 */
const UpkeepLine: React.FC<{ row: FlowRow; board: Board; className?: string; bare?: boolean }> = ({ row, board, className, bare = false }) => {
  const u = upkeepShort(row, board);
  if (!u) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1 text-meta text-warn", className)} title={u.full} data-testid="row-upkeep-line">
      <RefreshCcw aria-hidden className="size-3 shrink-0" />
      <span className="truncate">
        {bare ? <span className="sr-only">Upkeep: </span> : "Needs "}
        {u.short}
      </span>
    </span>
  );
};

export const RowBadges: React.FC<{ row: FlowRow }> = ({ row }) => (
  <>
    {row.badges.new && (
      <Badge tone="new" title={BADGE_TITLE.new}>
        new
      </Badge>
    )}
    {row.badges.stale && (
      <Badge tone="stale" title={BADGE_TITLE.stale}>
        re-verifying
      </Badge>
    )}
    {row.badges.estimated && (
      <Badge tone="estimated" title={BADGE_TITLE.estimated}>
        max-tier stand-in
      </Badge>
    )}
    {row.profitPerDay === null && (
      <Badge tone="pending" title="Not verified at this tier and frequency yet.">
        pending
      </Badge>
    )}
    {row.stall && <StallChip stall={row.stall} />}
    {row.slowing && <SlowingBadge />}
    {row.entry.summary?.scripted && <Badge tone="violet">scripted</Badge>}
  </>
);

export const Coins: React.FC<{ value: number | null; className?: string; title?: string }> = ({ value, className, title }) => (
  <span title={title} className={cn("font-semibold tabular-nums", value === null ? "text-fg-meta" : value < 0 ? "text-problem" : "text-coin", className)}>
    {value === null ? "—" : formatCoins(value)}
  </span>
);

const fraction = (row: FlowRow, top: number) => (top > 0 && row.profitPerDay !== null ? row.profitPerDay / top : 0);
const headlineTitle = (row: FlowRow, board: Board, kit: boolean) =>
  board === "ironman" && kit && row.altPerDay !== null ? `From nothing: ${formatCoins(row.altPerDay)}/day (making the starting items first)` : undefined;

const RowLikeButton: React.FC<{ row: FlowRow; like: RowLike; sort: SortKey }> = ({ row, like, sort }) => {
  const { entry } = row;
  return (
    <LikeButton
      count={(sort === "liked30d" ? entry.likes30d : entry.likes) ?? 0}
      liked={like.liked}
      busy={like.busy}
      onToggle={like.onToggle}
      needsLogin={like.needsLogin}
      title={sort === "liked30d" ? `${entry.likes30d ?? 0} likes in the last 30 days (${entry.likes ?? 0} all time)` : undefined}
    />
  );
};

/** The phone row's top earner by name (+ how many more): its answer to "which crop does it farm". */
const TopEarner: React.FC<{ row: FlowRow; className?: string }> = ({ row, className }) => {
  const first = row.earning[0];
  if (!first) return null;
  const more = row.earning.length - 1;
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <span className="truncate text-fg-body">{nameOf(first.id)}</span>
      {more > 0 && <span className="shrink-0 text-meta tabular-nums text-fg-meta">+{more}</span>}
    </span>
  );
};

/** The desktop row's earners: the top three stacked (the third only in wide containers), then "+N more". */
const TopEarners: React.FC<{ row: FlowRow }> = ({ row }) => {
  if (!row.earning.length) return null;
  const more3 = row.earning.length - 3;
  const more2 = row.earning.length - 2;
  return (
    <div className="flex min-w-0 max-w-full flex-col items-start gap-0.5" title={row.earning.length > 3 ? row.earning.map((t) => nameOf(t.id)).join(", ") : undefined}>
      {row.earning.slice(0, 3).map((t, i) => (
        <MutationChip key={t.id} id={t.id} earning={t.coinsPerDay} className={cn("max-w-full", i === 2 && "hidden @min-[80rem]:inline-flex")} />
      ))}
      {more2 > 0 && <span className="text-meta tabular-nums text-fg-meta @min-[80rem]:hidden">+{more2} more</span>}
      {more3 > 0 && <span className="hidden text-meta tabular-nums text-fg-meta @min-[80rem]:inline">+{more3} more</span>}
    </div>
  );
};

/**
 * The peek's layouts as real pictures (crop images, hover a cell for its name): every plot's,
 * plots with the same layout folded into one. Scrolls sideways when they don't fit.
 */
const PeekPictures: React.FC<{ row: FlowRow; cellSize: number; className?: string }> = ({ row, cellSize, className }) => {
  const pictures = peekLayouts(row);
  if (!pictures.length) return null;
  return (
    <div className={cn("flex min-w-0 gap-4 overflow-x-auto pb-1 scrollbar-dark", className)} data-testid="peek-pictures">
      {pictures.map((p) => (
        <figure key={p.plots.join(",")} className="shrink-0 space-y-1">
          <LayoutThumb layout={p.layout} cellSize={cellSize} tooltips />
          <figcaption className="text-meta text-fg-meta">
            <span className="text-fg-body">{plotsLabel(p.plots)}</span> · {p.note}
          </figcaption>
        </figure>
      ))}
    </div>
  );
};

/** The peek: the facts the one-line row leaves out. */
export const RowPeek: React.FC<{
  row: FlowRow;
  top: number;
  every: number;
  board: Board;
  kit: boolean;
  rankingSearch?: string;
  hoursPerCycle?: number;
  onEvery?: (every: number) => void;
  className?: string;
  /** Cell size of the layout pictures (px). */
  pictureCell?: number;
}> = ({ row, top, every, board, kit, rankingSearch, hoursPerCycle = 1.75, onEvery, className, pictureCell = 22 }) => {
  const { entry } = row;
  const ex = excerptOf(row);
  const supply = supplyText(row, board);
  const ironman = board === "ironman";
  const upkeep = entry.cell ? upkeepText(entry.cell.upkeep) : null;
  const shown = row.earning.slice(0, 8);
  const rest = row.earning.slice(8);
  return (
    <div className={cn("grid gap-x-6 gap-y-4 kit-fade-in @min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", className)} data-testid="row-peek">
      <PeekPictures row={row} cellSize={pictureCell} className="@min-[40rem]:col-span-2" />
      <div className="min-w-0 space-y-2">
        {ex && <p className="text-secondary text-fg-muted">{ex}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-secondary text-fg-meta">
          <span className="inline-flex items-center gap-1">
            <Avatar id={entry.author.id} avatar={entry.author.avatar} size={16} />
            <span className="text-fg-body">{entry.author.name}</span>
          </span>
          <span>· {shapeText(row)}</span>
          <RowBadges row={row} />
        </div>
        {shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {shown.map((t) => (
              <MutationChip key={t.id} id={t.id} earning={t.coinsPerDay} />
            ))}
          </div>
        )}
        {rest.length > 0 && <p className="text-meta text-fg-meta">Also: {rest.map((t) => nameOf(t.id)).join(", ")}</p>}
        <div className="max-w-sm">
          <SplitBar split={row.split} fraction={fraction(row, top)} />
          <SplitLegend split={row.split} className="mt-1" />
        </div>
      </div>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start gap-x-3 gap-y-1 text-secondary">
        {ironman && row.prep && (
          <>
            <dt className="text-fg-meta">Starting items</dt>
            <dd className="min-w-0">
              <StartingItemsLine prep={row.prep} className="[&>span]:whitespace-normal" />
              {Object.keys(row.prep.kit).length > 3 && <span className="text-meta text-fg-meta">All: {kitListText(row.prep.kit)}</span>}
            </dd>
          </>
        )}
        {ironman && entry.cell && (
          <>
            <dt className="text-fg-meta">Needs daily</dt>
            <dd className={upkeep === "None" ? "text-fg-body" : "text-warn"} data-testid="row-upkeep">
              {upkeep === "None" ? "Nothing: grows back everything it uses" : upkeep}
            </dd>
          </>
        )}
        {supply && (
          <>
            <dt className="text-fg-meta">Supplies</dt>
            <dd className="text-fg-body">{supply}</dd>
          </>
        )}
        {!ironman && row.buildCost !== null && row.buildCost > 0 && (
          <>
            <dt className="text-fg-meta">To build</dt>
            <dd className="tabular-nums text-fg-body">{formatCoins(row.buildCost)} once</dd>
          </>
        )}
        {ironman && kit && row.altPerDay !== null && (
          <>
            <dt className="text-fg-meta">From nothing</dt>
            <dd>
              <Coins value={row.altPerDay} />
              <span className="text-fg-meta">/day (making the starting items first)</span>
            </dd>
          </>
        )}
        <dt className="text-fg-meta">Effort per login</dt>
        <dd className="tabular-nums text-fg-body">
          {row.effortAvg === null ? "unknown" : `${Math.round(row.effortAvg)} average · ${Math.round(row.effortPeak ?? 0)} at the heaviest`}
        </dd>
        {row.stall && (
          <>
            <dt className="text-fg-meta">Stall</dt>
            <dd className="text-warn">{starvedText(row.stall.top)}</dd>
          </>
        )}
        <dd className="col-span-2 mt-1.5 flex flex-wrap gap-2">
          <ButtonLink variant="primary" size="md" to={simHref(entry.id, board, kit)}>
            <FlaskConical aria-hidden /> Open in simulator
          </ButtonLink>
          <ButtonLink size="md" to={flowHref(entry.id, board, kit)} state={{ rankingSearch: rankingSearch ?? "" } satisfies RankingLinkState}>
            Details
          </ButtonLink>
        </dd>
      </dl>
      {row.curve.some((p) => p.profitPerDay !== null) && (
        <section className="min-w-0 @min-[40rem]:col-span-2" aria-label="Profit by how often you log in">
          <h4 className="mb-1 flex items-center gap-1.5 text-secondary font-medium text-fg-body">
            Profit by how often you log in
            <span className="font-normal text-fg-meta">· {forgivingText(row.slack)} forgiving</span>
            <InfoHint label="Profit by how often you log in">{FORGIVING_HINT} Hover a point for its numbers; click one to rank every flow at that frequency.</InfoHint>
          </h4>
          <FrequencyChart points={row.curve} selected={every} hoursPerCycle={hoursPerCycle} onSelect={onEvery} height={120} />
        </section>
      )}
    </div>
  );
};

const OpenSimIcon: React.FC<{ row: FlowRow; board: Board; kit: boolean; className?: string }> = ({ row, board, kit, className }) => (
  <Link
    to={simHref(row.entry.id, board, kit)}
    aria-label={`Open ${row.entry.title} in the simulator`}
    title="Open in simulator"
    className={cn("hit-area focus-ring relative inline-grid size-7 shrink-0 place-items-center rounded-control text-fg-meta transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg", className)}
  >
    <FlaskConical aria-hidden className="size-3.5" />
  </Link>
);

const PeekButton: React.FC<{ row: FlowRow; open: boolean; onPeek?: () => void; className?: string; size?: "sm" | "touch" }> = ({ row, open, onPeek, className, size = "sm" }) => (
  <IconButton size={size} aria-label={open ? `Hide details of ${row.entry.title}` : `Show details of ${row.entry.title}`} aria-expanded={open} onClick={onPeek} className={cn("relative", className)}>
    <ChevronDown className={cn("transition-transform duration-(--duration-ink)", open && "rotate-180")} />
  </IconButton>
);

/** The desktop row (a grid row of the ranking table). */
export const FlowRowItem: React.FC<RowProps> = ({ row, top, every, board, kit = false, index, like, sort, open = false, onPeek, rankingSearch, hoursPerCycle, onEvery }) => {
  const { entry } = row;
  const ironman = board === "ironman";
  const sub = ironman ? startShort(row) : supplyText(row, board);
  const excerpt = excerptOf(row);
  return (
    <li className={cn("flows-row-in border-b border-line", open && "bg-surface-card")} style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }} data-testid="flow-row">
      <div className={cn("group relative grid min-h-24 items-center gap-x-3 px-2 py-2 transition-colors duration-(--duration-hover) hover:bg-surface-hover/50", ROW_COLS)}>
        <span className="text-right text-secondary tabular-nums text-fg-meta">{row.rank}</span>
        <span title={entry.thumb ? `Plot ${entry.thumb.plot}'s most-used layout (${percent(entry.thumb.share)} of the time)` : undefined}>
          <LayoutBoxes layout={thumbOf(row)} cell={6} />
        </span>
        <div className="min-w-0 space-y-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <Link
              to={flowHref(entry.id, board, kit)}
              state={{ rankingSearch: rankingSearch ?? "" } satisfies RankingLinkState}
              className="focus-ring line-clamp-2 min-w-0 rounded-inner text-body font-medium text-fg after:absolute after:inset-0 after:content-[''] group-hover:underline"
            >
              {entry.title}
            </Link>
            <RowBadges row={row} />
          </div>
          <div className="flex min-w-0 items-center gap-1 text-meta text-fg-meta">
            <Avatar id={entry.author.id} avatar={entry.author.avatar} size={14} />
            <span className="truncate">
              {entry.author.name} · {shapeText(row)}
            </span>
          </div>
          {sub && <div className="truncate text-meta text-fg-meta">{sub}</div>}
          {row.earning[0] && (
            <div className="flex min-w-0 items-center gap-1 pt-0.5 @min-[60rem]:hidden">
              <MutationChip id={row.earning[0].id} earning={row.earning[0].coinsPerDay} className="min-w-0" />
              {row.earning.length > 1 && <span className="shrink-0 text-meta tabular-nums text-fg-meta">+{row.earning.length - 1}</span>}
            </div>
          )}
          <UpkeepLine row={row} board={board} className="@min-[60rem]:hidden" />
          {excerpt && <p className="hidden truncate text-meta text-fg-meta italic @min-[80rem]:block">{excerpt}</p>}
        </div>
        <div className="hidden min-w-0 flex-col items-start gap-1 @min-[60rem]:flex">
          <TopEarners row={row} />
          <UpkeepLine row={row} board={board} bare />
        </div>
        <div className="min-w-0 text-right" title={splitTitle(row)}>
          <Coins value={row.profitPerDay} className="text-title" title={headlineTitle(row, board, kit)} />
          <div className="text-meta text-fg-meta">{row.scaled ? "coins/day · est." : "coins/day"}</div>
          <SplitBar split={row.split} fraction={fraction(row, top)} className="mt-1.5" />
        </div>
        <span className="min-w-0">
          <span className="@min-[60rem]:hidden">
            <EffortMeter avg={row.effortAvg} peak={row.effortPeak} compact />
          </span>
          <span className="hidden @min-[60rem]:inline">
            <EffortMeter avg={row.effortAvg} peak={row.effortPeak} />
          </span>
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkline points={row.curve} selected={every} hoursPerCycle={hoursPerCycle} />
          <span className="text-secondary tabular-nums text-fg-body" title={FORGIVING_HINT}>
            {forgivingText(row.slack)}
          </span>
        </div>
        <span className="relative z-10 flex">
          <RowLikeButton row={row} like={like} sort={sort} />
        </span>
        <OpenSimIcon row={row} board={board} kit={kit} className="z-10" />
        <PeekButton row={row} open={open} onPeek={onPeek} className="z-10" />
      </div>
      {open && (
        <RowPeek row={row} top={top} every={every} board={board} kit={kit} rankingSearch={rankingSearch} hoursPerCycle={hoursPerCycle} onEvery={onEvery} className="px-2 pt-1 pb-3 @min-[40rem]:pl-8" />
      )}
    </li>
  );
};

/** The phone row: title (stretched link), top earner and author, coins and effort, open-in-simulator and peek at 44px. */
export const PhoneRowItem: React.FC<RowProps> = ({ row, top, every, board, kit = false, index, like, sort, open = false, onPeek, rankingSearch, hoursPerCycle, onEvery }) => {
  const { entry } = row;
  const badges = row.badges.new || row.badges.stale || row.badges.estimated || row.profitPerDay === null || row.stall || row.slowing || entry.summary?.scripted;
  return (
    <li className={cn("flows-row-in border-b border-line", open && "bg-surface-card")} style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }} data-testid="flow-row">
      <div className="relative grid min-h-14 grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] items-center gap-x-1.5 py-1">
        <span className="self-start pt-1 text-right text-secondary tabular-nums text-fg-meta">{row.rank}</span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              to={flowHref(entry.id, board, kit)}
              state={{ rankingSearch: rankingSearch ?? "" } satisfies RankingLinkState}
              className="focus-ring min-w-0 truncate rounded-inner text-body font-medium text-fg after:absolute after:inset-0 after:content-['']"
            >
              {entry.title}
            </Link>
            {badges && (
              <span className="flex shrink-0 gap-1">
                <RowBadges row={row} />
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1 text-meta text-fg-meta">
            <TopEarner row={row} className="min-w-0 shrink" />
            <span className="shrink-0 truncate">· {entry.author.name}</span>
          </div>
          <UpkeepLine row={row} board={board} />
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="whitespace-nowrap">
            <Coins value={row.profitPerDay} className="text-body" title={headlineTitle(row, board, kit)} />
            {row.scaled && <span className="text-meta text-fg-meta"> est.</span>}
          </span>
          <EffortMeter avg={row.effortAvg} peak={row.effortPeak} compact />
        </div>
        <div className="relative z-10 flex items-center">
          <OpenSimIcon row={row} board={board} kit={kit} className="size-11" />
          <PeekButton row={row} open={open} onPeek={onPeek} size="touch" />
        </div>
      </div>
      {open && (
        <div className="space-y-3 pb-3 pl-7">
          <div className="flex items-center gap-2">
            <span className="text-meta text-fg-meta" title={FORGIVING_HINT}>
              {forgivingText(row.slack)} forgiving
            </span>
            <span className="relative z-10 ml-auto">
              <RowLikeButton row={row} like={like} sort={sort} />
            </span>
          </div>
          <RowPeek row={row} top={top} every={every} board={board} kit={kit} rankingSearch={rankingSearch} hoursPerCycle={hoursPerCycle} onEvery={onEvery} pictureCell={26} />
        </div>
      )}
    </li>
  );
};
