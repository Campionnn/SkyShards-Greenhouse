import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Loader2, Play, Square } from "lucide-react";
import type { RunSummary, Scenario } from "../../../simulator";
import { slackFrom, percent } from "../../../leaderboard/view";
import { FrequencyChart } from "../../flows/FrequencyChart";
import { InfoHint, Panel } from "../../ui";
import { NumberInput } from "../controls";
import { buttonClass, inputClass } from "../styles";
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
}> = ({ scenario, priceSummary }) => {
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

  return (
    <Panel
      title="Profit by online frequency"
      icon={<BarChart3 />}
      actions={
        result && result.runs.length > 0 ? (
          <span className="flex items-center gap-1 text-xs text-slate-300">
            <span className="font-medium text-emerald-300">{forgiving === null ? "n/a" : percent(forgiving)}</span> forgiving
            <InfoHint title="Forgiving" width={300}>
              How much of your profit you keep when you come back later than planned. It compares the points in the shaded Forgiving range (the
              selected frequency up to twice it) with the selected one, counting the slightly-late ones the most. 100% means being late costs nothing;
              a low % means the flow falls apart if you miss a login. Shows n/a at 12 cycles (nothing slower is simulated) or with no profit.
            </InfoHint>
          </span>
        ) : undefined
      }
      description="Your scenario as it is, re-run with the online schedule set to every N cycles for each frequency the leaderboard tests. Each point is the median over the seeds. Click a point to measure Forgiving from it."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Seeds per frequency: the scenario's seed and the ones after it">
            seeds
            <NumberInput
              className={`${inputClass} w-14 text-right`}
              value={params.seeds}
              min={MIN_SWEEP_SEEDS}
              max={MAX_SWEEP_SEEDS}
              integer
              disabled={running}
              onChange={(seeds) => setParams((p) => ({ ...p, seeds }))}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Cycles each run simulates">
            cycles
            <NumberInput
              className={`${inputClass} w-20 text-right`}
              value={params.cycles}
              min={MIN_SWEEP_CYCLES}
              max={MAX_SWEEP_CYCLES}
              integer
              disabled={running}
              onChange={(cycles) => setParams((p) => ({ ...p, cycles }))}
            />
          </label>
          <span className="text-xs text-slate-500">
            {totalRuns} runs ({SWEEP_EVERY.length} frequencies × {clampSweepParams(params).seeds} seeds)
          </span>
          <div className="ml-auto flex items-center gap-2">
            {running ? (
              <button type="button" className={buttonClass.neutral} onClick={cancel}>
                <Square className="h-3 w-3" />
                Cancel
              </button>
            ) : (
              <button type="button" className={buttonClass.primary} onClick={start}>
                <Play className="h-3 w-3" />
                {result ? "Recompute" : "Compute"}
              </button>
            )}
          </div>
        </div>

        {running && (
          <div className="space-y-1" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
              Simulating {result?.runs.length ?? 0} / {progress.length} runs · {Math.round(done * 100)}%
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-700/40">
              <div className="h-full rounded-full bg-emerald-400/70 transition-[width] duration-200" style={{ width: `${done * 100}%` }} />
            </div>
          </div>
        )}

        {stale && !running && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
            The scenario or settings changed since this was computed. Recompute to update it.
          </p>
        )}

        {result && !running && noProfit ? (
          <p className="text-xs text-slate-500">The scenario makes no profit at any frequency, so there is nothing to chart.</p>
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
          <p className="text-xs text-slate-500">
            Press Compute to simulate the scenario at every frequency. It runs {totalRuns} full simulations in the background; the rest of the page stays
            usable.
          </p>
        )}

        {failures.length > 0 && (
          <details className="text-xs text-red-300">
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
    </Panel>
  );
};
