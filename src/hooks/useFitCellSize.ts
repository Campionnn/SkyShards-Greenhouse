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
  {
    max = 48,
    min = 22,
    cells = GRID_SIZE,
    reserve = 0,
    heightReserve,
  }: {
    max?: number;
    min?: number;
    cells?: number;
    /** Pixels of the container width taken by something beside the grid (e.g. padding or a side label). */
    reserve?: number;
    /**
     * Also fit the viewport height: the grid may be at most `window.innerHeight - heightReserve`
     * tall (the reserve is everything else that must stay on screen). Re-measures on window resize.
     */
    heightReserve?: number;
  } = {}
): FitCellSize {
  const [size, setSize] = useState<FitCellSize>({ cellSize: max, gap: 2 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const width = el.clientWidth - reserve;
      if (width <= 0) return;
      const gap = width < 420 ? 1 : 2;
      let raw = Math.floor((width - (cells - 1) * gap) / cells);
      // The height cap never goes below 30px: on a short window the page scrolls rather than shrinking the grid to stamps.
      if (heightReserve !== undefined) raw = Math.min(raw, Math.max(30, Math.floor((window.innerHeight - heightReserve - (cells - 1) * gap) / cells)));
      const cellSize = Math.max(min, Math.min(max, raw));
      setSize((prev) => (prev.cellSize === cellSize && prev.gap === gap ? prev : { cellSize, gap }));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    if (heightReserve !== undefined) window.addEventListener("resize", compute);
    return () => {
      observer.disconnect();
      if (heightReserve !== undefined) window.removeEventListener("resize", compute);
    };
  }, [containerRef, max, min, cells, reserve, heightReserve]);

  return size;
}
