import React, { useMemo } from "react";
import { useDesigner } from "../../context";
import type { DesignerPlacement } from "../../context";
import { focusKey } from "../../hooks/usePlacementFocus";
import { CropImage } from "../shared";
import { FindOnGridHint } from "../grid/FindOnGridHint";
import { focusItemClass } from "../grid/placementStyles";
import { cn } from "../ui/cn";

interface CropCount {
  cropId: string;
  name: string;
  count: number;
}

/** Placements per crop, most first. */
function countCrops(placements: DesignerPlacement[]): CropCount[] {
  const counts = new Map<string, CropCount>();
  for (const p of placements) {
    const existing = counts.get(p.cropId);
    if (existing) existing.count++;
    else counts.set(p.cropId, { cropId: p.cropId, name: p.cropName, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * Under the grid (D52–D55): the Targets and Inputs as chips (icon, name, ×N), then Cells used (inputs and
 * targets; ground doesn't count). Every chip finds its placements on the grid: hover previews, a click pins
 * it (Escape or a click elsewhere lets go). Names are neutral, not rarity-coloured, so an invalid target
 * never reads as fine; validity lives in Check. The totals are on the palette's Inputs | Targets switch.
 * Nothing renders on an empty layout.
 */
export const LayoutCropSummary: React.FC<{ className?: string }> = ({ className }) => {
  const { inputPlacements, targetPlacements, placementFocus: focus } = useDesigner();
  const targets = useMemo(() => countCrops(targetPlacements), [targetPlacements]);
  const inputs = useMemo(() => countCrops(inputPlacements), [inputPlacements]);
  const cells = useMemo(() => [...inputPlacements, ...targetPlacements].reduce((sum, p) => sum + p.size * p.size, 0), [inputPlacements, targetPlacements]);
  if (!targets.length && !inputs.length) return null;

  const chips = (list: CropCount[], kind: "input" | "target") =>
    list.map(({ cropId, name, count }) => {
      const key = focusKey(kind, cropId);
      return (
        <span
          key={cropId}
          {...focus.itemProps(key, name)}
          className={cn("inline-flex h-7 min-w-0 items-center gap-1.5 rounded-control border border-line bg-surface-card pr-2 pl-1 text-secondary pointer-coarse:h-11", focusItemClass(focus, key))}
        >
          <CropImage cropId={cropId} cropName={name} size="custom" width={18} height={18} showFallback className="shrink-0" />
          <span className="min-w-0 truncate text-fg-body">{name}</span>
          <span className="tabular-nums text-fg-meta">×{count}</span>
        </span>
      );
    });
  const row = (label: string, body: React.ReactNode) => (
    <div className="flex min-w-0 items-start gap-3">
      {/* h2: the summary sits right under the page's h1 (Check's h2 is hidden on the phone sheet). */}
      <h2 className="flex h-7 w-20 shrink-0 items-center text-secondary font-normal text-fg-muted pointer-coarse:h-11">{label}</h2>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">{body}</div>
    </div>
  );

  return (
    <section aria-label="Summary" className={cn("min-w-0 space-y-1.5", className)}>
      {targets.length > 0 && row("Targets", chips(targets, "target"))}
      {inputs.length > 0 && row("Inputs", chips(inputs, "input"))}
      <div className="flex min-w-0 items-center gap-3 text-secondary">
        <span className="w-20 shrink-0 text-fg-muted">Cells used</span>
        <span className="tabular-nums text-fg-body">{cells}</span>
        <FindOnGridHint pinned={focus.pinned !== null} className="ml-auto truncate" />
      </div>
    </section>
  );
};
