import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * The Designer page's desktop columns, picked from the page's own width (the site puts ad gutters
 * around it, so the window width says little). Palette tiles are at least 68px wide, the narrowest
 * that fits the longest one-word names ("Witherbloom", 67px at 11px Inter) without hyphenating them.
 * - 1920 (content 1456): 240 · grid 778 · 380 (5 tile columns).
 * - 1200×900 (1168): 208 · grid 618 · 300 (4).
 * - 1024 (992): 236 · grid 488 (height-capped) · 240 (3).
 * - 1366 (902): 168 · grid 488 (height-capped) · 230 (3).
 * - Under 880 (1280×800: 816): 160 · grid 478 · 170 (2 columns of 78px tiles). Three columns left the
 *   grid 399px there, smaller than at 1024.
 */
export interface DesignerFrame {
  left: number;
  right: number;
  gap: number;
  /** Largest cell size of the grid. */
  maxCell: number;
  /** The tight frame (content under 880px): slimmer rail padding. */
  narrow: boolean;
}

export function frameFor(width: number, touch = false): DesignerFrame {
  const f =
    width >= 1360
      ? { left: 240, right: 380, gap: 12, maxCell: 76, narrow: false }
      : width >= 1100
        ? { left: 208, right: 300, gap: 12, maxCell: 72, narrow: false }
        : width >= 940
          ? { left: 236, right: 240, gap: 8, maxCell: 64, narrow: false }
          : width >= 880
            ? { left: 168, right: 230, gap: 8, maxCell: 64, narrow: false }
            : { left: 160, right: 170, gap: 4, maxCell: 64, narrow: true };
  // Tablets (a coarse pointer on the desktop frame): the left rail fits four 44px Transform segments
  // and two 44px-tall buttons per row.
  if (touch && f.left < 204) return { ...f, left: 204, narrow: false };
  return f;
}

/** A touch screen (coarse primary pointer). */
export const COARSE_QUERY = "(pointer: coarse)";

/**
 * What the grid leaves of the window height on desktop: the site nav, the 100px ad slot, the page
 * header and the row above the grid. With it the whole grid is above the fold on first load
 * (1366×768: 488px, bottom ≈753).
 */
export const GRID_HEIGHT_RESERVE = 280;

/** Below this viewport width the page uses the phone layout (top toolbar, bottom sheet). */
export const PHONE_QUERY = "(max-width: 767px)";

/** The element's width, kept up to date (0 until measured). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** A media query as state. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const update = () => setOn(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return on;
}

/**
 * Keeps `inner` (a sticky child of `outer`) as tall as the visible part of `outer`'s column, so a rail
 * never runs below the fold and scrolls on its own. Written to the DOM, so scrolling doesn't re-render.
 * `prop` "height" makes the rail exactly that tall (a fill layout inside); "maxHeight" lets it be shorter.
 */
export function useFillViewport(outer: RefObject<HTMLElement | null>, inner: RefObject<HTMLElement | null>, prop: "height" | "maxHeight" = "height", gap = 16, min = 320) {
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
      i.style[prop] = `${Math.max(min, Math.round(bottom - top))}px`;
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
      i.style[prop] = "";
    };
  }, [outer, inner, prop, gap, min]);
}
