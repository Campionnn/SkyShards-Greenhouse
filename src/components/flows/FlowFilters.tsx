import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { Board } from "../../leaderboard/rules";
import { DEFAULT_FILTERS, START_ITEM_CAPS, type EarningIn, type RowFilters } from "../../leaderboard/view";
import { getRarityTextColor } from "../../utilities/rarity";
import { CropImage } from "../shared/CropImage";
import { nameOf, rarityOf } from "../simulator/format";
import { LinkButton } from "../ui/Card";
import { cn } from "../ui/cn";
import { KitInput, Segmented } from "../ui/kit";
import { Dropdown, MenuItem, Popover } from "../ui/Popover";
import type { FacetCounts } from "./ranking/rankingHelpers";

/**
 * The ranking's filters (F08–F15) as field chips that open kit menus / popovers: plots, earning
 * crops / mutations (searchable, top 3 or anywhere), and on the ironman board upkeep and a
 * starting-items cap. Each choice shows how many flows have it. The page keeps the values in its
 * URL; filtering itself is `matchesFilters` (view.ts); plots is part of the list request.
 */

/** A field chip: "Plots Any ▾". 28px, 44px on touch screens. */
export const fieldChip =
  "focus-ring inline-flex h-7 min-w-0 max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-control border border-line-control bg-surface-well px-2 text-secondary font-medium text-fg transition-colors duration-(--duration-hover) hover:bg-surface-panel pointer-coarse:h-11";

const FieldText: React.FC<{ k: string; v: string; on: boolean }> = ({ k, v, on }) => (
  <span className="min-w-0 truncate">
    <span className="text-fg-meta">{k}</span> <span className={on ? "text-select-fg" : "text-fg"}>{v}</span>
  </span>
);

const countHint = (n: number | undefined) => (n === undefined ? undefined : `${n} flow${n === 1 ? "" : "s"}`);

export type PlotsFilter = "any" | "1" | "2" | "3";

/** F09: plots (part of the list request, so it refetches). */
export const PlotsField: React.FC<{ value: PlotsFilter; onChange: (p: PlotsFilter) => void; counts?: Record<string, number> }> = ({ value, onChange, counts }) => (
  <Dropdown look="plain" label="Plots" width={220} className={fieldChip} button={<FieldText k="Plots" v={value === "any" ? "Any" : value} on={value !== "any"} />}>
    {(close) =>
      (["any", "1", "2", "3"] as PlotsFilter[]).map((p) => (
        <MenuItem key={p} checked={value === p} hint={p === "any" ? undefined : countHint(counts?.[p])} onSelect={() => (onChange(p), close())}>
          {p === "any" ? "Any number of plots" : `${p} plot${p === "1" ? "" : "s"}`}
        </MenuItem>
      ))
    }
  </Dropdown>
);

/** F12: Ironman, no upkeep. */
export const UpkeepField: React.FC<{ value: boolean; onChange: (v: boolean) => void; count?: number }> = ({ value, onChange, count }) => (
  <Dropdown look="plain" label="Upkeep" width={260} className={fieldChip} button={<FieldText k="Upkeep" v={value ? "None" : "Any"} on={value} />}>
    {(close) => (
      <>
        <MenuItem checked={!value} onSelect={() => (onChange(false), close())}>
          Any upkeep
        </MenuItem>
        <MenuItem checked={value} hint={`Grows back everything it uses${count !== undefined ? ` · ${countHint(count)}` : ""}`} onSelect={() => (onChange(true), close())}>
          No upkeep
        </MenuItem>
      </>
    )}
  </Dropdown>
);

const capLabel = (n: number | null) => (n === null ? "Any" : n === 0 ? "None" : `≤ ${n}`);

/** F13: Ironman, a starting-items cap (Any / 0 / ≤60 / ≤200). */
export const StartField: React.FC<{ value: number | null; onChange: (v: number | null) => void; counts?: Record<string, number> }> = ({ value, onChange, counts }) => (
  <Dropdown look="plain" label="Starting items" width={240} className={fieldChip} button={<FieldText k="Starting items" v={capLabel(value)} on={value !== null} />}>
    {(close) =>
      START_ITEM_CAPS.map((n) => (
        <MenuItem key={String(n)} checked={value === n} hint={n === null ? undefined : countHint(counts?.[String(n)])} onSelect={() => (onChange(n), close())}>
          {n === null ? "Any amount" : n === 0 ? "None needed" : `At most ${n}`}
        </MenuItem>
      ))
    }
  </Dropdown>
);

/** F10's panel: search, top 3 / anywhere, a checklist (crop image, rarity colour, count), selected first, Clear. */
export const EarningPanel: React.FC<{
  options: readonly string[];
  value: readonly string[];
  mode: EarningIn;
  onChange: (ids: string[], mode: EarningIn) => void;
  counts?: FacetCounts;
}> = ({ options, value, mode, onChange, counts }) => {
  const [q, setQ] = useState("");
  const per = counts ? (mode === "any" ? counts.anywhere : counts.top3) : null;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Selected ones first, so they're easy to untick; unknown selected ids (not on this board) stay listed.
    const all = [...new Set([...value, ...options])].sort((a, b) => Number(value.includes(b)) - Number(value.includes(a)) || (per ? (per[b] ?? 0) - (per[a] ?? 0) : 0) || nameOf(a).localeCompare(nameOf(b)));
    return t ? all.filter((id) => nameOf(id).toLowerCase().includes(t) || id.includes(t)) : all;
  }, [q, options, value, per]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id], mode);
  return (
    <div className="space-y-2 p-1.5">
      <label className="relative block">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-meta" />
        <KitInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a crop or mutation" aria-label="Find a crop or mutation" className="w-full pl-8" />
      </label>
      <Segmented
        label="Where it earns"
        value={mode}
        onChange={(m) => onChange([...value], m)}
        options={[
          { value: "top3", label: "In its top 3", title: "Among the flow's three biggest earners on this board" },
          { value: "any", label: "Anywhere", title: "Earns any coins on this board" },
        ]}
      />
      <ul className="scrollbar-dark max-h-60 overflow-y-auto overscroll-contain" aria-label="Crops and mutations">
        {shown.map((id) => {
          const on = value.includes(id);
          const rarity = rarityOf(id);
          return (
            <li key={id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(id)}
                className="focus-ring-inset flex h-8 w-full cursor-pointer items-center gap-2 rounded-inner px-1.5 text-left text-body transition-colors duration-(--duration-hover) hover:bg-surface-hover pointer-coarse:h-11"
              >
                <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded-inner border", on ? "border-select bg-select text-surface-page" : "border-line-control")}>
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={18} height={18} showFallback />
                <span className={cn("min-w-0 truncate", rarity ? getRarityTextColor(rarity) : "text-fg-body")}>{nameOf(id)}</span>
                {per && <span className="ml-auto text-meta tabular-nums text-fg-meta">{per[id] ?? 0}</span>}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="px-1.5 py-3 text-center text-secondary text-fg-meta">Nothing matches.</li>}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-line px-1 pt-2">
        <span className="text-meta text-fg-meta">{value.length ? `${value.length} picked` : "Pick any number"}</span>
        <LinkButton disabled={!value.length} onClick={() => onChange([], mode)}>
          Clear
        </LinkButton>
      </div>
    </div>
  );
};

const earningLabel = (value: readonly string[], mode: EarningIn) =>
  value.length ? `${nameOf(value[0])}${value.length > 1 ? ` +${value.length - 1}` : ""} · ${mode === "any" ? "anywhere" : "top 3"}` : "Any";

/** F10: the earning chip; its popover takes focus (the search box). */
export const EarningField: React.FC<{
  options: readonly string[];
  value: readonly string[];
  mode: EarningIn;
  onChange: (ids: string[], mode: EarningIn) => void;
  counts?: FacetCounts;
}> = (props) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={setAnchor} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={fieldChip} data-testid="earning-filter">
        <FieldText k="Earning" v={earningLabel(props.value, props.mode)} on={props.value.length > 0} />
        <ChevronDown aria-hidden className={cn("size-3 shrink-0 text-fg-meta transition-transform duration-(--duration-ink)", open && "rotate-180")} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Earning crops and mutations" width={300} reserve={360} initialFocus="first">
        <EarningPanel {...props} />
      </Popover>
    </>
  );
};

/**
 * The ranking's filter chips. `board` decides the Ironman-only ones; `counts` (facets over the
 * board's ranked rows) label each choice; `plots` is optional (the page can place it itself).
 */
export const FilterBar: React.FC<{
  board: Board;
  filters: RowFilters;
  earningOptions: readonly string[];
  onChange: (patch: Partial<RowFilters>) => void;
  plots?: PlotsFilter;
  onPlots?: (p: PlotsFilter) => void;
  plotCounts?: Record<string, number>;
  counts?: FacetCounts;
  /** Leading controls (the phone's sort chip and starting-items switch). */
  lead?: React.ReactNode;
  className?: string;
}> = ({ board, filters, earningOptions, onChange, plots, onPlots, plotCounts, counts, lead, className }) => {
  const ironman = board === "ironman";
  const active = filters.earning.length > 0 || (ironman && (filters.noUpkeep || filters.maxStartItems !== null));
  return (
    <div className={cn("flex items-center gap-1.5", className)} data-testid="filter-bar">
      {lead}
      {plots !== undefined && onPlots && <PlotsField value={plots} onChange={onPlots} counts={plotCounts} />}
      <EarningField options={earningOptions} value={filters.earning} mode={filters.earningIn} counts={counts} onChange={(earning, earningIn) => onChange({ earning, earningIn })} />
      {ironman && <UpkeepField value={filters.noUpkeep} count={counts?.noUpkeep} onChange={(noUpkeep) => onChange({ noUpkeep })} />}
      {ironman && <StartField value={filters.maxStartItems} counts={counts?.caps} onChange={(maxStartItems) => onChange({ maxStartItems })} />}
      {active && (
        <LinkButton className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap" onClick={() => onChange({ earning: [], earningIn: DEFAULT_FILTERS.earningIn, noUpkeep: false, maxStartItems: null })}>
          <X aria-hidden className="size-3" /> Clear filters
        </LinkButton>
      )}
    </div>
  );
};
