import { useMemo, useState } from "react";
import type { PlayerStats, Scenario } from "../simulator";
import type { Board } from "../leaderboard/rules";
import type { Quotes, YieldStats } from "../leaderboard/pricing";
import { yieldStatsDiffer } from "../leaderboard/pricing";
import { nearestEvery, nearestTier, type TierId } from "../leaderboard/tiers";
import { LocalStorageManager } from "../utilities/localStorageManager";
import { useBazaarPrices, type BazaarPricesView } from "./useBazaarPrices";
import { useProfileMode } from "./useProfileMode";

/** The viewer's stats from their saved simulator scenario, if any. */
export interface SavedStats {
  stats: PlayerStats;
  every: number | null;
}

export function loadSavedStats(): SavedStats | null {
  const sc: Scenario | null = LocalStorageManager.loadSimulatorScenario();
  const stats = sc?.settings?.playerStats;
  if (!stats || typeof stats !== "object") return null;
  const activity = sc.settings.activity;
  return { stats, every: activity?.kind === "everyN" && Number.isFinite(activity.n) ? activity.n : null };
}

const yieldOf = (s: PlayerStats): YieldStats => ({
  farmingFortune: s.farmingFortune,
  plantYieldUpgrade: s.plantYieldUpgrade,
  evergreenChip: s.evergreenChip,
  overbloom: s.overbloom,
  armorSet: s.armorSet,
});

/** Kept for the session, so going from the list to an entry and back keeps the choices. */
let remembered: { every: number; tier: TierId | null; useMyStats: boolean } | null = null;

export interface FlowViewer {
  board: Board;
  setBoard: (b: Board) => void;
  every: number;
  setEvery: (n: number) => void;
  tier: TierId;
  /** The tier picked from the saved stats (null without a saved scenario). */
  autoTier: TierId | null;
  setTier: (t: TierId) => void;
  useMyStats: boolean;
  setUseMyStats: (v: boolean) => void;
  /** The viewer's yield stats, when a saved scenario exists. */
  viewerStats: YieldStats | null;
  /** Results are scaled (an estimate): "use my stats" is on and the stats differ from the maxima. */
  scaling: boolean;
  bazaar: BazaarPricesView;
  quotes: Quotes;
}

/** Board, frequency, tier and yield-stat choices shared by /flows and /flows/:id. */
export function useFlowViewer(): FlowViewer {
  const [profile, setProfile] = useProfileMode();
  const saved = useMemo(loadSavedStats, []);
  const autoTier = saved ? nearestTier(saved.stats) : null;
  const [every, setEveryState] = useState<number>(() => remembered?.every ?? (saved?.every ? nearestEvery(saved.every) : 1));
  const [tierChoice, setTierChoice] = useState<TierId | null>(() => remembered?.tier ?? null);
  const [useMyStats, setUseMyStatsState] = useState<boolean>(() => remembered?.useMyStats ?? !!saved);
  const tier = tierChoice ?? autoTier ?? "max";
  const remember = (patch: Partial<NonNullable<typeof remembered>>) => {
    remembered = { every, tier: tierChoice, useMyStats, ...patch };
  };
  const board: Board = profile === "normal" ? "normal" : "ironman";
  const bazaar = useBazaarPrices(board === "normal");
  const viewerStats = saved ? yieldOf(saved.stats) : null;
  return {
    board,
    setBoard: (b) => setProfile(b),
    every,
    setEvery: (n) => {
      setEveryState(n);
      remember({ every: n });
    },
    tier,
    autoTier,
    setTier: (t) => {
      setTierChoice(t);
      remember({ tier: t });
    },
    useMyStats,
    setUseMyStats: (v) => {
      setUseMyStatsState(v);
      remember({ useMyStats: v });
    },
    viewerStats,
    scaling: useMyStats && !!viewerStats && yieldStatsDiffer(viewerStats),
    bazaar,
    quotes: bazaar.quotes ?? {},
  };
}
