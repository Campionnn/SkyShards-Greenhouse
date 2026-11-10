import React from "react";
import { FolderOpen } from "lucide-react";
import { KitButton } from "../../ui/kit";
import type { GridGeometry } from "./GridStage";

/**
 * Over an empty grid (nothing placed or picked): the two ways to start. It lets clicks through except on
 * its buttons, and sits outside `[data-grid-container]`, so the grid renders and exports as usual.
 */
export const StartCard: React.FC<{
  geo: GridGeometry;
  /** "in the palette" (desktop) / "below" (phone). */
  where: string;
  onLoad: () => void;
  lastCalculator: { name: string } | null;
  onLastCalculator: () => void;
}> = ({ geo, where, onLoad, lastCalculator, onLastCalculator }) => (
  <div className="pointer-events-none absolute z-(--z-sticky) grid place-items-center p-4" style={{ left: geo.x, top: geo.y, width: geo.size, height: geo.size }}>
    <div className="w-full max-w-80 rounded-container border border-line bg-surface-page/85 p-4 text-center">
      <p className="text-body text-fg-body">Pick an item {where}, then click the grid.</p>
      <p className="mt-1 text-secondary text-fg-meta">Or start from a layout:</p>
      <div className="pointer-events-auto mt-3 flex flex-wrap justify-center gap-2">
        <KitButton onClick={onLoad}>
          <FolderOpen /> Load a layout
        </KitButton>
        {lastCalculator && (
          <KitButton onClick={onLastCalculator} title={lastCalculator.name}>
            Last Calculator result
          </KitButton>
        )}
      </div>
    </div>
  </div>
);
