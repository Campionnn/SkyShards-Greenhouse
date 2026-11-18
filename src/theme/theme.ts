// Colour themes. A theme only swaps colour tokens (src/index.css `:root[data-theme="…"]` blocks);
// layout, type and spacing never change. The choice persists in localStorage and is applied before
// first paint by the inline script in index.html (keep THEME_STORAGE_KEY in sync with it).
import { useSyncExternalStore } from "react";

export const THEMES = [
  { id: "default", label: "Default", hint: "Grey and emerald" },
  { id: "slate", label: "Slate", hint: "The original blue-grey colours" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "skyshards-theme";
const EVENT = "skyshards-theme";

function isTheme(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

export function getTheme(): ThemeId {
  if (typeof document === "undefined") return "default";
  const v = document.documentElement.dataset.theme;
  return isTheme(v) ? v : "default";
}

export function setTheme(id: ThemeId): void {
  const root = document.documentElement;
  if (id === "default") delete root.dataset.theme;
  else root.dataset.theme = id;
  try {
    if (id === "default") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* private mode: apply without persisting */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    const v = e.newValue;
    const root = document.documentElement;
    if (isTheme(v) && v !== "default") root.dataset.theme = v;
    else delete root.dataset.theme;
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, getTheme, () => "default");
}
