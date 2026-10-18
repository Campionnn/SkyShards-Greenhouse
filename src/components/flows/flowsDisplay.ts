import { useMemo } from "react";
import type { FlowDetail } from "../../leaderboard/api";
import { rarityOf } from "../simulator/format";

/** Non-component helpers for the leaderboard components (kept apart for fast refresh). */

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
