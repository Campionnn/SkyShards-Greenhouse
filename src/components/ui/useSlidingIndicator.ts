import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type React from "react";

/**
 * The sliding indicator under Segmented and Tabs. It is positioned by `translateX` and sized by
 * `width` with no transition; a change of selection animates with a transform only (FLIP:
 * translateX + scaleX from the old box to the new one, origin left). A click mid-slide starts from
 * where the indicator is, and a resize repositions it without animating.
 */
export function useSlidingIndicator<B extends HTMLElement = HTMLDivElement>(selector: string, inset: number, deps: React.DependencyList) {
  const box = useRef<B>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<{ x: number; w: number } | null>(null);
  const shown = useRef<{ x: number; w: number } | null>(null);
  const instant = useRef(false);

  /** `jump`: a layout change (resize), not a new selection: move without animating. */
  const measure = useCallback(
    (jump = false) => {
      const el = box.current?.querySelector<HTMLElement>(selector);
      const next = el ? { x: el.offsetLeft + inset, w: Math.max(0, el.offsetWidth - inset * 2) } : null;
      const cur = shown.current;
      if (cur && next && cur.x === next.x && cur.w === next.w) return;
      if (jump) instant.current = true;
      setRect(next);
    },
    [selector, inset],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => measure(), deps);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure(true));
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    const b = bar.current;
    const from = shown.current;
    shown.current = rect;
    const skip = instant.current;
    instant.current = false;
    if (!b || !rect || !from || skip || (from.x === rect.x && from.w === rect.w) || typeof b.animate !== "function") return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Interrupted mid-slide: start from where the indicator is now, not where it was headed.
    let fx = from.x;
    let fw = from.w;
    const running = b.getAnimations();
    if (running.length) {
      const m = new DOMMatrixReadOnly(getComputedStyle(b).transform);
      fx = m.m41;
      // The scale is relative to the width the bar had before this commit (from.w).
      fw = from.w * m.m11;
      running.forEach((a) => a.cancel());
    }
    if (!rect.w) return;
    b.animate([{ transform: `translateX(${fx}px) scaleX(${fw / rect.w})` }, { transform: `translateX(${rect.x}px) scaleX(1)` }], {
      duration: 200,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
  }, [rect]);

  const style: React.CSSProperties | undefined = rect ? { width: rect.w, transform: `translateX(${rect.x}px)`, transformOrigin: "left" } : undefined;
  return { box, bar, style };
}
