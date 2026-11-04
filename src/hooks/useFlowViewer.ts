import { useEffect, useMemo, useState } from "react";
import { ARMOR_SETS, FORTUNE_CROPS, type ArmorSet, type CropFortune, type FarmingToolStats, type PlayerStats, type Scenario } from "../simulator";
import { cellKindOf, type Board, type CellKind } from "../leaderboard/rules";
import type { Quotes, YieldStats } from "../leaderboard/pricing";
import { yieldStatsDiffer } from "../leaderboard/pricing";
import { nearestEvery, snapToTier, tierStats, type TierSnap } from "../leaderboard/tiers";
import { LocalStorageManager } from "../utilities/localStorageManager";
import { useBazaarPrices, type BazaarPricesView } from "./useBazaarPrices";
import { useProfileMode } from "./useProfileMode";

/**
 * The viewer's own stats on the leaderboard: entered field by field, saved in localStorage, and
 * snapped to the nearest stat tier for the simulation-dependent part (growth speed, Flora,
 * Bioanalysis, Mining Fortune). Yield stats scale the stored counts directly (an estimate).
 */

export const VIEWER_STATS_KEY = "skyshards-flows-stats";

/** Everything the viewer can enter. */
export interface ViewerStats {
  cropGrowth: number;
  speedAttribute: number;
  growthUpgradeTier: number;
  floraShard: number;
  mutationChanceBonus: number;
  miningFortune: number;
  farmingFortune: number;
  plantYieldUpgrade: number;
  evergreenChip: number;
  overbloom: number;
  armorSet: ArmorSet;
  /** Crop-specific fortune on top of `farmingFortune` (missing crop = 0). Empty = none. */
  cropFortune: CropFortune;
  /** Farming tools; the best one per harvest adds its fortune on that crop. Empty = none. */
  tools: FarmingToolStats[];
  /** Online every N cycles (any number; the list uses the nearest grid frequency). */
  every: number;
}

export function defaultViewerStats(): ViewerStats {
  const s = tierStats("max");
  return {
    cropGrowth: s.cropGrowth,
    speedAttribute: s.speedAttribute,
    growthUpgradeTier: s.growthUpgradeTier,
    floraShard: s.floraShard,
    mutationChanceBonus: s.mutationChanceBonus,
    miningFortune: s.miningFortune,
    farmingFortune: s.farmingFortune,
    plantYieldUpgrade: s.plantYieldUpgrade,
    evergreenChip: s.evergreenChip,
    overbloom: s.overbloom,
    armorSet: s.armorSet,
    cropFortune: {},
    tools: [],
    every: 1,
  };
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Crop fortune: FORTUNE_CROPS keys with finite non-zero numbers only. */
export function readCropFortune(raw: unknown): CropFortune {
  const out: CropFortune = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const c of FORTUNE_CROPS) {
    const v = r[c];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) out[c] = v;
  }
  return out;
}

/** Tools: `{name: string, fortune: CropFortune}` entries; anything else is dropped. */
export function readTools(raw: unknown): FarmingToolStats[] {
  if (!Array.isArray(raw)) return [];
  const out: FarmingToolStats[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const { name, fortune } = t as { name?: unknown; fortune?: unknown };
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({ name: name.trim().slice(0, 80), fortune: readCropFortune(fortune) });
  }
  return out;
}

/** Merge anything stat-shaped over the defaults, keeping only valid values. */
export function readViewerStats(raw: unknown): ViewerStats {
  const d = defaultViewerStats();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  return {
    cropGrowth: num(r.cropGrowth, d.cropGrowth),
    speedAttribute: num(r.speedAttribute, d.speedAttribute),
    growthUpgradeTier: num(r.growthUpgradeTier, d.growthUpgradeTier),
    floraShard: num(r.floraShard, d.floraShard),
    mutationChanceBonus: num(r.mutationChanceBonus, d.mutationChanceBonus),
    miningFortune: num(r.miningFortune, d.miningFortune),
    farmingFortune: num(r.farmingFortune, d.farmingFortune),
    plantYieldUpgrade: num(r.plantYieldUpgrade, d.plantYieldUpgrade),
    evergreenChip: num(r.evergreenChip, d.evergreenChip),
    overbloom: num(r.overbloom, d.overbloom),
    armorSet: ARMOR_SETS.includes(r.armorSet as ArmorSet) ? (r.armorSet as ArmorSet) : d.armorSet,
    cropFortune: readCropFortune(r.cropFortune),
    tools: readTools(r.tools),
    every: Math.max(1, Math.round(num(r.every, d.every))),
  };
}

/** The stats from the saved simulator scenario, if any (the first-visit default). */
export function statsFromSimulator(): ViewerStats | null {
  const sc: Scenario | null = LocalStorageManager.loadSimulatorScenario();
  const stats: PlayerStats | undefined = sc?.settings?.playerStats;
  if (!sc || !stats || typeof stats !== "object") return null;
  const activity = sc.settings.activity;
  return readViewerStats({ ...stats, every: activity?.kind === "everyN" && Number.isFinite(activity.n) ? activity.n : 1 });
}

function loadViewerStats(): { stats: ViewerStats; source: "saved" | "simulator" | "default" } {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(VIEWER_STATS_KEY) : null;
    if (raw) return { stats: readViewerStats(JSON.parse(raw)), source: "saved" };
  } catch {
    /* fall through */
  }
  const sim = statsFromSimulator();
  return sim ? { stats: sim, source: "simulator" } : { stats: defaultViewerStats(), source: "default" };
}

/** The yield part of the viewer's stats; the per-crop terms only when set, so none = the server's shape. */
export const yieldOf = (s: ViewerStats): YieldStats => ({
  farmingFortune: s.farmingFortune,
  plantYieldUpgrade: s.plantYieldUpgrade,
  evergreenChip: s.evergreenChip,
  overbloom: s.overbloom,
  armorSet: s.armorSet,
  ...(Object.keys(s.cropFortune).length ? { cropFortune: s.cropFortune } : {}),
  ...(s.tools.length ? { tools: s.tools } : {}),
});

export interface FlowViewer {
  board: Board;
  /** Ironman board: "I have the starting items" (the cells shown are the `ironman_kit` ones). Always false on Normal. */
  kit: boolean;
  setKit: (on: boolean) => void;
  /** The cell kind the board and switch show. */
  cellKind: CellKind;
  /** The flow isn't entered on the viewer's own board, so `board` is the flow's board instead. */
  boardForced: boolean;
  setBoard: (b: Board) => void;
  stats: ViewerStats;
  setStats: (patch: Partial<ViewerStats>) => void;
  resetStats: (to: "max" | "simulator") => void;
  /** Pick a grid frequency (the detail page's chart). */
  setEvery: (n: number) => void;
  /** Whether the simulator has stats to copy. */
  hasSimulatorStats: boolean;
  /** The grid frequency the list uses (nearest to `stats.every`). */
  every: number;
  /** The nearest tier and the numbers behind it. */
  snap: TierSnap;
  tier: TierSnap["tier"];
  viewerStats: YieldStats;
  /** Always on: counts are scaled to the entered yield stats when they differ from the maxima. */
  useMyStats: true;
  scaling: boolean;
  bazaar: BazaarPricesView;
  quotes: Quotes;
}

export interface FlowViewerOptions {
  /** The boards the flow is entered on (the detail page); the board falls back to one of them. */
  available?: readonly Board[];
  /** The board from the page's URL (`?board=`); null/undefined = the site profile's default. */
  board?: Board | null;
  /** Called when the viewer picks a board (the page writes it to its URL). */
  onBoard?: (b: Board) => void;
  /** The starting-items switch from the page's URL (`kit=1`, or v2's `board=ironman_borrow`). */
  kit?: boolean;
  /** Called when the viewer flips the switch (the page writes it to its URL). */
  onKit?: (on: boolean) => void;
  /** Fetch Bazaar prices on any board (the detail page shows the Normal number next to the others). */
  bazaarAlways?: boolean;
}

/**
 * Board, stats and prices shared by /flows and /flows/:id (stats persist in localStorage). The
 * board is the URL's when given, else the last one picked here, else the site profile's default
 * (ironman → Ironman, normal → Normal). The starting-items switch is the URL's (off by default).
 */
export function useFlowViewer(opts: FlowViewerOptions = {}): FlowViewer {
  const { available, board: urlBoard, onBoard, kit: urlKit, onKit, bazaarAlways = false } = opts;
  const [profile, setProfile] = useProfileMode();
  const [{ stats }, setLoaded] = useState(loadViewerStats);
  const hasSimulatorStats = useMemo(() => statsFromSimulator() !== null, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIEWER_STATS_KEY, JSON.stringify(stats));
    } catch {
      /* private mode: keep the session copy */
    }
  }, [stats]);
  const [picked, setPicked] = useState<Board | null>(null);
  const [pickedKit, setPickedKit] = useState<boolean | null>(null);
  const preferred: Board = urlBoard ?? picked ?? (profile === "normal" ? "normal" : "ironman");
  // A flow entered on one board only is shown on that board, whatever the site-wide mode is
  // (the saved mode itself is left alone).
  const boardForced = !!available && available.length > 0 && !available.includes(preferred);
  const board: Board = boardForced ? available[0] : preferred;
  const bazaar = useBazaarPrices(bazaarAlways || board === "normal");
  const snap = useMemo(() => snapToTier(stats), [stats]);
  const viewerStats = useMemo(() => yieldOf(stats), [stats]);
  const kit = board === "ironman" && (urlKit ?? pickedKit ?? false);
  return {
    board,
    kit,
    setKit: (on) => {
      setPickedKit(on);
      onKit?.(on);
    },
    cellKind: cellKindOf(board, kit),
    boardForced,
    setBoard: (b) => {
      setPicked(b);
      onBoard?.(b);
      // The site-wide mode follows (the simulator opens in it).
      setProfile(b === "normal" ? "normal" : "ironman");
    },
    stats,
    setStats: (patch) => setLoaded((cur) => ({ stats: readViewerStats({ ...cur.stats, ...patch }), source: "saved" })),
    resetStats: (to) => setLoaded({ stats: (to === "simulator" && statsFromSimulator()) || defaultViewerStats(), source: "saved" }),
    hasSimulatorStats,
    setEvery: (every) => setLoaded((cur) => ({ stats: readViewerStats({ ...cur.stats, every }), source: "saved" })),
    every: nearestEvery(stats.every),
    snap,
    tier: snap.tier,
    viewerStats,
    useMyStats: true,
    scaling: yieldStatsDiffer(viewerStats),
    bazaar,
    quotes: bazaar.quotes ?? {},
  };
}
