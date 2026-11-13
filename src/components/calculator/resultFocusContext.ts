import { createContext, useContext, useMemo } from "react";
import { focusKey, usePlacementFocus, type PlacementFocus } from "../../hooks";
import type { LockedPlacement, SolveResponse } from "../../types/greenhouse";

/**
 * The "find it on the grid" focus, shared by the result lists (left rail) and the grid
 * (SolverResults) when they are rendered apart. `ResultFocusProvider` (ResultLists.tsx) supplies it.
 */
export const ResultFocusContext = createContext<PlacementFocus | null>(null);

/** The focus from a surrounding ResultFocusProvider, or null. */
export const useSharedResultFocus = (): PlacementFocus | null => useContext(ResultFocusContext);

/** The keys that have a placement on the grid: solver crops, target mutations and locks. */
export function useResultFocus(result: SolveResponse | null, lockedPlacements: LockedPlacement[]): PlacementFocus {
  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const p of result?.placements || []) set.add(focusKey("input", p.crop));
    for (const m of result?.mutations || []) set.add(focusKey("target", m.mutation));
    for (const l of lockedPlacements) set.add(focusKey("input", l.crop));
    return set;
  }, [result, lockedPlacements]);
  return usePlacementFocus(keys);
}
