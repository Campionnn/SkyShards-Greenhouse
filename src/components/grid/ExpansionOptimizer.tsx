import React, { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useGridState } from "../../context";
import { optimizeExpansion } from "../../services";
import { cn } from "../ui/cn";
import { KitButton, KitLabel } from "../ui/kit";
import { surface } from "../ui/surface";

export const ExpansionOptimizer: React.FC = () => {
  const { getUnlockedCellsArray, getLockedCellsArray, setExpansionSteps, clearExpansionSteps, expansionSteps } = useGridState();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ totalSteps: number; finalCount: number } | null>(null);

  const handleOptimize = async () => {
    const unlockedCells = getUnlockedCellsArray();
    const lockedCells = getLockedCellsArray();
    if (unlockedCells.length === 0) {
      setError("Please select at least one cell first");
      return;
    }
    if (lockedCells.length === 0) {
      setError("No locked cells to expand to");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await optimizeExpansion({ unlocked_cells: unlockedCells, locked_cells: lockedCells });
      setExpansionSteps(response.steps);
      setResult({ totalSteps: response.total_steps, finalCount: response.final_gloomgourd_count });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to optimize expansion");
      clearExpansionSteps();
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    clearExpansionSteps();
    setResult(null);
    setError(null);
  };

  const hasOverlay = expansionSteps.length > 0;

  return (
    <section className={cn(surface.card, "space-y-3 p-3")}>
      <KitLabel>Expansion optimizer</KitLabel>
      <p className="text-secondary text-fg-muted">Finds the best order to unlock cells for the most Gloomgourd. Click the highlighted cells in order to follow the path.</p>
      <div className="flex gap-2">
        <KitButton variant="accent" size="md" className="flex-1" onClick={handleOptimize} loading={isLoading}>
          Optimize
        </KitButton>
        {hasOverlay && (
          <KitButton size="md" onClick={handleClear}>
            <RotateCcw /> Clear
          </KitButton>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-control border border-problem/30 bg-problem/10 px-3 py-2 text-secondary text-problem">
          {error}
        </p>
      )}
      {result && hasOverlay && <p className="text-secondary text-fg-body">{result.totalSteps} expansion steps</p>}
    </section>
  );
};
