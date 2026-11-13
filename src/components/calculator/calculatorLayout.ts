import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The Calculator's three layouts:
 * - `phone` (viewport under 768px): stacked.
 * - `mid` (the page content narrower than 69rem): a left rail with Targets | Priorities tabs beside the result.
 * - `wide`: Targets on the left, Priorities & locks on the right.
 * Measured from the page's own width (the site layout puts ad gutters around it), so only one tree renders.
 */
export type CalculatorLayout = "phone" | "mid" | "wide";

const WIDE_REM = 69;

function measure(el: HTMLElement): CalculatorLayout {
  if (window.matchMedia?.("(max-width: 767px)").matches) return "phone";
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return el.clientWidth >= WIDE_REM * rem ? "wide" : "mid";
}

/** The layout for the element in `ref`; null until it has been measured (before the first paint). */
export function useCalculatorLayout(ref: RefObject<HTMLElement | null>): CalculatorLayout | null {
  const [layout, setLayout] = useState<CalculatorLayout | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setLayout(measure(el));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);
  return layout;
}

/**
 * Keeps `inner` (a sticky child of `outer`) exactly as tall as the visible part of `outer`'s column:
 * from max(gap, its top) to min(viewport bottom − gap, the column's bottom). The rail never runs
 * below the fold, and it stays in view while the page scrolls. Written to the DOM, not React state,
 * so scrolling doesn't re-render.
 */
export function useFitToViewport(outer: RefObject<HTMLElement | null>, inner: RefObject<HTMLElement | null>, gap = 16, min = 240) {
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const r = o.getBoundingClientRect();
      const top = Math.max(gap, r.top);
      const bottom = Math.min(window.innerHeight - gap, r.bottom);
      i.style.maxHeight = `${Math.max(min, Math.round(bottom - top))}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    const ro = new ResizeObserver(schedule);
    ro.observe(o);
    ro.observe(document.body); // content above (ads) can move the column
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      i.style.maxHeight = "";
    };
  }, [outer, inner, gap, min]);
}
