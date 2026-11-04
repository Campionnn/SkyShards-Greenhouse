import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, RotateCcw, Square } from "lucide-react";
import type { RunSummary, Scenario } from "../../../simulator";
import { slackFrom, percent } from "../../../leaderboard/view";
import { FrequencyChart } from "../../flows/FrequencyChart";
import { KitButton } from "../../ui/kit";
import { NumberInput } from "../controls";
import { LinkButton, ResultCard } from "../page/ResultCard";
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

/**
 * "Profit by online frequency" for the simulator: the scenario as it is, re-run with its online
 * schedule replaced by "every N cycles" for each leaderboard frequency, a few seeds each, in
 * workers. Runs on a button press; a result whose scenario has since changed is marked stale.
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
  const [params, setParams] = useState<SweepParams>({ seeds: DEFAULT_SWEEP_SEEDS, cycles: DEFAULT_SWEEP_CYCLES });
  const [result, setResult] = useState<SweepResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const pool = useRef<SweepPool | null>(null);

  useEffect(() => () => pool.current?.cancel(), []);

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

  const start = () => {
    const p = clampSweepParams(params);
    const seeds = sweepSeeds(scenario.settings.seed, p.seeds);
    const jobs: SweepJob[] = SWEEP_EVERY.flatMap((every) => seeds.map((seed) => ({ every, seed })));
    const runKey = sweepKey(scenario, p);
    const runs: SweepRun[] = [];
    pool.current ??= new SweepPool();
    setRunning(true);
    setProgress(jobs.map(() => 0));
    setResult({ key: runKey, params: p, runs: [] });
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
          setResult({ key: runKey, params: p, runs: [...runs] });
        },
      })
      .then(() => setRunning(false))
      .catch(() => {
        // Cancelled (Cancel, a new sweep or unmount).
      });
  };

  const cancel = () => {
    pool.current?.cancel();
    setRunning(false);
  };

  const done = progress.length ? progress.reduce((s, f) => s + f, 0) / progress.length : 0;
  const totalRuns = SWEEP_EVERY.length * clampSweepParams(params).seeds;

  // "Set online to every N": the point you picked, else the most profitable one, when it isn't the schedule already.
  const best = points.reduce<{ every: number; v: number } | null>((b, p) => (p.profitPerDay !== null && (!b || p.profitPerDay > b.v) ? { every: p.every, v: p.profitPerDay } : b), null);
  const useTarget = selected ?? best?.every ?? null;
  const activity = scenario.settings.activity;
  const canUse = !!onUseEvery && result !== null && !running && !stale && useTarget !== null && !(activity.kind === "everyN" && activity.n === useTarget);
  const num = "h-7 rounded-lg border border-slate-700/60 bg-slate-950/50 px-2 text-right text-[12.5px] tabular-nums text-slate-100 transition-colors duration-150 focus:border-emerald-500/60 focus:outline-none disabled:opacity-50";

  return (
    <ResultCard
      title="Profit by online frequency"
      className={className}
      hint={
        <>
          <p>
            Your scenario as it is, re-run with the online schedule set to every N cycles for each frequency the leaderboard tests. Each point is the median over the
            seeds. Click a point to measure Forgiving from it.
          </p>
          <p>
            Forgiving: how much of your profit you keep when you come back later than planned. It compares the points in the shaded Forgiving range (the selected
            frequency up to twice it) with the selected one, counting the slightly-late ones the most. 100% means being late costs nothing; a low % means the flow
            falls apart if you miss a login. Shows n/a at 12 cycles (nothing slower is simulated) or with no profit.
          </p>
        </>
      }
      hintWidth={340}
      meta={result && !running ? `${result.params.seeds} seeds · ${result.params.cycles.toLocaleString()} cycles${stale ? " · out of date" : ""}` : undefined}
      actions={
        <>
          <label className="flex items-center gap-1.5 text-[12px] text-slate-500" title="Seeds per frequency: the scenario's seed and the ones after it">
            Seeds
            <NumberInput className={`${num} w-11`} value={params.seeds} min={MIN_SWEEP_SEEDS} max={MAX_SWEEP_SEEDS} integer disabled={running} onChange={(seeds) => setParams((p) => ({ ...p, seeds }))} />
          </label>
          <label className="mr-1 flex items-center gap-1.5 text-[12px] text-slate-500" title="Cycles each run simulates">
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
            <div className="flex items-center gap-2 text-[12px] text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin text-slate-300" />
              Simulating {result?.runs.length ?? 0} / {progress.length} runs · {Math.round(done * 100)}%
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-slate-400/10">
              <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-200" style={{ width: `${done * 100}%` }} />
            </div>
          </div>
        )}

        {stale && !running && (
          <p className="text-[12px] text-slate-400">
            The scenario or settings changed since this was computed.{" "}
            <LinkButton onClick={start}>Recompute</LinkButton> to update it.
          </p>
        )}

        {result && !running && noProfit ? (
          <p className="text-[12.5px] text-slate-500">The scenario makes no profit at any frequency, so there is nothing to chart.</p>
        ) : result ? (
          <div className={stale && !running ? "opacity-60" : undefined}>
            <FrequencyChart
              points={points}
              selected={shown}
              hoursPerCycle={hours ?? 4}
              onSelect={setSelected}
              selectedLabel={selected === null && ownEvery !== null ? "your schedule" : "selected"}
              emptyText={running ? "Waiting for the first runs to finish..." : "No run finished."}
            />
          </div>
        ) : (
          <p className="text-[12.5px] text-slate-500">
            Press Compute to simulate the scenario at every frequency: {totalRuns} runs ({SWEEP_EVERY.length} frequencies × {clampSweepParams(params).seeds} seeds) in the background, while the rest of the page stays usable.
          </p>
        )}

        {result && result.runs.length > 0 && !noProfit && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
            <span>
              Online every N cycles. Forgiving:{" "}
              {forgiving === null ? (
                <span className="text-slate-300">n/a</span>
              ) : (
                <>
                  you keep <span className="font-semibold tabular-nums text-slate-200">{percent(forgiving)}</span> of the profit when you're late from every {shown}
                </>
              )}
              .
            </span>
            {canUse && <LinkButton onClick={() => onUseEvery!(useTarget!)}>Set online to every {useTarget}</LinkButton>}
          </p>
        )}

        {failures.length > 0 && (
          <details className="text-[12px] text-red-300">
            <summary className="cursor-pointer">
              {failures.length} run{failures.length === 1 ? "" : "s"} failed and {failures.length === 1 ? "is" : "are"} left out
            </summary>
            <ul className="mt-1 space-y-0.5 text-red-300/80">
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