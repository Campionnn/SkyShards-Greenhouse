import React, { useMemo } from "react";
import { useDesigner, useGreenhouseData } from "../../context";
import type { DesignerPlacement } from "../../context/DesignerContext";
import { focusKey } from "../../hooks/usePlacementFocus";
import { getRarityTextColor } from "../../utilities";
import { CropImage } from "../shared";
import { FindOnGridHint } from "../grid/FindOnGridHint";
import { focusItemClass } from "../grid/placementStyles";

interface CropCount {
  cropId: string;
  name: string;
  rarity: string;
  count: number;
}

function countCrops(placements: DesignerPlacement[], rarityOf: (id: string) => string | undefined): CropCount[] {
  const counts = new Map<string, CropCount>();
  for (const p of placements) {
    const existing = counts.get(p.cropId);
    if (existing) existing.count++;
    else counts.set(p.cropId, { cropId: p.cropId, name: p.cropName, rarity: rarityOf(p.cropId) || "common", count: 1 });
  }
  return [...counts.values()];
}

/**
 * Target mutations, input crops and total cells of the current Designer layout (shown under the
 * grid). Hovering or clicking an entry finds it on the grid.
 */
export const LayoutCropSummary: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { inputPlacements, targetPlacements, placementFocus: focus } = useDesigner();
  const { getMutationDef } = useGreenhouseData();

  const targets = useMemo(() => countCrops(targetPlacements, (id) => getMutationDef(id)?.rarity), [targetPlacements, getMutationDef]);
  const inputs = useMemo(() => countCrops(inputPlacements, (id) => getMutationDef(id)?.rarity), [inputPlacements, getMutationDef]);
  const totalCells = useMemo(
    () => [...inputPlacements, ...targetPlacements].reduce((sum, p) => sum + p.size * p.size, 0),
    [inputPlacements, targetPlacements],
  );

  if (targets.length === 0 && inputs.length === 0) return null;

  const hint = <FindOnGridHint pinned={focus.pinned !== null} />;

  return (
    <div className={className}>
      {targets.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Target Mutations</h4>
            {hint}
          </div>
          <div className="space-y-2">
            {targets.map(({ cropId, name, rarity, count }) => {
              const key = focusKey("target", cropId);
              return (
                <div
                  key={cropId}
                  {...focus.itemProps(key, name)}
                  className={`flex items-center justify-between bg-slate-700/30 rounded-md px-3 py-2 ${focusItemClass(focus, key)}`}
                >
                  <div className="flex items-center gap-2">
                    <CropImage cropId={cropId} cropName={name} size="xs" showFallback={false} />
                    <span className={`text-sm ${getRarityTextColor(rarity)}`}>{name}</span>
                  </div>
                  <span className="text-sm font-medium text-emerald-400">x{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {inputs.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Input Crops</h4>
            {targets.length === 0 && hint}
          </div>
          <div className="flex flex-wrap gap-2">
            {inputs.map(({ cropId, name, count }) => {
              const key = focusKey("input", cropId);
              return (
                <div
                  key={cropId}
                  {...focus.itemProps(key, name)}
                  className={`flex items-center gap-2 bg-slate-700/30 rounded-md px-2 py-1 ${focusItemClass(focus, key)}`}
                >
                  <CropImage cropId={cropId} cropName={name} size="xs" showFallback={false} />
                  <span className="text-xs text-slate-300">{name}</span>
                  <span className="text-xs text-slate-500">x{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-slate-700/30 rounded-md px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">Total Cells Used:</span>
          <span className="text-sm font-medium text-emerald-400">{totalCells}</span>
        </div>
      </div>
    </div>
  );
};
