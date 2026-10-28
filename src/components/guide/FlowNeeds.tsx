/**
 * The whole flow's mutation totals, from the plot script's own build plan (`flowNeeds`):
 * - `FlowNeedsPanel`: one collapsible line on the page ("x of y mutations covered") that opens into
 *   every item, grouped like the inventory, with covered / estimated total.
 * - `WorkingTowards`: a card section for the farm a plot is on or moving to: how far each product
 *   is from the point the farm hands the plot on, plus that product's whole-flow total.
 */
import React, { useMemo, useState } from "react";
import { Check, ChevronDown, ListChecks } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { GROUP_LABELS, groupedItems, itemName, needsTotals, type Catalog, type FlowNeeds, type WaitFor } from "../../guide";
import { CropImage } from "../shared/CropImage";

const n = (v: number) => v.toLocaleString("en-US");

const Bar: React.FC<{ value: number; max: number; label: string; done?: boolean }> = ({ value, max, label, done }) => {
  const pct = Math.min(100, Math.round((100 * value) / Math.max(1, max)));
  return (
    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-700" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span className={`block h-full rounded-full ${done ? "bg-emerald-400" : "bg-emerald-400/70"}`} style={{ width: `${pct}%` }} />
    </span>
  );
};

export const FlowNeedsPanel: React.FC<{ needs: FlowNeeds; catalog: Catalog; data: GameData }> = ({ needs, catalog, data }) => {
  const [open, setOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const totals = needsTotals(needs);
  const groups = useMemo(() => groupedItems(data, catalog), [data, catalog]);
  const pct = Math.round((100 * totals.covered) / Math.max(1, totals.total));
  return (
    <section className="rounded-lg border border-slate-600/30 bg-slate-800/40" aria-label="Everything the flow needs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors hover:bg-slate-700/20"
      >
        <ListChecks className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-slate-100">Whole flow</span>
          <span className="text-slate-300">
            <span className="font-semibold tabular-nums text-slate-100">{n(totals.covered)}</span> of ~{n(totals.total)} mutations covered
          </span>
          <span className="flex w-28 items-center">
            <Bar value={totals.covered} max={totals.total} label="Whole flow" done={totals.covered >= totals.total} />
          </span>
          <span className="text-xs text-slate-400">
            {totals.done} of {totals.items} items done · {pct}%
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-slate-400">
          {open ? "Hide" : "Every item"} <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-600/30 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-3xl text-xs text-slate-400">
              Roughly how many of each mutation the whole Rose Dragon flow uses from an empty start: inputs for later farms plus the goal itself. What you own counts,
              and so does owning what an item gets made into: with enough of everything made from Gloomgourd, Gloomgourd is done even with none left. Yields are
              averages, so totals are estimates.
            </p>
            <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" className="accent-emerald-500" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              Hide done
            </label>
          </div>
          {groups.map(({ group, items }) => {
            const rows = items.map((id) => needs.items[id]).filter((r) => r && !(hideDone && r.remaining === 0));
            if (!rows.length) return null;
            return (
              <div key={group}>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">{GROUP_LABELS[group]}</h4>
                <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((r) => {
                    const done = r.remaining === 0;
                    return (
                      <li key={r.item} className="flex items-center gap-2 text-xs" title={done ? `${itemName(data, r.item)}: covered for the whole flow` : `${n(r.remaining)} more ${itemName(data, r.item)} to make`}>
                        <CropImage cropId={r.item} cropName={itemName(data, r.item)} width={18} height={18} showFallback={false} />
                        <span className={`w-28 shrink-0 truncate ${done ? "text-slate-400" : "text-slate-200"}`}>{itemName(data, r.item)}</span>
                        <Bar value={r.covered} max={r.total} label={itemName(data, r.item)} done={done} />
                        <span className={`w-20 shrink-0 text-right tabular-nums ${done ? "text-emerald-300" : "text-slate-300"}`}>
                          {done ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Check className="h-3 w-3" /> {n(r.total)}
                            </span>
                          ) : (
                            <>
                              {n(r.covered)}/{n(r.total)}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

/**
 * "Working towards" on a plot card: each product of the farm, how many you have against the point
 * where this farm hands the plot on (the script's stock mark, or what the flow still needs if that
 * is less), and the product's whole-flow progress underneath.
 */
export const WorkingTowards: React.FC<{
  products: string[];
  needs: FlowNeeds;
  /** Stock the counts are read from (after earlier plots this visit). */
  inventory: Readonly<Record<string, number>>;
  /** The script's own hold list for a farm it keeps: its targets win when present. */
  waitFor?: WaitFor[];
  data: GameData;
  footnote?: React.ReactNode;
}> = ({ products, needs, inventory, waitFor = [], data, footnote }) => {
  const rows = [...new Set(products)]
    .map((item) => {
      const need = needs.items[item];
      if (!need) return null;
      const scripted = waitFor.find((w) => w.item === item && w.target > 0);
      const have = scripted ? scripted.have : Math.max(0, inventory[item] ?? 0);
      const done = need.remaining === 0 && !scripted;
      const mark = needs.high[item] ?? Infinity;
      const target = scripted ? scripted.target : done ? have : Math.max(have, Math.min(mark, have + need.remaining));
      return { item, have, target, done, need };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => Number(a.done) - Number(b.done));
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Working towards</h4>
      <ul className="space-y-1.5">
        {rows.slice(0, 8).map((r) => (
          <li key={r.item} className="text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <CropImage cropId={r.item} cropName={itemName(data, r.item)} width={16} height={16} showFallback={false} />
              <span className={`w-24 shrink-0 truncate sm:w-28 ${r.done ? "text-slate-400" : ""}`}>{itemName(data, r.item)}</span>
              {r.done ? (
                <span className="flex flex-1 items-center gap-1 text-emerald-300">
                  <Check className="h-3 w-3" /> enough for the whole flow
                </span>
              ) : (
                <>
                  <Bar value={r.have} max={r.target} label={itemName(data, r.item)} />
                  <span className="w-16 shrink-0 text-right tabular-nums text-slate-300">
                    {n(r.have)}/{n(r.target)}
                  </span>
                </>
              )}
            </div>
            <p className="pl-6 text-[11px] text-slate-500">
              Whole flow: {n(r.need.covered)} of ~{n(r.need.total)} covered
              {r.need.remaining > 0 ? ` · ${n(r.need.remaining)} still to make` : ""}
            </p>
          </li>
        ))}
      </ul>
      {footnote}
    </div>
  );
};
