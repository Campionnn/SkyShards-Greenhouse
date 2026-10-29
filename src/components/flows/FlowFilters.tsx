import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Sprout, X } from "lucide-react";
import type { Board } from "../../leaderboard/rules";
import { START_ITEM_CAPS, type EarningIn, type RowFilters } from "../../leaderboard/view";
import { CropImage } from "../shared/CropImage";
import { nameOf, rarityOf } from "../simulator/format";
import { inputClass } from "../simulator/styles";
import { getRarityTextColor } from "../../utilities/rarity";

/**
 * The ranking's filter bar (docs/plans/leaderboard-boards-v2.md §7.1): earning crops / mutations,
 * and on the ironman board the "I have the starting items" switch, no upkeep and a starting-items
 * cap. The page keeps the values in its URL; filtering itself is `matchesFilters` (view.ts).
 */

const pill = (active: boolean) =>
  `inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97] ${
    active ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" : "border-slate-600/40 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 hover:text-slate-100"
  }`;

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, ref, close]);
}

/** The searchable multi-select of earning plants, with the "in top 3" / "anywhere" mode. */
export const EarningPicker: React.FC<{
  options: readonly string[];
  value: readonly string[];
  mode: EarningIn;
  onChange: (ids: string[], mode: EarningIn) => void;
}> = ({ options, value, mode, onChange }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Selected ones first, so they're easy to untick; unknown selected ids (not on this board) stay listed.
    const all = [...new Set([...value, ...options])];
    return t ? all.filter((id) => nameOf(id).toLowerCase().includes(t) || id.includes(t)) : all;
  }, [q, options, value]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id], mode);
  const label = value.length === 0 ? "Any" : value.length === 1 ? nameOf(value[0]) : `${nameOf(value[0])} +${value.length - 1}`;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={pill(value.length > 0)} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox" data-testid="earning-filter">
        <Sprout className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-slate-400">Earning</span>
        {value.length === 1 && <CropImage cropId={value[0]} cropName={nameOf(value[0])} size="custom" width={14} height={14} showFallback={false} />}
        <span className="max-w-[9rem] truncate">{label}</span>
        {value.length > 0 && <span className="text-[10px] font-normal text-slate-400">{mode === "any" ? "anywhere" : "top 3"}</span>}
        <ChevronDown className={`h-3 w-3 text-slate-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 rounded-lg border border-slate-600/50 bg-slate-800 p-2 shadow-xl" role="dialog" aria-label="Earning crops and mutations">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              type="search"
              className={`${inputClass} w-full py-1.5 pl-7 text-xs`}
              placeholder="Find a crop or mutation"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Find a crop or mutation"
            />
          </label>
          <div className="mt-2 flex gap-1" role="group" aria-label="Where it earns">
            {(["top3", "any"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange([...value], m)}
                className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  mode === m ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200" : "border-slate-600/40 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                }`}
                title={m === "top3" ? "Among the flow's three biggest earners on this board" : "Earns any coins on this board"}
              >
                {m === "top3" ? "In its top 3" : "Anywhere"}
              </button>
            ))}
          </div>
          <ul className="scrollbar-dark mt-2 max-h-64 overflow-y-auto overscroll-contain pr-1" role="listbox" aria-multiselectable>
            {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-slate-500">Nothing matches.</li>}
            {shown.map((id) => {
              const on = value.includes(id);
              const rarity = rarityOf(id);
              return (
                <li key={id} role="option" aria-selected={on}>
                  <button type="button" onClick={() => toggle(id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${on ? "bg-emerald-500/10" : "hover:bg-slate-700/50"}`}>
                    <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${on ? "border-emerald-400 bg-emerald-500/80 text-slate-950" : "border-slate-500"}`}>{on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
                    <CropImage cropId={id} cropName={nameOf(id)} size="custom" width={18} height={18} showFallback />
                    <span className={`truncate ${rarity ? getRarityTextColor(rarity) : "text-slate-200"}`}>{nameOf(id)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {value.length > 0 && (
            <button type="button" className="mt-1.5 w-full rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200" onClick={() => onChange([], mode)}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const capLabel = (n: number | null) => (n === null ? "Any" : n === 0 ? "0" : `≤ ${n}`);

/** The whole filter bar. `kitSwitch` (the ironman "I have the starting items" switch) leads the ironman-only filters. */
export const FilterBar: React.FC<{
  board: Board;
  filters: RowFilters;
  earningOptions: readonly string[];
  kitSwitch?: React.ReactNode;
  onChange: (patch: Partial<RowFilters>) => void;
}> = ({ board, filters, earningOptions, kitSwitch, onChange }) => {
  const borrow = board === "ironman";
  const active = filters.earning.length > 0 || (borrow && (filters.noUpkeep || filters.maxStartItems !== null));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="filter-bar">
      <EarningPicker options={earningOptions} value={filters.earning} mode={filters.earningIn} onChange={(earning, earningIn) => onChange({ earning, earningIn })} />
      {borrow && (
        <>
          {kitSwitch}
          <button type="button" className={pill(filters.noUpkeep)} aria-pressed={filters.noUpkeep} onClick={() => onChange({ noUpkeep: !filters.noUpkeep })} title="Hide flows that need some items supplied every day">
            No upkeep
          </button>
          <div className="flex items-center gap-1" role="group" aria-label="Starting items">
            <span className="mr-0.5 text-[11px] uppercase tracking-wide text-slate-500">Starting items</span>
            {START_ITEM_CAPS.map((n) => (
              <button
                key={String(n)}
                type="button"
                aria-pressed={filters.maxStartItems === n}
                onClick={() => onChange({ maxStartItems: n })}
                className={`rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
                  filters.maxStartItems === n ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-200" : "border-transparent text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                }`}
              >
                {capLabel(n)}
              </button>
            ))}
          </div>
        </>
      )}
      {active && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-slate-200"
          onClick={() => onChange({ earning: [], earningIn: "top3", noUpkeep: false, maxStartItems: null })}
        >
          <X className="h-3 w-3" /> Clear filters
        </button>
      )}
    </div>
  );
};
