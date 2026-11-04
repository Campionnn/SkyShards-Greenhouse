import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// "New list entry rises in" (kit-rise-in), but only for entries added after their list first
// appeared: opening a card or switching steps shows everything at once, with no motion.

const Scope = createContext<{ current: boolean } | null>(null);

/** Entries rendered inside this scope after it mounted rise in; the first render does not animate. */
export function RiseScope({ children }: { children: ReactNode }) {
  const ready = useRef(false);
  useEffect(() => {
    ready.current = true;
    return () => {
      ready.current = false;
    };
  }, []);
  return createElement(Scope.Provider, { value: ready }, children);
}

/** "kit-rise-in" when this entry mounted after its scope did, else "". Fixed for the entry's life. */
export function useRiseIn(): string {
  const scope = useContext(Scope);
  const [rise] = useState(() => scope?.current === true);
  return rise ? "kit-rise-in" : "";
}
