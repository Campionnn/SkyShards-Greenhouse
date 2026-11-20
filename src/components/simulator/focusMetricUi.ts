import { useCallback, useState } from "react";
import { COINS_METRIC, readMetric, type RankMetric } from "../../leaderboard/metric";
import { formatMetric, metricName, metricUnit } from "../../leaderboard/view";

/**
 * The simulator's focus metric, page side: what the user optimises for, remembered in this browser
 * (`skyshards-sim-focus`), and how its numbers read. It is the KPI strip's hero and what the Monte
 * Carlo sweep measures; the others stay visible as smaller numbers. Values: focusMetric.ts.
 */

export const FOCUS_KEY = "skyshards-sim-focus";

/** The saved focus, or coins (unknown values fall back like the /flows URL). */
export function loadFocus(): RankMetric {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(FOCUS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { by?: unknown; crop?: unknown } | null;
      return readMetric(v?.by, v?.crop);
    }
  } catch {
    // Fall through to coins.
  }
  return COINS_METRIC;
}

export function useFocusMetric(): [RankMetric, (m: RankMetric) => void] {
  const [value, setValue] = useState<RankMetric>(loadFocus);
  const set = useCallback((m: RankMetric) => {
    const next = readMetric(m.by, m.crop);
    setValue(next);
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify(next));
    } catch {
      // Private mode: not remembered.
    }
  }, []);
  return [value, set];
}

/** A metric's number: coins as coins ("64.9M"), counts compact ("12.3k"). */
export const formatFocus = (metric: RankMetric, n: number): string => formatMetric(metric, n);

/** "Coins/day", "Wheat/day", "Sowdust/day", "Farming XP/day". */
export const focusUnit = (metric: RankMetric): string => metricUnit(metric);

/** The sweep card's title: "Profit by online frequency", "Wheat collection by…", "Sowdust by…". */
export function focusSweepTitle(metric: RankMetric): string {
  if (metric.by === "coins") return "Profit by online frequency";
  if (metric.by === "collection") return `${metricName(metric)} collection by online frequency`;
  return `${metricName(metric)} by online frequency`;
}

/** What the metric is called in a sentence: "profit", "Wheat", "Sowdust", "Farming XP". */
export const focusNoun = (metric: RankMetric): string => (metric.by === "coins" ? "profit" : metricName(metric));
