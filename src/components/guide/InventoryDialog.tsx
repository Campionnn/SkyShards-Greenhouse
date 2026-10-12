/**
 * "What you own": the inventory, grouped (supplies, goal, then by rarity) with icons.
 *
 * Only the items the flow can use are listed. The Guide subtracts placements when a plot is
 * confirmed but never adds harvests, so this is where the player enters what they got.
 */
import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { ALOE_FRAGMENT, GROUP_LABELS, groupedItems, itemName, type Catalog } from "../../guide";
import { CropImage } from "../shared/CropImage";
import { Dialog, NumberField } from "./primitives";
import { buttonClass } from "./format";

export const InventoryDialog: React.FC<{
  open: boolean;
  inventory: Record<string, number>;
  catalog: Catalog;
  data: GameData;
  onChange: (item: string, amount: number) => void;
  onClose: () => void;
}> = ({ open, inventory, catalog, data, onChange, onClose }) => {
  const [query, setQuery] = useState("");
  const [onlyOwned, setOnlyOwned] = useState(false);
  const groups = useMemo(() => groupedItems(data, catalog), [data, catalog]);
  const q = query.trim().toLowerCase();
  const goal = new Map(catalog.goal.map((g) => [g.item, g.count]));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="What you own"
      footer={
        <div className="flex justify-end">
          <button type="button" className={buttonClass.primary} onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-slate-400">
        Enter what's in your inventory (sacks included). When you confirm a plot the Guide takes off what it placed, but harvests are random, so add those here yourself.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an item"
            aria-label="Find an item"
            className="w-full rounded-md border border-slate-600 bg-slate-950 py-1.5 pl-8 pr-2 text-slate-100 placeholder:text-slate-600 focus:border-violet-400 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          <input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Only what I have
        </label>
      </div>
      <div className="space-y-5">
        {groups.map(({ group, items }) => {
          const shown = items.filter((id) => (!q || itemName(data, id).toLowerCase().includes(q)) && (!onlyOwned || (inventory[id] ?? 0) > 0));
          if (!shown.length) return null;
          return (
            <section key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{GROUP_LABELS[group]}</h3>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((id) => {
                  const have = inventory[id] ?? 0;
                  const need = goal.get(id);
                  return (
                    <li key={id} className={`flex items-center gap-2 rounded-md border px-2 py-1 ${have > 0 ? "border-slate-600 bg-slate-800/70" : "border-slate-800 bg-slate-900/40"}`}>
                      <CropImage cropId={id} cropName={itemName(data, id)} width={22} height={22} showFallback={false} />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                        {itemName(data, id)}
                        {need !== undefined && <span className={`ml-1 text-[11px] ${have >= need ? "text-emerald-300" : "text-slate-500"}`}>goal {need}</span>}
                        {id === ALOE_FRAGMENT && <span className="ml-1 text-[11px] text-slate-500">9 = 1 Aloe</span>}
                      </span>
                      <NumberField label={itemName(data, id)} value={have} onChange={(v) => onChange(id, v)} />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
};
