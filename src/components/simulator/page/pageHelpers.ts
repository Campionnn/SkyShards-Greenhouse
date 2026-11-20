import type { SimulationView } from "../../../hooks/useSimulation";
import { CONFIG_META, DEFAULT_CONFIG, type RunSummary, type Scenario } from "../../../simulator";
import { COINS_METRIC, type RankMetric } from "../../../leaderboard/metric";
import { metricPerDay } from "../focusMetric";
import { describeStop, stopPlace } from "./stepBy";

// Plain helpers shared by the simulator page's components (kept out of .tsx files so React fast
// refresh only sees components there).

/** Run lengths offered in the Run menu. */
export const RUN_PRESETS = [50, 200, 500, 2000] as const;

/** Settings that differ from the defaults (Advanced), for the drawer tab and the Settings chip. */
export function changedAdvancedSettings(settings: Scenario["settings"]): number {
  return (
    CONFIG_META.filter((m) => settings.config[m.key] !== DEFAULT_CONFIG[m.key]).length +
    (settings.config.forcedEffects ? 1 : 0) +
    (settings.config.freePlacedItems?.length ? 1 : 0) +
    (settings.config.setupFromStock === true ? 1 : 0) +
    (settings.config.leaderboardRules === true ? 1 : 0)
  );
}

export function undoTitle(action: SimulationView["history"]["lastAction"]): string {
  if (!action) return "Nothing to undo";
  if (action.kind === "items") return `Undo the inventory change at cycle ${action.cycle} (Ctrl Z)`;
  if (action.cycles === 1) return `Undo the step from cycle ${action.fromCycle} (Ctrl Z)`;
  return `Undo the run of ${action.cycles} cycles, back to cycle ${action.fromCycle} (Ctrl Z)`;
}

export type PriceSummary = (s: RunSummary) => { profit: number; perDay: number } | null;

/** The headline numbers; while a run is in flight they follow the worker's running totals. */
export function kpiValues(view: SimulationView, priceSummary?: PriceSummary) {
  const running = view.status === "running";
  const summary = (running && view.progress?.summary) || view.snapshot?.state.summary || null;
  const priced = summary ? (priceSummary?.(summary) ?? null) : null;
  const perDay = priced ? priced.perDay : (summary?.coinsPerDay ?? 0);
  const profit = priced ? priced.profit : (summary?.profit ?? 0);
  const prev = !running && view.previousSummary ? (priceSummary?.(view.previousSummary)?.perDay ?? view.previousSummary.coinsPerDay) : null;
  return { running, summary, perDay, profit, delta: prev === null ? null : perDay - prev, priced: !!priced };
}

/** One smaller number beside the hero: a metric that isn't the focus. */
export interface SideMetric {
  metric: RankMetric;
  value: number;
}

/**
 * The focus metric's numbers for the KPI strip: its value per day, the change since the last
 * Step / Run, and the other metrics (coins when not focused, Sowdust, Farming XP) per day.
 * Coins use the same valuation as `kpiValues` (Bazaar when priced, else NPC).
 */
export function focusValues(view: SimulationView, metric: RankMetric, priceSummary?: PriceSummary) {
  const running = view.status === "running";
  const summary = (running && view.progress?.summary) || view.snapshot?.state.summary || null;
  const coins = (s: RunSummary) => priceSummary?.(s)?.perDay ?? s.coinsPerDay;
  const value = summary ? metricPerDay(summary, metric, coins) : 0;
  const prev = !running && view.previousSummary ? metricPerDay(view.previousSummary, metric, coins) : null;
  const side: SideMetric[] = SIDE_METRICS.filter((m) => m.by !== metric.by).map((m) => ({ metric: m, value: summary ? metricPerDay(summary, m, coins) : 0 }));
  return { value, delta: prev === null ? null : value - prev, side };
}

/** The metrics shown beside the hero when they aren't the focus (a collection only shows as the focus). */
const SIDE_METRICS: RankMetric[] = [COINS_METRIC, { ...COINS_METRIC, by: "sowdust" }, { ...COINS_METRIC, by: "xp" }];

export function statusText(view: SimulationView, plotCount: number): string {
  const running = view.status === "running";
  const ready = view.status === "ready";
  const summary = view.snapshot?.state.summary;
  if (view.status === "error") return "The scenario has errors: open Problems.";
  if (view.status === "loading") return "Setting up…";
  if (running && view.progress) return `Running ${view.progress.done.toLocaleString("en-US")} of ${view.progress.total.toLocaleString("en-US")} cycles… Space or Esc stops.`;
  if (running) return "Going back…";
  if (!ready || !summary) return "";
  if (view.stop) {
    const s = view.stop;
    return `Cycle ${s.cycle}, ${s.index} of ${s.count}: ${stopPlace(s.stop)} · ${describeStop(s.stop)}`;
  }
  if (view.rewound) {
    const undone = view.rewound.undone;
    const cycle = view.snapshot!.state.cycle;
    return !undone
      ? `Went back to cycle ${cycle}. Step or Run to continue from here.`
      : undone.kind === "run"
        ? `Undid ${undone.cycles === 1 ? "a step" : `a run of ${undone.cycles} cycles`}; back at cycle ${cycle}.`
        : `Undid an inventory change; back at cycle ${cycle}.`;
  }
  const halt = view.snapshot?.state.scripts?.halt;
  if (view.lastCall && halt) {
    return `Ran ${view.lastCall.cyclesRun} cycle${view.lastCall.cyclesRun === 1 ? "" : "s"}; ${halt.kind === "pause" ? "a script paused the run" : "a script error stopped the run"} at cycle ${halt.cycle}.`;
  }
  if (view.lastCall) {
    return `${view.lastCall.truncated ? "Stopped after" : "Ran"} ${view.lastCall.cyclesRun.toLocaleString("en-US")} cycle${view.lastCall.cyclesRun === 1 ? "" : "s"} on ${plotCount} plot${plotCount === 1 ? "" : "s"} · rivals ${summary.rivals.spawned} spawned, ${summary.rivals.cleared} cleared`;
  }
  return `Set up ${plotCount} plot${plotCount === 1 ? "" : "s"} at cycle ${view.snapshot!.state.cycle}. Step or Run.`;
}
