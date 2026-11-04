import { defaultViewerStats, type FlowViewer, type ViewerStats } from "../../../hooks/useFlowViewer";
import { cycleHours } from "../../../leaderboard/tiers";
import { TIER_LABEL } from "../../../leaderboard/view";
import { ARMOR_SET_LABEL, FORTUNE_CROPS } from "../../../simulator";
import { formatDuration } from "../../simulator/format";

/** Helpers for the "Your stats" chip, drawer header and the "numbers are for max stats" nudge. */

const ffText = (ff: number) => `${Math.round(ff).toLocaleString("en-US")} FF`;

/** The chip text: "Max tier · 3,059 FF". */
export function statsSummary(viewer: FlowViewer): string {
  return `${TIER_LABEL[viewer.tier]} tier · ${ffText(viewer.stats.farmingFortune)}`;
}

/** The drawer header: "Max tier · every 1 · 3,059 FF · Helianthus Armor". */
export function statsSummaryLong(viewer: FlowViewer): string {
  return `${TIER_LABEL[viewer.tier]} tier · every ${viewer.every} · ${ffText(viewer.stats.farmingFortune)} · ${ARMOR_SET_LABEL[viewer.stats.armorSet]}`;
}

const KEYS: (keyof ViewerStats)[] = [
  "cropGrowth",
  "speedAttribute",
  "growthUpgradeTier",
  "floraShard",
  "mutationChanceBonus",
  "miningFortune",
  "farmingFortune",
  "plantYieldUpgrade",
  "evergreenChip",
  "overbloom",
  "armorSet",
];

/**
 * True while the stats are the simulated maxima (the defaults) with no per-crop bonus or tools:
 * the numbers then are "for max stats", not the viewer's. The login frequency doesn't count.
 */
export function isDefaultStats(viewer: FlowViewer): boolean {
  const d = defaultViewerStats();
  const s = viewer.stats;
  if (KEYS.some((k) => s[k] !== d[k])) return false;
  if (s.tools.length) return false;
  return FORTUNE_CROPS.every((c) => !s.cropFortune[c]);
}

/** "1h 45m": the time between logins at `every` cycles with the viewer's growth speed. */
export function everyTime(viewer: FlowViewer, every: number = viewer.every): string {
  return formatDuration(cycleHours(viewer.stats) * every * 3600);
}
