import { useCallback, useEffect, useState } from "react";

/** Persisted "show solver details" preference, shared by the progress panel and the result summary. */
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
      // Storage unavailable: toggle for this page only.
    }
    setOpen(next);
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return [open, toggle];
}
