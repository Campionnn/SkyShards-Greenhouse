/**
 * Monte Carlo statistics for the page's local tests (the simulator's "Profit by online frequency"
 * and the flow page's "Test with your stats"): many seeds of the same flow, summarised as a
 * distribution of profit per day. Pure; not part of the verify bundle (cli.ts never imports it).
 */

/** The share of seeds the "range" covers: the middle 90% (5th to 95th percentile). */
export const RANGE_SHARE = 0.9;
export const RANGE_LABEL = "90% range";
/** Below this many seeds the 90% range is close to the min / max and is shown as rough. */
export const ROUGH_BELOW = 20;

export interface Distribution {
  n: number;
  mean: number;
  median: number;
  /** Sample standard deviation (0 for one value). */
  sd: number;
  /** Half-width of the 95% confidence interval of the mean (1.96 × sd / √n). */
  meanMargin: number;
  /** 5th / 95th percentile: 90% of seeds land between them. */
  lo: number;
  hi: number;
  /** 25th / 75th percentile: the middle half. */
  q1: number;
  q3: number;
  min: number;
  max: number;
  /** Share of seeds with a profit below 0. */
  lossShare: number;
}

/** Quantile `q` (0..1) of sorted values, linear between the two nearest (R type 7, numpy's default). */
export function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const h = (n - 1) * Math.max(0, Math.min(1, q));
  const i = Math.floor(h);
  const f = h - i;
  return i + 1 < n ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[n - 1];
}

/** The distribution of a list of values (null for an empty list; non-finite values are dropped). */
export function distribution(values: readonly number[]): Distribution | null {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return null;
  const sorted = [...v].sort((a, b) => a - b);
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const tail = (1 - RANGE_SHARE) / 2;
  return {
    n,
    mean,
    median: quantile(sorted, 0.5),
    sd,
    meanMargin: n > 1 ? (1.96 * sd) / Math.sqrt(n) : 0,
    lo: quantile(sorted, tail),
    hi: quantile(sorted, 1 - tail),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted[n - 1],
    lossShare: v.filter((x) => x < 0).length / n,
  };
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

/** Equal-width bins over [min, max] (about √n of them, 6..24); one bin when every value is equal. */
export function histogram(values: readonly number[], bins?: number): HistogramBin[] {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return [];
  const min = Math.min(...v);
  const max = Math.max(...v);
  if (max === min) return [{ from: min, to: max, count: v.length }];
  const k = Math.max(1, Math.floor(bins ?? Math.min(24, Math.max(6, Math.round(Math.sqrt(v.length) * 1.5)))));
  const w = (max - min) / k;
  const out: HistogramBin[] = Array.from({ length: k }, (_, i) => ({ from: min + i * w, to: i === k - 1 ? max : min + (i + 1) * w, count: 0 }));
  for (const x of v) out[Math.min(k - 1, Math.floor((x - min) / w))].count++;
  return out;
}

/** One finished seed of a Monte Carlo test, already valued (null value: the seed failed). */
export interface McSample {
  every: number;
  value: number | null;
  /** Effort per login of the run (null without logins). */
  effort?: number | null;
}

/** A frequency's point: the chart's median (`profitPerDay`) plus the whole distribution. */
export interface McPoint {
  every: number;
  /** The median over the finished seeds (null without one). */
  profitPerDay: number | null;
  effortAvg?: number | null;
  mean?: number;
  lo?: number;
  hi?: number;
  n?: number;
  dist: Distribution | null;
  runs: number;
  failed: number;
}

/** Per grid frequency: the distribution of the finished seeds' values (failed seeds left out, counted). */
export function mcPoints(samples: readonly McSample[], grid: readonly number[]): McPoint[] {
  return grid.map((every) => {
    const at = samples.filter((s) => s.every === every);
    const ok = at.filter((s): s is McSample & { value: number } => s.value !== null && Number.isFinite(s.value));
    const dist = distribution(ok.map((s) => s.value));
    const efforts = ok.map((s) => s.effort).filter((e): e is number => typeof e === "number" && Number.isFinite(e));
    const effort = distribution(efforts);
    const base = { every, runs: at.length, failed: at.length - ok.length, dist };
    if (!dist) return { ...base, profitPerDay: null };
    return { ...base, profitPerDay: dist.median, mean: dist.mean, lo: dist.lo, hi: dist.hi, n: dist.n, effortAvg: effort ? effort.median : null };
  });
}

/** Seeds per frequency choices offered by both tests. */
export const SEED_PRESETS: readonly { seeds: number; label: string; hint: string }[] = [
  { seeds: 5, label: "Quick", hint: "5 seeds: a rough median" },
  { seeds: 20, label: "Standard", hint: "20 seeds: a steady median and a fair 90% range" },
  { seeds: 50, label: "Thorough", hint: "50 seeds: tight numbers, takes a while" },
  { seeds: 100, label: "Deep", hint: "100 seeds: for a close call between two flows" },
];
