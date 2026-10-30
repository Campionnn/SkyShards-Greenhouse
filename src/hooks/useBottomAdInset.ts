import { useEffect } from "react";

// Mediavine's adhesion ad (and the outstream video player above it) live in one fixed container
// at the bottom of the viewport, `#fixed_container_bottom`, which their script appends to <body>
// at a z-index nothing of ours can beat (and must not: covering an ad is a policy violation).
// This keeps `--ad-bottom` on <html> equal to how much of the viewport bottom that container's
// visible content covers, so fixed bottom UI (the simulator's phone run bar, full-screen editors)
// can sit just above it. 0 when there is no ad (ad blocker, not filled, closed, local dev).

const CONTAINER_ID = "fixed_container_bottom";
const VAR = "--ad-bottom";

/** Pixels of the viewport bottom covered by visible ad content. */
export function measureBottomAdInset(doc: Document = document): number {
  const root = doc.getElementById(CONTAINER_ID);
  if (!root) return 0;
  const vh = doc.defaultView?.innerHeight ?? 0;
  let top = vh;
  for (const el of Array.from(root.children)) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    // Empty placeholders and anything off screen don't cover the bar.
    if (r.width < 8 || r.height < 8 || r.top >= vh || r.bottom <= 0) continue;
    top = Math.min(top, r.top);
  }
  // Never more than half the screen: a runaway measurement must not push controls off the top.
  return Math.max(0, Math.min(Math.round(vh - top), Math.round(vh / 2)));
}

/** Keeps `--ad-bottom` on <html> in sync with the bottom ad. Mount once (the site Layout). */
export function useBottomAdInset(): void {
  useEffect(() => {
    const html = document.documentElement;
    let frame = 0;
    let last = -1;
    const update = () => {
      frame = 0;
      const px = measureBottomAdInset();
      if (px === last) return;
      last = px;
      html.style.setProperty(VAR, `${px}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    const inner = new MutationObserver(() => {
      watchChildren();
      schedule();
    });
    let watched: HTMLElement | null = null;
    const watchChildren = () => {
      if (!watched || !resize) return;
      resize.disconnect();
      for (const c of Array.from(watched.children)) resize.observe(c);
    };
    const attach = () => {
      const root = document.getElementById(CONTAINER_ID);
      if (root === watched) return;
      inner.disconnect();
      watched = root;
      if (root) {
        // Slots fill, re-auction, hide (attribute) and animate in: watch all of it.
        inner.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "data-slot-wrapper-hidden"] });
        root.addEventListener("transitionend", schedule);
        watchChildren();
      }
      schedule();
    };
    // The container is created late, as a direct child of <body>.
    const outer = new MutationObserver(attach);
    outer.observe(document.body, { childList: true });
    attach();
    window.addEventListener("resize", schedule);

    return () => {
      outer.disconnect();
      inner.disconnect();
      resize?.disconnect();
      watched?.removeEventListener("transitionend", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      html.style.removeProperty(VAR);
    };
  }, []);
}
