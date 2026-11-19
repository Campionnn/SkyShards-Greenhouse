import { useMemo } from "react";
import type { FlowDetail } from "../../leaderboard/api";
import type { EffortResult } from "../../leaderboard/result";
import { EFFORT_WEIGHTS } from "../../simulator/config";
import type { EffortKind } from "../../simulator/sim/state";
import { rarityOf } from "../simulator/format";

/** Non-component helpers for the leaderboard components (kept apart for fast refresh). */

/**
 * The revenue split's three parts in the chart-series colours (index.css `--color-series-*`, data
 * only): crops leaf green, mutation items orange, rare crops and drops magenta. The legend names them.
 */
export const SPLIT_STYLE = {
  crops: { label: "crops", bar: "bg-series-crops", text: "text-fg-muted" },
  mutations: { label: "mutations", bar: "bg-series-mutations", text: "text-fg-muted" },
  rare: { label: "rare", bar: "bg-series-rare", text: "text-fg-muted" },
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
  // `stepChange` weighs nothing (the rebuild's own actions carry it); the label stays for old results.
  stepChange: "Step changes",
  bazaar: "Bazaar visits",
};

/**
 * Effort per login by action, heaviest first: `n` actions and `w` weighted effort per login. Uses
 * the engine's own weighted totals when the result has them (step-change work counts at a reduced
 * weight), else count × `EFFORT_WEIGHTS` (older results). Weightless kinds (step changes) are left out.
 */
export function effortRows(effort: EffortResult): { k: string; n: number; w: number }[] {
  return Object.entries(effort.byKind)
    .map(([k, n]) => ({ k, n: n ?? 0, w: effort.weightedByKind ? (effort.weightedByKind[k as EffortKind] ?? 0) : (n ?? 0) * (EFFORT_WEIGHTS[k as EffortKind] ?? 1) }))
    .filter((r) => r.n > 0 && r.w > 0)
    .sort((a, b) => b.w - a.w);
}

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

/**
 * Effort per login on a rough log scale: 5 bars, from a quick harvest to a full rebuild. Each tier
 * has its own colour on the `effort-*` data scale (green = relaxed → red = intense).
 */
export function effortLevel(avg: number | null): { bars: number; label: string; tone: string; bar: string } {
  if (avg === null) return { bars: 0, label: "unknown", tone: "text-fg-meta", bar: "bg-fg-muted" };
  if (avg < 25) return { bars: 1, label: "Relaxed", tone: "text-effort-1", bar: "bg-effort-1" };
  if (avg < 50) return { bars: 2, label: "Light", tone: "text-effort-2", bar: "bg-effort-2" };
  if (avg < 100) return { bars: 3, label: "Moderate", tone: "text-effort-3", bar: "bg-effort-3" };
  if (avg < 150) return { bars: 4, label: "Busy", tone: "text-effort-4", bar: "bg-effort-4" };
  return { bars: 5, label: "Intense", tone: "text-effort-5", bar: "bg-effort-5" };
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
