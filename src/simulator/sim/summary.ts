import type { PerPlotSummary, PlotId, RunSummary, UptimeCounts } from "./state";

export function zeroUptime(): UptimeCounts {
  return { watched: 0, growing: 0, ready: 0, requirements: 0, blocked: 0, halted: 0 };
}

/**
 * Share of watched cell-cycles the spot was usable (target standing and not
 * dried out, or free to spawn). 1 when nothing was watched. Halted, blocked
 * and requirements cycles are all downtime.
 */
export function uptimeRatio(u: UptimeCounts): number {
  return u.watched > 0 ? (u.growing + u.ready) / u.watched : 1;
}

export function zeroPerPlot(): PerPlotSummary {
  return { revenue: 0, spawned: 0, harvested: 0, decayed: 0, destroyed: 0 };
}

export function zeroSummary(plotIds: PlotId[]): RunSummary {
  return {
    cyclesRun: 0,
    elapsedSeconds: 0,
    coinsRealised: 0,
    revenue: { crops: 0, rareDrops: 0, rareCrops: 0, mutationItems: 0 },
    costs: { replacements: 0, supplies: 0 },
    profit: 0,
    coinsPerDay: 0,
    mutationsPerDay: 0,
    rivals: { spawned: 0, cleared: 0 },
    spawned: {},
    harvested: {},
    decayed: {},
    extended: {},
    destroyed: {},
    driedOut: {},
    placedItems: {},
    rareCrops: {},
    injected: {},
    replacements: 0,
    debtEvents: 0,
    unfilledCellCycles: 0,
    uptime: zeroUptime(),
    perPlot: Object.fromEntries(plotIds.map((id) => [String(id), zeroPerPlot()])),
  };
}

export function bump(rec: Record<string, number>, key: string, by = 1): void {
  rec[key] = (rec[key] ?? 0) + by;
}

export function perPlot(summary: RunSummary, plotId: PlotId): PerPlotSummary {
  const k = String(plotId);
  return (summary.perPlot[k] ??= zeroPerPlot());
}

/** Recompute the derived figures so revenue categories and costs reconcile to profit exactly. */
export function finalizeSummary(summary: RunSummary, cyclesRun: number, elapsedSeconds: number): void {
  summary.cyclesRun = cyclesRun;
  summary.elapsedSeconds = elapsedSeconds;
  const revenue = summary.revenue.crops + summary.revenue.rareDrops + summary.revenue.rareCrops + summary.revenue.mutationItems;
  summary.coinsRealised = revenue;
  summary.profit = revenue - summary.costs.replacements - summary.costs.supplies;
  const days = elapsedSeconds / 86400;
  let spawned = 0;
  for (const n of Object.values(summary.spawned)) spawned += n;
  summary.coinsPerDay = days > 0 ? revenue / days : 0;
  summary.mutationsPerDay = days > 0 ? spawned / days : 0;
}
