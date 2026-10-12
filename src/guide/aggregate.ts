/**
 * Turning many simulated runs into one forecast and one plan.
 *
 * The plan is a **real** run (the medoid: the run whose per-plot farm sequences are closest to all
 * the others), never a made-up consensus, so its timeline is internally consistent. The other runs
 * supply the spread of completion times and how often each farm shows up at all.
 */
import { BOUGHT_SUPPLIES } from "./flow";
import type { Forecast, Plan, PlanSegment, PlotId, RunTimeline, ShoppingRow, Spread } from "./types";

/** Edit distance between two farm sequences (substitution costs 2, so it never beats delete+insert). */
export function sequenceDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j * 2);
  for (let i = 1; i <= a.length; i++) {
    const row = [i * 2];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 2, row[j - 1] + 2, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 2));
    }
    prev = row;
  }
  return prev[b.length];
}

/** The real run closest to all the others. Ties break on the lower seed, for determinism. */
export function medoid(runs: RunTimeline[]): RunTimeline {
  if (!runs.length) throw new Error("A forecast needs at least one run.");
  const plots = [...new Set(runs.flatMap((r) => Object.keys(r.farms).map(Number)))];
  let best = runs[0];
  let bestScore = Infinity;
  for (const run of runs) {
    let score = 0;
    for (const other of runs) {
      if (other === run) continue;
      for (const id of plots) score += sequenceDistance(run.farms[id] ?? [], other.farms[id] ?? []);
    }
    if (score < bestScore || (score === bestScore && run.seed < best.seed)) {
      best = run;
      bestScore = score;
    }
  }
  return best;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

export function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: quantile(sorted, 0.5), p10: quantile(sorted, 0.1), p90: quantile(sorted, 0.9) };
}

/**
 * Headline numbers. Completion time comes only from runs that finished; if none did, it is null
 * rather than the cap. The shopping list reconciles the 90th-percentile need against what is owned.
 */
export function summarise(runs: RunTimeline[], owned: Record<string, number>): Forecast {
  const completed = runs.filter((r) => r.done);
  const pool = completed.length ? completed : runs;
  const shopping: ShoppingRow[] = BOUGHT_SUPPLIES.map((item) => {
    const needed = quantile([...pool.map((r) => r.supplyNeed[item] ?? 0)].sort((a, b) => a - b), 0.9);
    const have = Math.max(0, Math.floor(owned[item] ?? 0));
    return { item, needed, owned: have, buy: Math.max(0, needed - have) };
  }).filter((row) => row.needed > 0 || row.owned > 0);
  return {
    seeds: runs.length,
    completed: completed.length,
    seconds: completed.length ? spread(completed.map((r) => r.elapsedSeconds)) : null,
    logins: completed.length ? spread(completed.map((r) => r.logins)) : null,
    shopping,
    medoidSeed: medoid(runs).seed,
  };
}

/** The medoid run as one timeline lane per plot, each segment annotated with how common it is. */
export function buildPlan(runs: RunTimeline[]): Plan {
  const base = medoid(runs);
  const lanes: Record<PlotId, PlanSegment[]> = {};
  for (const plotId of Object.keys(base.farms).map(Number)) {
    lanes[plotId] = base.visits
      .filter((v) => v.plotId === plotId)
      .sort((a, b) => a.startSeconds - b.startSeconds)
      .map((v) => ({
        plotId,
        farm: v.farm,
        startSeconds: v.startSeconds,
        seconds: v.seconds,
        share: runs.filter((r) => (r.farms[plotId] ?? []).includes(v.farm)).length / runs.length,
      }));
  }
  return { medoidSeed: base.seed, totalSeconds: base.elapsedSeconds, lanes };
}
