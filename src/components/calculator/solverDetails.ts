import { useCallback, useEffect, useState } from "react";

/**
 * One remembered "show solver details" preference, shared by the live
 * progress panel and the result summary: players who don't care about the
 * numbers collapse it once and never see them again.
 */
const KEY = "skyshards-solver-details-open";
const EVENT = "skyshards-solver-details-changed";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useSolverDetailsOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(read);

  useEffect(() => {
    const sync = () => setOpen(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const toggle = useCallback(() => {
    const next = !read();
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // not persisted; still toggles for this page
    }
    setOpen(next);
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return [open, toggle];
}
