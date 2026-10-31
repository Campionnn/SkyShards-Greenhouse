import { useCallback, useSyncExternalStore } from "react";

/** Whether a media query matches (false on the server and in SSR tests). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  );
}

/** The ranking's phone layout: under the `md` breakpoint (768px). */
export const PHONE_QUERY = "(max-width: 767px)";
