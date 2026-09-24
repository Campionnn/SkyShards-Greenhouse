import { useSyncExternalStore } from "react";

export const MAX_UNIQUE_CROPS = 12;
const STORAGE_KEY = "skyshards-unique-crops";

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_UNIQUE_CROPS, Math.max(0, Math.round(value)));
}

function read(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? 0 : clamp(Number(JSON.parse(raw)));
  } catch {
    return 0;
  }
}

// A tiny module-level store so the panel and the solve button share one value.
let current = read();
const listeners = new Set<() => void>();

export function setUniqueCrops(value: number) {
  current = clamp(value);
  try {
    if (current === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage full or disabled: keep the in-memory value
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The requested number of unique crops (0 = off). */
export function useUniqueCrops(): number {
  return useSyncExternalStore(subscribe, () => current);
}
