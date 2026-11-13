/**
 * "What you own": the inventory, grouped (supplies, goal, then by rarity) with icons.
 *
 * Two modes, opened by the page's two buttons ("Add harvest", "Edit"):
 * - **Add harvest**: type what you just got. It is added to your stock when you press Add or close,
 *   with the items your plots grow listed first.
 * - **Edit totals**: the absolute amounts. A first entry ("Enter what you own") is always this,
 *   without the mode switch.
 * The Guide subtracts placements when a plot is confirmed but never adds random harvests.
 */
import React, { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { ALOE_FRAGMENT, GROUP_LABELS, groupedItems, itemName, type Catalog } from "../../guide";
import { CropImage } from "../shared/CropImage";
import { cn } from "../ui/cn";
import { DialogFrame, ModalDialog } from "../ui/ModalDialog";
import { KitButton, KitInput, KitLabel, Segmented, Switch } from "../ui/kit";
import { NumberField } from "./primitives";

export type InventoryMode = "add" | "set";
type Mode = InventoryMode;

export const InventoryDialog: React.FC<{
  open: boolean;
  /** Which mode to open in; by default "add" once you own something, else "set". */
  mode?: InventoryMode;
  inventory: Record<string, number>;
  catalog: Catalog;
  data: GameData;
  /** Items the plots currently grow: listed first in "Add harvest". */
  harvestable: string[];
  onChange: (item: string, amount: number) => void;
  onClose: () => void;
}> = (props) => (props.open ? <InventoryBody {...props} /> : null);

const InventoryBody: React.FC<React.ComponentProps<typeof InventoryDialog>> = ({ mode: initialMode, inventory, catalog, data, harvestable, onChange, onClose }) => {
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
      <li key={id} className={cn("flex items-center gap-2 rounded-control border px-2 py-1", have > 0 || (adds[id] ?? 0) > 0 ? "border-line-strong bg-surface-card" : "border-line")}>
        <CropImage cropId={id} cropName={itemName(data, id)} width={22} height={22} showFallback={false} />
        <span className="min-w-0 flex-1 text-body text-fg-body">
          <span className="block truncate">{itemName(data, id)}</span>
          {(mode === "add" || need !== undefined || id === ALOE_FRAGMENT) && (
            <span className="block text-meta text-fg-meta">
              {mode === "add" && `have ${have.toLocaleString("en-US")}`}
              {need !== undefined && <span className={have >= need ? "text-fg-body" : ""}>{mode === "add" ? " · " : ""}goal {need}</span>}
              {id === ALOE_FRAGMENT && " · 9 = 1 Aloe"}
            </span>
          )}
        </span>
        {mode === "add" ? (
          <span className="flex items-center gap-1 text-fg-muted">
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
  const title = mode === "add" ? "Add harvest" : owns ? "Edit what you own" : "Enter what you own";

  return (
    <ModalDialog labelledBy="guide-inventory-title" onClose={close} maxWidth="max-w-4xl">
      <DialogFrame
        id="guide-inventory-title"
        title={title}
        onClose={close}
        footer={
          <>
            {mode === "add" && pending.length > 0 && (
              <KitButton size="md" onClick={applyAdds}>
                <Plus /> Add {total.toLocaleString("en-US")} item{total === 1 ? "" : "s"}
              </KitButton>
            )}
            <KitButton variant="primary" size="md" onClick={close}>
              {mode === "add" && pending.length > 0 ? "Add and close" : "Done"}
            </KitButton>
          </>
        }
      >
        {/* A first entry is always totals; after that you can switch, same labels as the page's buttons. */}
        {owns && (
          <Segmented<Mode>
            label="Mode"
            value={mode}
            onChange={(m) => {
              if (m === "set" && pending.length) applyAdds();
              setMode(m);
            }}
            options={[
              { value: "add", label: "Add harvest" },
              { value: "set", label: "Edit totals" },
            ]}
          />
        )}
        <p className="text-secondary text-fg-muted">
          {mode === "add"
            ? "Type what you just harvested; it's added to what you already have. Confirming a plot already took off what it placed."
            : owns
              ? "Correct the totals in your inventory (sacks included)."
              : "Enter the totals in your inventory (sacks included): the Dead Plants and Fermento you've farmed, and any mutations you already have. Leave the rest at 0."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-meta" />
            <KitInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an item" aria-label="Find an item" className="w-full pl-8" />
          </label>
          <Switch checked={onlyOwned} onChange={setOnlyOwned} label="Only what I have" showLabel />
        </div>
        <div className="space-y-5">
          {mode === "add" && growing.some(matches) && (
            <section className="space-y-2">
              <KitLabel>Your plots grow these</KitLabel>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{growing.filter(matches).map(row)}</ul>
            </section>
          )}
          {groups.map(({ group, items }) => {
            const shown = items.filter((id) => matches(id) && !(mode === "add" && growing.includes(id)));
            if (!shown.length) return null;
            return (
              <section key={group} className="space-y-2">
                <KitLabel>{GROUP_LABELS[group]}</KitLabel>
                <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">{shown.map(row)}</ul>
              </section>
            );
          })}
        </div>
      </DialogFrame>
    </ModalDialog>
  );
};
