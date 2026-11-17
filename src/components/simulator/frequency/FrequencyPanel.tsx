import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, RotateCcw, Square } from "lucide-react";
import type { RunSummary, Scenario } from "../../../simulator";
import { RANGE_LABEL, SEED_PRESETS } from "../../../leaderboard/montecarlo";
import { slackFrom, percent } from "../../../leaderboard/view";
import { FrequencyChart } from "../../flows/FrequencyChart";
import { MonteCarloTable } from "../../flows/MonteCarloTable";
import { KitButton, Segmented } from "../../ui/kit";
import { NumberInput } from "../controls";
import { formatCoins } from "../format";
import { Fact, LinkButton, ResultCard } from "../page/ResultCard";
import {
  clampSweepParams,
  DEFAULT_SWEEP_CYCLES,
  DEFAULT_SWEEP_SEEDS,
  MAX_SWEEP_CYCLES,
  MAX_SWEEP_SEEDS,
  MIN_SWEEP_CYCLES,
  MIN_SWEEP_SEEDS,
  scheduleEvery,
  summaryProfitPerDay,
  SWEEP_EVERY,
  sweepHoursPerCycle,
  sweepKey,
  sweepPoints,
  sweepSeeds,
  type SweepParams,
  type SweepRun,
} from "./sweep";
import { SweepPool, type SweepJob } from "./sweepPool";

interface SweepResult {
  key: string;
  params: SweepParams;
  runs: SweepRun[];
}

const PARAMS_KEY = "skyshards-sim-sweep";
function loadParams(): SweepParams {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PARAMS_KEY);
    if (raw) return clampSweepParams(JSON.parse(raw) as SweepParams);
  } catch {
    // Fall through to the defaults.
  }
  return { seeds: DEFAULT_SWEEP_SEEDS, cycles: DEFAULT_SWEEP_CYCLES };
}

/** "1m 20s" for an ETA. */
const eta = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/**
 * "Profit by online frequency" for the simulator: a Monte Carlo sweep. The scenario as it is, re-run
 * with its online schedule replaced by "every N cycles" for each leaderboard frequency, many seeds
 * each, in workers; every frequency shows the median, the average and the 90% range of profit per
 * day. Runs on a button press; a result whose scenario has since changed is marked stale.
 */
export const FrequencyPanel: React.FC<{
  /** The scenario the engine runs (profile applied). */
  scenario: Scenario;
  /** Normal profile: price a summary at Bazaar prices (profit per day); null when there are no prices yet. */
  priceSummary?: (s: RunSummary) => { perDay: number } | null;
  /** Switch the scenario to "online every N cycles" (shown beside the Forgiving line). */
  onUseEvery?: (n: number) => void;
  className?: string;
}> = ({ scenario, priceSummary, onUseEvery, className }) => {
  const [params, setParamsRaw] = useState<SweepParams>(loadParams);
  const setParams = (f: (p: SweepParams) => SweepParams) =>
    setParamsRaw((p) => {
      const next = f(p);
      try {
        localStorage.setItem(PARAMS_KEY, JSON.stringify(next));
      } catch {
        // Private mode: not remembered.
      }
      return next;
    });
  const [result, setResult] = useState<SweepResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const pool = useRef<SweepPool | null>(null);

  useEffect(() => () => pool.current?.cancel(), []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const key = useMemo(() => sweepKey(scenario, params), [scenario, params]);
  const stale = result !== null && result.key !== key;
  const ownEvery = scheduleEvery(scenario.settings.activity);
  const shown = selected ?? ownEvery ?? 1;

  const price = useMemo(() => (priceSummary ? (s: RunSummary) => priceSummary(s)?.perDay ?? summaryProfitPerDay(s) : summaryProfitPerDay), [priceSummary]);
  const points = useMemo(() => sweepPoints(result?.runs ?? [], price), [result, price]);
  const hours = useMemo(() => sweepHoursPerCycle(result?.runs ?? []), [result]);
  const forgiving = result ? slackFrom(points, shown) : null;
  const failures = (result?.runs ?? []).filter((r) => !r.ok);
  const noProfit = points.some((p) => p.profitPerDay !== null) && points.every((p) => p.profitPerDay === null || p.profitPerDay <= 0);
  const at = points.find((p) => p.every === shown)?.dist ?? null;

  const start = () => {
    const p = clampSweepParams(params);
    const seeds = sweepSeeds(scenario.settings.seed, p.seeds);
    // Seed-major: every frequency fills in together, so the chart is useful long before the end.
    const jobs: SweepJob[] = seeds.flatMap((seed) => SWEEP_EVERY.map((every) => ({ every, seed })));
    const runKey = sweepKey(scenario, p);
    const runs: SweepRun[] = [];
    pool.current ??= new SweepPool();
    setRunning(true);
    setStartedAt(performance.now());
    setNow(performance.now());
    setProgress(jobs.map(() => 0));
    setResult({ key: runKey, params: p, runs: [] });
    let flush: ReturnType<typeof setTimeout> | null = null;
    pool.current
      .run(scenario, p.cycles, jobs, {
        onProgress: (i, f) =>
          setProgress((prev) => {
            if (prev[i] === f) return prev;
            const next = [...prev];
            next[i] = f;
            return next;
          }),
        onRun: (_i, run) => {
          runs.push(run);
          // Batch re-renders: hundreds of runs may finish in quick succession.
          flush ??= setTimeout(() => {
            flush = null;
            setResult({ key: runKey, params: p, runs: [...runs] });
          }, 250);
        },
      })
      .then(() => {
        if (flush) clearTimeout(flush);
        setResult({ key: runKey, params: p, runs: [...runs] });
        setRunning(false);
      })
      .catch(() => {
        // Cancelled (Cancel, a new sweep or unmount).
        if (flush) clearTimeout(flush);
      });
  };

  const cancel = () => {
    pool.current?.cancel();
    setRunning(false);
  };

  const done = progress.length ? progress.reduce((s, f) => s + f, 0) / progress.length : 0;
  const totalRuns = SWEEP_EVERY.length * clampSweepParams(params).seeds;
  const elapsed = now - startedAt;
  const remaining = running && done > 0.02 && elapsed > 1500 ? (elapsed / done) * (1 - done) : null;

  // "Set online to every N": the point you picked, else the most profitable one, when it isn't the schedule already.
  const best = points.reduce<{ every: number; v: number } | null>((b, p) => (p.profitPerDay !== null && (!b || p.profitPerDay > b.v) ? { every: p.every, v: p.profitPerDay } : b), null);
  const useTarget = selected ?? best?.every ?? null;
  const activity = scenario.settings.activity;
  const canUse = !!onUseEvery && result !== null && !running && !stale && useTarget !== null && !(activity.kind === "everyN" && activity.n === useTarget);
  const num = "focus-ring h-7 rounded-control border border-line-control bg-surface-well px-2 text-right text-secondary tabular-nums text-fg hover:border-fg-meta disabled:opacity-50";
  const preset = SEED_PRESETS.find((s) => s.seeds === params.seeds)?.seeds;

  return (
    <ResultCard
      title="Profit by online frequency"
      className={className}
      hint={
        <>
          <p>
            A Monte Carlo test: your scenario as it is, re-run many times with different seeds and the online schedule set to every N cycles, for each frequency the
            leaderboard tests. The line is the median seed; the shaded band is where 90% of seeds land. Click a point to see its numbers and measure Forgiving from it.
          </p>
          <p>
            Seeds are the scenario&apos;s own and the ones after it, so a result is reproducible. More seeds give a steadier median and a truer range: 20 is a fair
            read, 50+ for a close call.
          </p>
          <p>
            Forgiving: how much of your profit you keep when you come back later than planned. It compares the points in the shaded Forgiving range (the selected
            frequency up to twice it) with the selected one, counting the slightly-late ones the most. 100% means being late costs nothing; a low % means the flow
            falls apart if you miss a login. Shows n/a at 12 cycles (nothing slower is simulated) or with no profit.
          </p>
        </>
      }
      hintWidth={360}
      meta={result && !running ? `${result.params.seeds} seeds × ${SWEEP_EVERY.length} frequencies · ${result.params.cycles.toLocaleString()} cycles${stale ? " · out of date" : ""}` : undefined}
      actions={
        <>
          <Segmented
            label="Seeds per frequency"
            value={preset !== undefined ? String(preset) : ""}
            onChange={(v) => setParams((p) => ({ ...p, seeds: Number(v) }))}
            disabled={running}
            options={SEED_PRESETS.map((s) => ({ value: String(s.seeds), label: s.label, title: s.hint }))}
          />
          <label className="flex items-center gap-1.5 text-secondary text-fg-meta" title={`Seeds per frequency (${MIN_SWEEP_SEEDS}–${MAX_SWEEP_SEEDS}): the scenario's seed and the ones after it`}>
            Seeds
            <NumberInput className={`${num} w-14`} value={params.seeds} min={MIN_SWEEP_SEEDS} max={MAX_SWEEP_SEEDS} integer disabled={running} onChange={(seeds) => setParams((p) => ({ ...p, seeds }))} />
          </label>
          <label className="mr-1 flex items-center gap-1.5 text-secondary text-fg-meta" title="Cycles each run simulates">
            Cycles
            <NumberInput className={`${num} w-16`} value={params.cycles} min={MIN_SWEEP_CYCLES} max={MAX_SWEEP_CYCLES} integer disabled={running} onChange={(cycles) => setParams((p) => ({ ...p, cycles }))} />
          </label>
          {running ? (
            <KitButton onClick={cancel}>
              <Square /> Cancel
            </KitButton>
          ) : (
            <KitButton variant={result && !stale ? "neutral" : "accent"} onClick={start}>
              {result ? <RotateCcw /> : <Play />}
              {result ? "Recompute" : "Compute"}
            </KitButton>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {running && (
          <div className="space-y-1.5" aria-live="polite">
            <div className="flex items-center gap-2 text-secondary text-fg-muted">
              <Loader2 className="size-3 animate-spin" />
              Simulating {result?.runs.length ?? 0} / {progress.length} runs · {Math.round(done * 100)}%{remaining !== null && ` · about ${eta(remaining)} left`}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full origin-left rounded-full bg-go transition-transform duration-200" style={{ transform: `scaleX(${done})` }} />
            </div>
          </div>
        )}

        {stale && !running && (
          <p className="text-secondary text-fg-muted">
            The scenario or settings changed since this was computed. <LinkButton onClick={start}>Recompute</LinkButton> to update it.
          </p>
        )}

        {result && !running && noProfit ? (
          <p className="text-body text-fg-meta">The scenario makes no profit at any frequency, so there is nothing to chart.</p>
        ) : result ? (
          <div className={stale && !running ? "space-y-4 opacity-60" : "space-y-4"}>
            {at && (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1" data-testid="sweep-stats">
                <Fact label={`Median · every ${shown}`} value={<span className="text-coin">{formatCoins(at.median)}</span>} suffix="/ day" />
                <Fact label="Average" value={formatCoins(at.mean)} suffix={at.n > 1 ? `± ${formatCoins(at.meanMargin)}` : undefined} title="Mean over the seeds, ± its 95% margin of error" />
                <Fact label={RANGE_LABEL} value={`${formatCoins(at.lo)} – ${formatCoins(at.hi)}`} title="5th to 95th percentile: 90% of seeds land here" />
                <Fact label="Worst / best" value={`${formatCoins(at.min)} / ${formatCoins(at.max)}`} tone={at.min < 0 ? "bad" : undefined} />
                <Fact label="Seeds" value={String(at.n)} suffix={at.lossShare > 0 ? `· ${Math.round(at.lossShare * 100)}% lose money` : undefined} />
              </div>
            )}
            <FrequencyChart
              points={points}
              selected={shown}
              hoursPerCycle={hours ?? 4}
              onSelect={setSelected}
              selectedLabel={selected === null && ownEvery !== null ? "your schedule" : "selected"}
              emptyText={running ? "Waiting for the first runs to finish..." : "No run finished."}
            />
            {!running && <MonteCarloTable points={points} selected={shown} onSelect={setSelected} hoursPerCycle={hours ?? undefined} />}
          </div>
        ) : (
          <p className="text-body text-fg-meta">
            Press Compute to simulate the scenario at every frequency: {totalRuns.toLocaleString()} runs ({SWEEP_EVERY.length} frequencies × {clampSweepParams(params).seeds}{" "}
            seeds) in the background, while the rest of the page stays usable.
          </p>
        )}

        {result && result.runs.length > 0 && !noProfit && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-secondary text-fg-meta">
            <span>
              Forgiving:{" "}
              {forgiving === null ? (
                <span className="text-fg-body">n/a</span>
              ) : (
                <>
                  you keep <span className="font-semibold tabular-nums text-fg">{percent(forgiving)}</span> of the median profit when you&apos;re late from every {shown}
                </>
              )}
              .
            </span>
            {canUse && <LinkButton onClick={() => onUseEvery!(useTarget!)}>Set online to every {useTarget}</LinkButton>}
          </p>
        )}

        {failures.length > 0 && (
          <details className="text-secondary text-problem">
            <summary className="cursor-pointer">
              {failures.length} run{failures.length === 1 ? "" : "s"} failed and {failures.length === 1 ? "is" : "are"} left out
            </summary>
            <ul className="mt-1 space-y-0.5">
              {failures.slice(0, 10).map((f) => (
                <li key={`${f.every}-${f.seed}`}>
                  every {f.every}, seed {f.seed}: {f.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </ResultCard>
  );
};
