/** "Which farm is Plot N on?": every farm the plot's flow can build, as pictures. */
import React from "react";
import { Check } from "lucide-react";
import type { GameData } from "../../simulator/data/types";
import { itemName, type Catalog } from "../../guide";
import { FarmPicture } from "./FarmPicture";
import { Dialog } from "./primitives";

export const FarmGallery: React.FC<{
  open: boolean;
  plotId: number;
  current: string;
  catalog: Catalog;
  data: GameData;
  onPick: (farm: string) => void;
  onClose: () => void;
}> = ({ open, plotId, current, catalog, data, onPick, onClose }) => {
  const farms = (catalog.farms[plotId] ?? []).filter((f) => f.kind === "farm" || f.kind === "hub");
  const name = (id: string) => itemName(data, id);
  return (
    <Dialog open={open} onClose={onClose} title={`Which farm is Plot ${plotId} on?`}>
      <p className="mb-3 text-xs text-slate-400">Pick the layout that matches what's on Plot {plotId} in game. Small differences are fine; just pick the closest one.</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {farms.map((farm) => {
          const selected = farm.id === current;
          return (
            <li key={farm.id}>
              <button
                type="button"
                onClick={() => onPick(farm.id)}
                aria-pressed={selected}
                className={`flex h-full w-full cursor-pointer flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors ${
                  selected ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-600/30 bg-slate-800/40 hover:border-slate-500/60 hover:bg-slate-800/70"
                }`}
              >
                <FarmPicture layout={farm.layout} nameOf={name} cellSize={13} compass={false} tooltips={false} />
                <span className="flex items-start gap-1 text-sm font-medium text-slate-100">
                  {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
                  {farm.name}
                </span>
                <span className="text-[11px] leading-snug text-slate-400">
                  {farm.products.length ? `Grows ${farm.products.map((p) => name(p.item)).join(", ")}` : farm.kind === "hub" ? "Nothing placed" : farm.detail}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
};
