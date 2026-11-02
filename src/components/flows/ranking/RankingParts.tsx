import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown, RefreshCw } from "lucide-react";
import type { FlowViewer } from "../../../hooks/useFlowViewer";
import { EVERY } from "../../../leaderboard/tiers";
import { SORT_LABEL, type SortKey } from "../../../leaderboard/view";
import { priceAge } from "../../simulator/bazaarFormat";
import { cn } from "../../ui/cn";
import { IconButton, KitButton, KitLabel } from "../../ui/kit";
import { Dropdown, MenuItem, Popover } from "../../ui/Popover";
import { SPLIT_STYLE } from "../flowsDisplay";
import { FORGIVING_HINT, ROW_COLS, SORT_HINT } from "./rankingHelpers";

/** The ranking's smaller parts: the prices-and-key popover, the sort heads and menu, the list states. */

// ---- Prices and key (F16, F17, F20) --------------------------------------------------------------

/** The legend and price notes in one popover behind a visible "NPC prices · Key" button (it takes focus). */
export const KeyButton: React.FC<{ viewer: FlowViewer; now: number; className?: string }> = ({ viewer, now, className }) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const normal = viewer.board === "normal";
  const { prices, loading, error, refresh } = viewer.bazaar;
  const priceText = normal ? (loading ? "Fetching Bazaar prices" : prices ? `Bazaar · ${priceAge(prices.fetchedAt, now)}` : "No Bazaar prices yet") : "NPC prices";
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-control px-1.5 text-meta whitespace-nowrap text-fg-meta transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg-body aria-expanded:bg-surface-hover aria-expanded:text-fg-body pointer-coarse:h-11",
          className,
        )}
      >
        <span className={cn(error && normal && "text-warn")}>{priceText}</span>
        {viewer.scaling && <span className="text-fg-body">· est.</span>}
        <span className="text-fg-muted">· Key</span>
        <ChevronDown aria-hidden className={cn("size-3 text-fg-meta transition-transform duration-(--duration-ink)", open && "rotate-180")} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Prices and key" width={320} align="end" initialFocus="first">
        <div className="space-y-3 p-2 text-secondary" data-testid="ranking-key">
          <section className="space-y-1">
            <KitLabel>Prices</KitLabel>
            {normal ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-body">
                <span>
                  {loading ? "Fetching Bazaar prices..." : prices ? `Bazaar prices from ${priceAge(prices.fetchedAt, now)}` : "No Bazaar prices yet"}
                  {error && <span className="text-warn"> (refresh failed)</span>}
                </span>
                <KitButton size="sm" variant="ghost" onClick={refresh} loading={loading}>
                  <RefreshCw /> Refresh
                </KitButton>
              </div>
            ) : (
              <p className="text-fg-body">NPC prices; mutation items are kept, not sold.</p>
            )}
            {viewer.scaling && <p className="text-fg-body">Crop and rare-crop numbers are scaled to your yield stats (an estimate, marked "est.").</p>}
          </section>
          <section className="space-y-1.5">
            <KitLabel>Reading a row</KitLabel>
            <ul className="space-y-1 text-fg-body">
              {(
                [
                  ["mutations", "mutation items"],
                  ["crops", "crops"],
                  ["rare", "rare crops and drops"],
                ] as const
              ).map(([k, label]) => (
                <li key={k} className="flex items-center gap-2">
                  <span aria-hidden className={cn("h-1.5 w-3 rounded-full", SPLIT_STYLE[k].bar)} /> {label}
                </li>
              ))}
              <li>Bar length: this flow's profit against the top flow's.</li>
              <li className="flex items-start gap-2">
                <span aria-hidden className="mt-1 inline-flex items-end gap-[2px]">
                  {[40, 70, 100].map((h, i) => (
                    <span key={h} className={cn("w-1 rounded-full", i === 0 ? "bg-select" : "bg-line-control")} style={{ height: h / 10 + 3 }} />
                  ))}
                </span>
                <span>Profit if you log in every {EVERY.join(", ")} cycles; yours is the bright bar.</span>
              </li>
              <li>Forgiving: {FORGIVING_HINT.charAt(0).toLowerCase() + FORGIVING_HINT.slice(1)}</li>
            </ul>
          </section>
        </div>
      </Popover>
    </>
  );
};

export const ReloadButton: React.FC<{ loading: boolean; onReload: () => void }> = ({ loading, onReload }) => (
  <IconButton aria-label="Reload the list" title="Fetch the list again" disabled={loading} onClick={onReload}>
    <RefreshCw className={cn(loading && "animate-spin motion-reduce:animate-none")} />
  </IconButton>
);

// ---- Sorts (F07) ---------------------------------------------------------------------------------------

const SORTS = Object.keys(SORT_LABEL) as SortKey[];

/** A column head that sorts: aria-pressed, the column's aria-sort, the hint as its title. */
export const SortHead: React.FC<{ sort: SortKey; k: SortKey; onSort: (k: SortKey) => void; label: string; align?: "end"; children: React.ReactNode }> = ({ sort, k, onSort, label, align, children }) => {
  const on = sort === k || (k === "liked" && sort === "liked30d");
  return (
    <div role="columnheader" aria-sort={on ? (k === "effort" ? "ascending" : "descending") : "none"} className={cn("flex min-w-0", align === "end" && "justify-end")}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={`Sort by ${label}`}
        title={SORT_HINT[k]}
        onClick={() => onSort(k)}
        className={cn(
          "hit-area focus-ring inline-flex h-6 cursor-pointer items-center gap-0.5 rounded-inner text-label uppercase transition-colors duration-(--duration-hover)",
          on ? "text-select-fg" : "text-fg-meta hover:text-fg-body",
        )}
      >
        {children}
        <ChevronDown aria-hidden className={cn("size-3", !on && "opacity-0")} />
      </button>
    </div>
  );
};

/** The sorts that have no column ("More sorts"), or every sort on a phone (`all`). The rank stays the profit rank. */
export const SortMenu: React.FC<{ sort: SortKey; onSort: (k: SortKey) => void; all?: boolean; className?: string }> = ({ sort, onSort, all, className }) => {
  const keys: SortKey[] = all ? SORTS : ["perEffort", "liked30d", "newest"];
  const on = keys.includes(sort);
  return (
    <Dropdown
      look="plain"
      label={all ? "Sort" : "More sorts"}
      width={280}
      align={all ? "start" : "end"}
      className={cn(
        all
          ? "focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-control border border-line-control bg-surface-well px-2 text-secondary font-medium text-fg transition-colors duration-(--duration-hover) hover:bg-surface-panel pointer-coarse:h-11"
          : cn("hit-area focus-ring inline-flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-inner text-label uppercase", on ? "text-select-fg" : "text-fg-meta hover:text-fg-body"),
        className,
      )}
      button={
        all ? (
          <span className="whitespace-nowrap">
            <span className="text-fg-meta">Sort</span> {SORT_LABEL[sort]}
          </span>
        ) : on ? (
          SORT_LABEL[sort]
        ) : (
          "More sorts"
        )
      }
    >
      {(close) => (
        <>
          {keys.map((k) => (
            <MenuItem key={k} checked={sort === k} hint={SORT_HINT[k]} onSelect={() => (onSort(k), close())}>
              {SORT_LABEL[k]}
            </MenuItem>
          ))}
          <p className="px-2 pt-1 pb-1.5 text-meta text-fg-meta">The # stays the profit rank whatever the sort.</p>
        </>
      )}
    </Dropdown>
  );
};

// ---- States (F22–F26) ---------------------------------------------------------------------------------

const Bone: React.FC<{ className?: string }> = ({ className }) => <span className={cn("block rounded-inner bg-surface-hover", className)} />;

/**
 * Loading rows shaped like the real ones, on the same grid (ROW_COLS) as the header and rows, so
 * nothing jumps when the data lands. `phone` mirrors PhoneRowItem.
 */
export const ListSkeleton: React.FC<{ phone?: boolean }> = ({ phone = false }) => (
  <ul aria-busy className="animate-pulse motion-reduce:animate-none">
    {Array.from({ length: 6 }, (_, i) =>
      phone ? (
        <li key={i} className="grid min-h-14 grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] items-center gap-x-1.5 border-b border-line py-2">
          <Bone className="h-3 w-3 justify-self-end" />
          <span className="space-y-1.5">
            <Bone className="h-3.5 w-2/3" />
            <Bone className="h-2.5 w-1/2 bg-surface-hover/70" />
          </span>
          <span className="flex flex-col items-end gap-1.5">
            <Bone className="h-3.5 w-12" />
            <Bone className="h-2.5 w-8 bg-surface-hover/70" />
          </span>
          <span className="flex gap-1 pl-1">
            <Bone className="size-8" />
            <Bone className="size-8" />
          </span>
        </li>
      ) : (
        <li key={i} className={cn("grid min-h-24 items-center gap-x-3 border-b border-line px-2 py-2", ROW_COLS)}>
          <Bone className="h-3 w-3 justify-self-end" />
          <Bone className="size-[77px] bg-surface-hover/70" />
          <span className="min-w-0 space-y-2">
            <Bone className="h-3.5 w-3/5" />
            <Bone className="h-2.5 w-2/5 bg-surface-hover/70" />
            <Bone className="h-2.5 w-1/2 bg-surface-hover/70" />
            <Bone className="h-4 w-24 @min-[60rem]:hidden" />
          </span>
          <span className="hidden min-w-0 space-y-1.5 @min-[60rem]:block">
            <Bone className="h-4 w-28" />
            <Bone className="h-4 w-24 bg-surface-hover/70" />
          </span>
          <span className="flex flex-col items-end gap-1.5">
            <Bone className="h-4 w-14" />
            <Bone className="h-2.5 w-12 bg-surface-hover/70" />
            <Bone className="h-2 w-full" />
          </span>
          <Bone className="h-3 w-10" />
          <span className="flex items-end gap-[3px]">
            {[28, 24, 22, 20, 16, 14, 10].map((h, j) => (
              <span key={j} className="block w-1.5 rounded-full bg-surface-hover" style={{ height: h }} />
            ))}
          </span>
          <Bone className="h-7 w-11" />
          <Bone className="size-5 justify-self-center" />
          <Bone className="size-5 justify-self-center" />
        </li>
      ),
    )}
    <li className="sr-only">Loading the rankings...</li>
  </ul>
);

export const ListError: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="space-y-3 py-12 text-center" role="alert">
    <p className="text-body text-problem">Could not load the rankings: {error}</p>
    <KitButton onClick={onRetry}>
      <RefreshCw /> Try again
    </KitButton>
  </div>
);

export const ListEmpty: React.FC<{ plots: string }> = ({ plots }) => (
  <div className="space-y-3 py-12 text-center text-body text-fg-muted">
    <p>
      No flows on this board{plots !== "any" ? ` with ${plots} plot${plots === "1" ? "" : "s"}` : ""} yet.
    </p>
    <p>
      <Link
        to="/simulator"
        className="focus-ring hit-area inline-flex h-8 items-center gap-1.5 rounded-control border border-line-strong bg-surface-control px-3 text-body font-medium text-fg-body transition-colors duration-(--duration-hover) hover:bg-surface-hover"
      >
        Build one and press "Submit to leaderboard" in the simulator <ArrowUpRight aria-hidden className="size-3.5 text-fg-meta" />
      </Link>
    </p>
  </div>
);

export const ListNoMatch: React.FC<{ query: string; onClear?: () => void }> = ({ query, onClear }) => (
  <div className="space-y-3 py-12 text-center text-body text-fg-muted">
    <p>{query.trim() ? `Nothing matches "${query.trim()}" with these filters.` : "No flow on this board matches these filters."}</p>
    {onClear && <KitButton onClick={onClear}>Clear search and filters</KitButton>}
  </div>
);
