import { useEffect, useState, useSyncExternalStore } from "react";

/** Phone layout below 768px (patterns.md "Phones"); the server render is the desktop one. */
const PHONE = "(max-width: 767px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

/** `Date.now()` that ticks every minute (the price age stays current). */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/**
 * While mounted, the page scrolls focused controls clear of the sticky tab bar (top) and the
 * phone's bottom action bar, so keyboard focus is never hidden under them.
 */
export function useScrollPadding(top: number, bottom: number) {
  useEffect(() => {
    const s = document.documentElement.style;
    const before = [s.scrollPaddingTop, s.scrollPaddingBottom];
    s.scrollPaddingTop = `${top}px`;
    s.scrollPaddingBottom = `${bottom}px`;
    return () => {
      [s.scrollPaddingTop, s.scrollPaddingBottom] = before;
    };
  }, [top, bottom]);
}
