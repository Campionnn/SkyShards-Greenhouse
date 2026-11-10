import React, { useLayoutEffect, useRef, useState } from "react";
import { useFitCellSize } from "../../../hooks";
import { cn } from "../../ui/cn";
import { DesignerGrid, type DesignerGridHandle } from "../DesignerGrid";

/** Where the grid sits inside the stage, for overlays drawn outside `[data-grid-container]`. */
export interface GridGeometry {
  /** Offset of the grid inside the stage, px. */
  x: number;
  y: number;
  cellSize: number;
  gap: number;
  /** Grid width (= height), px. */
  size: number;
}

/**
 * The real DesignerGrid fit to the column (and capped by the window height), the row above it and the
 * summary below it at the grid's own width, and `overlay`s positioned over it. Overlays (the Check ring,
 * the empty-layout card) are siblings of `[data-grid-container]`, so the PNG / GIF export and the share
 * image never see them.
 */
export const GridStage: React.FC<{
  /** The grid's handle (the page's export and share hooks); optional elsewhere (LayoutWorkspace). */
  gridRef?: React.Ref<DesignerGridHandle>;
  maxCell: number;
  /** Viewport height reserved for everything else on screen (undefined: width only). */
  heightReserve?: number;
  showInputs: boolean;
  showTargets: boolean;
  above?: React.ReactNode;
  below?: React.ReactNode;
  overlay?: (geo: GridGeometry) => React.ReactNode;
  className?: string;
}> = ({ gridRef, maxCell, heightReserve, showInputs, showTargets, above, below, overlay, className }) => {
  const fitRef = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const { cellSize, gap } = useFitCellSize(fitRef, { max: maxCell, heightReserve });
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const box = stage.current;
    const el = box?.querySelector<HTMLElement>("[data-grid-container]");
    if (!box || !el) return;
    const update = () => {
      const a = box.getBoundingClientRect();
      const g = el.getBoundingClientRect();
      const next = { x: Math.round(g.left - a.left), y: Math.round(g.top - a.top) };
      setOffset((p) => (p && p.x === next.x && p.y === next.y ? p : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const size = cellSize * 10 + gap * 9;
  const band = { width: size, maxWidth: "100%" };
  return (
    <div ref={stage} className={cn("relative min-w-0", className)}>
      {above && (
        <div className="mx-auto mb-2 min-w-0" style={band}>
          {above}
        </div>
      )}
      <div ref={fitRef} className="flex w-full min-w-0 flex-col items-center">
        <DesignerGrid ref={gridRef} cellSize={cellSize} gap={gap} showInputs={showInputs} showTargets={showTargets} hint={false} />
      </div>
      {below && (
        <div className="mx-auto min-w-0" style={band}>
          {below}
        </div>
      )}
      {offset && overlay?.({ x: offset.x, y: offset.y, cellSize, gap, size })}
    </div>
  );
};
