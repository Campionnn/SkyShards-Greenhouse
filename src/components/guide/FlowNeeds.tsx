/**
 * The whole flow's mutation totals, measured from simulated runs (`flowNeeds`):
 * - `FlowNeedsPanel`: one line in the status panel ("Whole flow 112 of ~759 mutations") with an
 *   "Every item" disclosure: every item, grouped like the inventory, with covered / estimated total.
 * - `WorkingTowards`: a card section for the farm a plot is on or moving to: how far each product
 *   is from the point the farm hands the plot on, plus that product's whole-flow total.
 */
import React, { useMemo, useState } from "react";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { GROUP_LABELS, groupedItems, itemName, needsTotals, type Catalog, type FlowNeeds, type WaitFor } from "../../guide";
import { CropImage } from "../shared/CropImage";
import { cn } from "../ui/cn";
import { InfoHint } from "../ui/InfoHint";
import { KitLabel, Switch } from "../ui/kit";

const n = (v: number) => v.toLocaleString("en-US");

/** A neutral meter (data, not an action): the bar is `fg-meta`, full is `fg-muted`. */
const Bar: React.FC<{ value: number; max: number; label: string; done?: boolean; className?: string }> = ({ value, max, label, done, className }) => {
  const pct = Math.min(100, Math.round((100 * value) / Math.max(1, max)));
  return (
    <span className={cn("h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line", className)} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span className={cn("block h-full rounded-full", done ? "bg-fg-muted" : "bg-fg-meta")} style={{ width: `${pct}%` }} />
    </span>
  );
};

export const FlowNeedsPanel: React.FC<{ needs: FlowNeeds; catalog: Catalog; data: GameData; className?: string }> = ({ needs, catalog, data, className }) => {
  const [open, setOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const totals = needsTotals(needs);
  const groups = useMemo(() => groupedItems(data, catalog), [data, catalog]);
  const pct = Math.round((100 * totals.covered) / Math.max(1, totals.total));
  if (!needs.ready)
    return (
      <section className={cn("flex min-w-0 items-center gap-2 text-secondary text-fg-muted", className)} aria-label="Everything the flow needs">
        <span className="text-fg-body">Whole flow</span>
        <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> counting every mutation it uses…
      </section>
    );
  return (
    <section className={cn("min-w-0", className)} aria-label="Everything the flow needs">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-secondary text-fg-muted">
        <span className="whitespace-nowrap">
          Whole flow <b className="font-semibold tabular-nums text-fg">{n(totals.covered)}</b> of ~{n(totals.total)} mutations
        </span>
        <Bar value={totals.covered} max={totals.total} label="Whole flow" done={totals.covered >= totals.total} className="w-20 flex-none" />
        <span className="tabular-nums whitespace-nowrap text-fg-meta">
          {totals.done}/{totals.items} items · {pct}%
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded-control px-1.5 text-secondary text-fg-muted transition-colors duration-(--duration-hover) hover:bg-surface-hover hover:text-fg pointer-coarse:h-11"
        >
          Every item <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-(--duration-ink)", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-4 border-t border-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-secondary text-fg-muted">
              Typical use from an empty start, from {needs.runs} simulated runs
              <InfoHint title="Whole-flow totals" width={340}>
                How many of each mutation the whole Rose Dragon flow typically uses from an empty start: what its farms place, plus what the goal keeps. Measured with your
                schedule and stats (the middle run per item). What's left is measured the same way from where you are now, so owning what an item gets made into counts too:
                with enough of everything made from Gloomgourd, Gloomgourd is done even with none left. Harvests are random, so these are estimates.
              </InfoHint>
            </span>
            <Switch checked={hideDone} onChange={setHideDone} label="Hide done" showLabel />
          </div>
          {groups.map(({ group, items }) => {
            const rows = items.map((id) => needs.items[id]).filter((r) => r && !(hideDone && r.remaining === 0));
            if (!rows.length) return null;
            return (
              <div key={group}>
                <KitLabel>{GROUP_LABELS[group]}</KitLabel>
                <ul className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((r) => {
                    const done = r.remaining === 0;
                    return (
                      <li key={r.item} className="flex items-center gap-2 text-secondary" title={done ? `${itemName(data, r.item)}: covered for the whole flow` : `${n(r.remaining)} more ${itemName(data, r.item)} to make`}>
                        <CropImage cropId={r.item} cropName={itemName(data, r.item)} width={18} height={18} showFallback={false} />
                        <span className={cn("w-28 shrink-0 truncate", done ? "text-fg-meta" : "text-fg-body")}>{itemName(data, r.item)}</span>
                        <Bar value={r.covered} max={r.total} label={itemName(data, r.item)} done={done} />
                        <span className={cn("w-20 shrink-0 text-right tabular-nums", done ? "text-fg-muted" : "text-fg-body")}>
                          {done ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Check aria-hidden className="size-3" /> {n(r.total)}
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
      // While the totals are still being simulated, the bar uses the script's stock mark alone.
      const need = needs.items[item] ?? null;
      const scripted = waitFor.find((w) => w.item === item && w.target > 0);
      const have = scripted ? scripted.have : Math.max(0, inventory[item] ?? 0);
      const mark = needs.high[item];
      if (!need && !scripted && mark === undefined) return null;
      const done = !!need && need.remaining === 0 && !scripted;
      const target = scripted ? scripted.target : done ? have : Math.max(have, Math.min(mark ?? Infinity, need ? have + need.remaining : Infinity));
      return { item, have, target, done, need };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => Number(a.done) - Number(b.done));
  if (!rows.length) return null;
  return (
    <div>
      <KitLabel>Working towards</KitLabel>
      <ul className="mt-1.5 space-y-1.5">
        {rows.slice(0, 8).map((r) => (
          <li key={r.item} className="text-secondary">
            <div className="flex items-center gap-2 text-fg-body">
              <CropImage cropId={r.item} cropName={itemName(data, r.item)} width={16} height={16} showFallback={false} />
              <span className={cn("w-24 shrink-0 truncate sm:w-28", r.done && "text-fg-meta")}>{itemName(data, r.item)}</span>
              {r.done ? (
                <span className="flex flex-1 items-center gap-1 text-fg-muted">
                  <Check aria-hidden className="size-3" /> enough for the whole flow
                </span>
              ) : (
                <>
                  <Bar value={r.have} max={r.target} label={itemName(data, r.item)} />
                  <span className="w-16 shrink-0 text-right tabular-nums text-fg-body">
                    {n(r.have)}/{n(r.target)}
                  </span>
                </>
              )}
            </div>
            {r.need && (
              <p className="pl-6 text-meta text-fg-meta">
                Whole flow: {n(r.need.covered)} of ~{n(r.need.total)} covered
                {r.need.remaining > 0 ? ` · ${n(r.need.remaining)} still to make` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>
      {footnote}
    </div>
  );
};
