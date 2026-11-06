import React from "react";
import { useGreenhouseData, useLockedPlacements } from "../../context";
import { focusKey, type PlacementFocus } from "../../hooks";
import type { SolveResponse } from "../../types/greenhouse";
import { FindOnGridHint, focusItemClass } from "../grid";
import { CropImage } from "../shared";
import { cn } from "../ui/cn";
import { KitLabel } from "../ui/kit";
import { MutationList } from "./ResultSummary";
import { ResultFocusContext, useResultFocus, useSharedResultFocus } from "./resultFocusContext";

/**
 * Shares the "find it on the grid" focus between the result lists and the grid when the page
 * renders them in different places (lists in the left rail, grid in the centre).
 */
export const ResultFocusProvider: React.FC<{ result: SolveResponse | null; children: React.ReactNode }> = ({ result, children }) => {
  const { lockedPlacements } = useLockedPlacements();
  const focus = useResultFocus(result, lockedPlacements);
  return <ResultFocusContext.Provider value={focus}>{children}</ResultFocusContext.Provider>;
};

/** The solve's Mutations and Crops to plant, stacked (fits a ~16rem rail); hover or click finds them on the grid. */
export const ResultLists: React.FC<{ result: SolveResponse | null; className?: string; focus?: PlacementFocus }> = ({ result, className, focus: own }) => {
  const shared = useSharedResultFocus();
  const focus = own ?? shared ?? undefined;
  const { getCropDef, getMutationDef } = useGreenhouseData();
  if (!result) return null;

  const counts = new Map<string, { count: number; locked: number }>();
  for (const p of result.placements || []) {
    const e = counts.get(p.crop) || { count: 0, locked: 0 };
    e.count += 1;
    if (p.locked) e.locked += 1;
    counts.set(p.crop, e);
  }
  const plantedCells = (result.placements || []).reduce((n, p) => n + p.size * p.size, 0);

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)} data-testid="result-lists">
      <section className="min-w-0 space-y-1.5" aria-label="Mutations">
        <KitLabel actions={focus ? <FindOnGridHint pinned={focus.pinned !== null} /> : undefined}>Mutations</KitLabel>
        <MutationList result={result} focus={focus} />
      </section>
      <section className="min-w-0 space-y-1.5" aria-label="Crops to plant">
        <KitLabel actions={<span className="text-meta normal-case tabular-nums text-fg-meta">{plantedCells} cells</span>}>Crops to plant</KitLabel>
        {counts.size === 0 ? (
          <p className="py-1 text-secondary text-fg-meta">No crops placed</p>
        ) : (
          <ul className="space-y-0.5">
            {Array.from(counts.entries()).map(([cropId, { count, locked }]) => {
              const name = getCropDef(cropId)?.name || getMutationDef(cropId)?.name || cropId.replace(/_/g, " ");
              const key = focusKey("input", cropId);
              const item = focus?.itemProps(key, name);
              return (
                <li
                  key={cropId}
                  {...(item ?? {})}
                  className={cn("flex min-w-0 items-center gap-2 rounded-control px-1.5 py-1", focus && focusItemClass(focus, key))}
                  title={item ? (locked ? `${item.title}. ${locked} of these are your locked placements.` : item.title) : name}
                >
                  <CropImage cropId={cropId} cropName={name} size="xs" showFallback={false} />
                  <span className="min-w-0 flex-1 truncate text-body text-fg-body">{name}</span>
                  <span className="shrink-0 text-secondary tabular-nums text-fg-meta">
                    ×{count}
                    {locked > 0 && <span> · {locked} locked</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
