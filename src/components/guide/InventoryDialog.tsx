/**
 * "What you own": the inventory, grouped (supplies, goal, then by rarity) with icons.
 *
 * Two modes, opened by the page's two buttons ("Add a harvest", "Edit totals"):
 * - **Add a harvest**: type what you just got. It is added to your stock when you press Add or
 *   close, with the items your plots grow listed first.
 * - **Edit totals**: the absolute amounts. A first entry ("Enter what you own") is always this,
 *   without the mode switch.
 * The Guide subtracts placements when a plot is confirmed but never adds random harvests.
 */
import React, { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { ALOE_FRAGMENT, GROUP_LABELS, groupedItems, itemName, type Catalog } from "../../guide";
import { CropImage } from "../shared/CropImage";
import { SegmentedControl } from "../ui/Panel";
import { Dialog, NumberField } from "./primitives";
import { buttonClass, inputClass } from "./format";

export type InventoryMode = "add" | "set";
type Mode = InventoryMode;

export const InventoryDialog: React.FC<{
  open: boolean;
  /** Which mode to open in; by default "add" once you own something, else "set". */
  mode?: InventoryMode;
  inventory: Record<string, number>;
  catalog: Catalog;
  data: GameData;
  /** Items the plots currently grow: listed first in "Add a harvest". */
  harvestable: string[];
  onChange: (item: string, amount: number) => void;
  onClose: () => void;
}> = (props) => (props.open ? <InventoryBody {...props} /> : null);

const InventoryBody: React.FC<React.ComponentProps<typeof InventoryDialog>> = ({ open, mode: initialMode, inventory, catalog, data, harvestable, onChange, onClose }) => {
  // Read once when the dialog opens: the title must not flip from "Enter" to "Edit" while typing.
  const [owns] = useState(() => Object.values(inventory).some((n) => n > 0));
  const [mode, setMode] = useState<Mode>(initialMode ?? (owns ? "add" : "set"));
  const [query, setQuery] = useState("");
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [adds, setAdds] = useState<Record<string, number>>({});
  const groups = useMemo(() => groupedItems(data, catalog), [data, catalog]);
  const q = query.trim().toLowerCase();
  const goal = new Map(catalog.goal.map((g) => [g.item, g.count]));
  const pending = Object.entries(adds).filter(([, n]) => n > 0);
  const growing = [...new Set(harvestable)].filter((id) => catalog.items.includes(id));

  const applyAdds = () => {
    for (const [item, n] of pending) onChange(item, (inventory[item] ?? 0) + n);
    setAdds({});
  };
  const close = () => {
    // Never silently drop typed harvests.
    if (pending.length) applyAdds();
    onClose();
  };

  const row = (id: string) => {
    const have = inventory[id] ?? 0;
    const need = goal.get(id);
    return (
      <li key={id} className={`flex items-center gap-2 rounded-md border px-2 py-1 ${have > 0 || (adds[id] ?? 0) > 0 ? "border-slate-600/40 bg-slate-800/60" : "border-slate-700/40 bg-slate-800/20"}`}>
        <CropImage cropId={id} cropName={itemName(data, id)} width={22} height={22} showFallback={false} />
        <span className="min-w-0 flex-1 text-sm text-slate-200">
          <span className="block truncate">{itemName(data, id)}</span>
          {(mode === "add" || need !== undefined || id === ALOE_FRAGMENT) && (
            <span className="block text-[11px] text-slate-400">
              {mode === "add" && `have ${have.toLocaleString("en-US")}`}
              {need !== undefined && <span className={have >= need ? "text-emerald-300" : ""}>{mode === "add" ? " · " : ""}goal {need}</span>}
              {id === ALOE_FRAGMENT && " · 9 = 1 Aloe"}
            </span>
          )}
        </span>
        {mode === "add" ? (
          <span className="flex items-center gap-1 text-slate-300">
            +
            <NumberField label={`${itemName(data, id)} harvested`} value={adds[id] ?? 0} integer live onChange={(v) => setAdds((a) => ({ ...a, [id]: v }))} />
          </span>
        ) : (
          <NumberField label={itemName(data, id)} value={have} integer live onChange={(v) => onChange(id, v)} />
        )}
      </li>
    );
  };

  const matches = (id: string) => (!q || itemName(data, id).toLowerCase().includes(q)) && (!onlyOwned || (inventory[id] ?? 0) > 0);
  const total = pending.reduce((n, [, v]) => n + v, 0);

  return (
    <Dialog
      open={open}
      onClose={close}
      title={mode === "add" ? "Add a harvest" : owns ? "Edit what you own" : "Enter what you own"}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {mode === "add" && pending.length > 0 && (
            <button type="button" className={buttonClass.secondary} onClick={applyAdds}>
              <Plus className="h-4 w-4" /> Add {total.toLocaleString("en-US")} item{total === 1 ? "" : "s"}
            </button>
          )}
          <button type="button" className={buttonClass.primary} onClick={close}>
            {mode === "add" && pending.length > 0 ? "Add and close" : "Done"}
          </button>
        </div>
      }
    >
      {/* A first entry is always totals; after that you can switch, same labels as the page's buttons. */}
      {owns && (
        <SegmentedControl<Mode>
          size="xs"
          className="mb-3 max-w-sm"
          value={mode}
          onChange={(m) => {
            if (m === "set" && pending.length) applyAdds();
            setMode(m);
          }}
          options={[
            { value: "add", label: "Add a harvest" },
            { value: "set", label: "Edit totals" },
          ]}
        />
      )}
      <p className="mb-3 text-xs text-slate-400">
        {mode === "add"
          ? "Type what you just harvested; it's added to what you already have. Confirming a plot already took off what it placed."
          : owns
            ? "Correct the totals in your inventory (sacks included)."
            : "Enter the totals in your inventory (sacks included): the Dead Plants and Fermento you've farmed, and any mutations you already have. Leave the rest at 0."}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an item"
            aria-label="Find an item"
            className={`${inputClass} w-full py-1.5 pl-8 pr-2`}
          />
        </label>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} className="accent-emerald-500" />
          Only what I have
        </label>
      </div>
      <div className="space-y-5">
        {mode === "add" && growing.some(matches) && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-400">Your plots grow these</h3>
            <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{growing.filter(matches).map(row)}</ul>
          </section>
        )}
        {groups.map(({ group, items }) => {
          const shown = items.filter((id) => matches(id) && !(mode === "add" && growing.includes(id)));
          if (!shown.length) return null;
          return (
            <section key={group}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{GROUP_LABELS[group]}</h3>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{shown.map(row)}</ul>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
};
