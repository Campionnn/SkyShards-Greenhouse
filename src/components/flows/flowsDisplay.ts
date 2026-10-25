import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlowDetail } from "../../leaderboard/api";
import { rarityOf } from "../simulator/format";

/** Non-component helpers for the leaderboard components (kept apart for fast refresh). */

// ---- Items the viewer owns (the "I own the starting items" filter) ----------------------------

/** Imported from Hypixel (sacks, ender chest, backpacks, inventory); kept in localStorage like the Guide's import. */
export const OWNED_ITEMS_KEY = "skyshards-flows-owned";

export interface OwnedItems {
  username: string;
  /** Profile name for the label ("Banana (Ironman)"). */
  profile: string;
  /** Item id -> count (whole, > 0). */
  items: Record<string, number>;
  /** Epoch ms of the import. */
  at: number;
}

/** A stored import, or null when missing or malformed. */
export function readOwnedItems(raw: unknown): OwnedItems | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.items || typeof r.items !== "object" || Array.isArray(r.items)) return null;
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.items as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v > 0) items[k] = Math.floor(v);
  return {
    username: typeof r.username === "string" ? r.username : "",
    profile: typeof r.profile === "string" ? r.profile : "",
    items,
    at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
  };
}

function loadOwned(): OwnedItems | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(OWNED_ITEMS_KEY) : null;
    return raw ? readOwnedItems(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const OWNED_EVENT = "skyshards-flows-owned";

/** The viewer's imported items (shared by every component that asks; null before an import). */
export function useOwnedItems(): [OwnedItems | null, (next: OwnedItems | null) => void] {
  const [owned, setOwned] = useState<OwnedItems | null>(loadOwned);
  useEffect(() => {
    const sync = () => setOwned(loadOwned());
    window.addEventListener(OWNED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(OWNED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = useCallback((next: OwnedItems | null) => {
    try {
      if (next) localStorage.setItem(OWNED_ITEMS_KEY, JSON.stringify(next));
      else localStorage.removeItem(OWNED_ITEMS_KEY);
    } catch {
      // Private mode: keep this page's copy.
    }
    setOwned(next);
    window.dispatchEvent(new Event(OWNED_EVENT));
  }, []);
  return [owned, set];
}

export const SPLIT_STYLE = {
  crops: { label: "crops", bar: "bg-emerald-400/80", text: "text-emerald-300" },
  mutations: { label: "mutations", bar: "bg-amber-400/80", text: "text-amber-300" },
  rare: { label: "rare", bar: "bg-sky-400/80", text: "text-sky-300" },
} as const;

export const EFFORT_LABEL: Record<string, string> = {
  water: "Watering",
  harvest: "Harvests",
  minigame: "Minigame harvests",
  replant: "Replants",
  place: "Placements",
  remove: "Removals",
  replace: "Swaps before decay",
  roots: "Root clearing",
  ground: "Ground fixes",
  gate: "Gate interactions",
  noctilume: "Noctilume time changes",
  stepChange: "Step changes",
  bazaar: "Bazaar visits",
};

/** The highest rarity among some mutations (for a row's rarity label). */
export function topRarity(ids: readonly string[]): string | null {
  const order = ["common", "uncommon", "rare", "epic", "legendary"];
  let best = -1;
  for (const id of ids) {
    const r = order.indexOf((rarityOf(id) ?? "").toLowerCase());
    if (r > best) best = r;
  }
  return best >= 0 ? order[best] : null;
}

/** Effort per login on a rough log scale: 5 bars, from a quick harvest to a full rebuild. */
export function effortLevel(avg: number | null): { bars: number; label: string; tone: string } {
  if (avg === null) return { bars: 0, label: "unknown", tone: "text-slate-500" };
  if (avg < 10) return { bars: 1, label: "Relaxed", tone: "text-emerald-300" };
  if (avg < 25) return { bars: 2, label: "Light", tone: "text-emerald-300" };
  if (avg < 60) return { bars: 3, label: "Moderate", tone: "text-amber-200" };
  if (avg < 150) return { bars: 4, label: "Busy", tone: "text-orange-300" };
  return { bars: 5, label: "Intense", tone: "text-red-300" };
}

/** Plot-level static numbers for the detail hero ("3 plots · 7 steps · scripted"). */
export function useFlowShape(detail: FlowDetail) {
  return useMemo(() => {
    const plots = detail.payload?.plots ?? [];
    const steps = plots.reduce((n, p) => n + p.flow.steps.length, 0);
    const scripted = !!detail.payload?.script?.source?.trim() || plots.some((p) => !!p.script?.source.trim());
    return { steps, scripted };
  }, [detail.payload]);
}
