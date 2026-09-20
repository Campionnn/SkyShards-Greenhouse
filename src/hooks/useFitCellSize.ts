import { useLayoutEffect, useState, type RefObject } from "react";
import { GRID_SIZE } from "../constants";

export interface FitCellSize {
  cellSize: number;
  gap: number;
}

/**
 * Size grid cells to the width of a container so a full 10x10 grid always
 * fits without a horizontal scrollbar. Re-measures on resize.
 */
export function useFitCellSize(
  containerRef: RefObject<HTMLElement | null>,
  { max = 48, min = 22, cells = GRID_SIZE }: { max?: number; min?: number; cells?: number } = {}
): FitCellSize {
  const [size, setSize] = useState<FitCellSize>({ cellSize: max, gap: 2 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const width = el.clientWidth;
      if (!width) return;
      const gap = width < 420 ? 1 : 2;
      const raw = Math.floor((width - (cells - 1) * gap) / cells);
      const cellSize = Math.max(min, Math.min(max, raw));
      setSize((prev) => (prev.cellSize === cellSize && prev.gap === gap ? prev : { cellSize, gap }));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef, max, min, cells]);

  return size;
}
