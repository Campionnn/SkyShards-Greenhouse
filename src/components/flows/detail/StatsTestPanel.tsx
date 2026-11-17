import React, { useEffect, useMemo, useState } from "react";
import { FlaskConical, Play, RotateCcw, Square } from "lucide-react";
import type { FlowDetail } from "../../../leaderboard/api";
import { mcPoints, RANGE_LABEL, SEED_PRESETS } from "../../../leaderboard/montecarlo";
import { valueResult } from "../../../leaderboard/pricing";
import { parseSubmission, type CellKind } from "../../../leaderboard/rules";
import { enteredPlayerStats } from "../../../leaderboard/statsTest";
import { cycleHours, EVERY } from "../../../leaderboard/tiers";
import { boardOfCellKind, slackFrom } from "../../../leaderboard/view";
import type { FlowViewer } from "../../../hooks/useFlowViewer";
import { defaultGameData } from "../../../simulator";
import { formatCoins } from "../../simulator/format";
import { Fact, LinkButton } from "../../ui/Card";
import { InfoHint } from "../../ui/InfoHint";
import { KitButton, Segmented } from "../../ui/kit";
import { FrequencyChart } from "../FrequencyChart";
import { MonteCarloTable } from "../MonteCarloTable";
import type { DetailModel } from "./detailModel";
import { forgivingText, KIND_NAME } from "./detailText";
import { clearStatsTest, startStatsTest, statsTestKey, stopStatsTest, useStatsTest } from "./statsTestStore";

const DATA = defaultGameData();
type Span = "mine" | "all";

const eta = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/**
 * "Test with your stats" (the detail page's Test tab): the flow simulated in this browser under the
 * server's rules, but with exactly the stats the viewer entered (not the nearest tier, and no yield
 * scaling estimate), over many random seeds, as a Monte Carlo distribution of profit per day.
 */
export const StatsTestPanel: React.FC<{ detail: FlowDetail; viewer: FlowViewer; m: DetailModel; phone: boolean; onEditStats?: () => void }> = ({ detail, viewer, m, phone, onEditStats }) => {
  const [kind, setKind] = useState<CellKind>(viewer.cellKind);
  const [span, setSpan] = useState<Span>("mine");
  const [seeds, setSeeds] = useState(20);
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const parsed = useMemo(() => parseSubmission(detail.payload), [detail.payload]);
  const stats = useMemo(() => enteredPlayerStats(viewer.stats), [viewer.stats]);
  const everys = span === "all" ? [...EVERY] : [viewer.every];
  const key = statsTestKey(detail.id, kind, stats, everys, seeds, detail.cycles);
  const test = useStatsTest(detail.id);
  const stale = !!test && !test.running && test.key !== key;

  useEffect(() => {
    if (!test?.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [test?.running]);

  const board = boardOfCellKind(test?.kind ?? kind);
  const quotes = useMemo(() => (board === "normal" ? viewer.quotes : {}), [board, viewer.quotes]);
  const points = useMemo(
    () =>
      test
        ? mcPoints(
            test.outcomes.map((o, i) => ({
              every: test.jobs[i].every,
              value: o ? (o.ok && o.result ? valueResult(DATA, o.result, board, quotes, viewer.bazaar.pricing).profitPerDay : null) : NaN,
              effort: o?.result?.effort?.sessions ? o.result.effort.avg : null,
            })).filter((s) => !Number.isNaN(s.value)),
            test.everys,
          )
        : [],
    [test, board, quotes, viewer.bazaar.pricing],
  );
  const shownEvery = selected !== null && test?.everys.includes(selected) ? selected : test?.everys.includes(viewer.every) ? viewer.every : (test?.everys[0] ?? viewer.every);
  const at = points.find((p) => p.every === shownEvery)?.dist ?? null;
  const failures = test ? test.outcomes.filter((o) => o && !o.ok) : [];
  const done = test ? test.progress.reduce((s, f) => s + f, 0) / Math.max(1, test.progress.length) : 0;
  const finished = test ? test.outcomes.filter(Boolean).length : 0;
  const elapsed = test ? now - test.startedAt : 0;
  const remaining = test?.running && done > 0.02 && elapsed > 2000 ? (elapsed / done) * (1 - done) : null;
  // The leaderboard's own number for the same flow (the nearest tier, yield-scaled): a reference.
  const serverAt = m.kind === (test?.kind ?? kind) ? (m.points.find((p) => p.every === shownEvery)?.profitPerDay ?? null) : null;
  const forgiving = test && test.everys.length > 1 ? slackFrom(points, shownEvery) : null;

  if (!parsed.submission) return <p className="text-secondary text-problem">This flow can&apos;t be loaded for a test: {parsed.errors.join("; ")}</p>;

  const run = () => {
    setSelected(null);
    startStatsTest({ flowId: detail.id, key, submission: parsed.submission!, kind, stats, everys, seeds, cycles: detail.cycles });
  };
  const total = everys.length * seeds;
  const kinds: CellKind[] = detail.boards.includes("normal") && !detail.boards.includes("ironman") ? ["normal"] : ["ironman", "ironman_kit", "normal"];

  return (
    <section className="space-y-4" aria-label="Test with your stats" data-testid="stats-test">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <h2 className="text-title text-fg">Test with your stats</h2>
        <InfoHint title="Test with your stats" width={340}>
          <p>
            Simulates this flow in your browser with exactly the stats you entered, under the same rules as the server (empty start, default settings, the
            builder first for From nothing), over many random seeds. The leaderboard numbers are the nearest stat tier with your yield stats scaled in; this runs
            your real numbers.
          </p>
          <p className="mt-2">Each seed is one possible run. The median is a typical run; 90% of seeds land in the 90% range.</p>
        </InfoHint>
        <span className="min-w-0 text-secondary tabular-nums text-fg-meta">
          {viewer.stats.cropGrowth} Crop Growth · {viewer.stats.farmingFortune} Farming Fortune · online every {viewer.every}
        </span>
        {onEditStats && <LinkButton onClick={onEditStats}>Edit stats</LinkButton>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="stats-test-options">
        <Segmented label="Number" value={kind} onChange={setKind} disabled={test?.running} options={kinds.map((k) => ({ value: k, label: phone ? KIND_NAME[k].replace("With the starting items", "With items") : KIND_NAME[k] }))} />
        <Segmented
          label="Frequencies"
          value={span}
          onChange={setSpan}
          disabled={test?.running}
          options={[
            { value: "mine", label: `Every ${viewer.every}`, title: "Only your login frequency" },
            { value: "all", label: "Every frequency", title: `${EVERY.join(", ")} cycles: ${EVERY.length}× the runs` },
          ]}
        />
        <Segmented label="Seeds" value={String(seeds)} onChange={(v) => setSeeds(Number(v))} disabled={test?.running} options={SEED_PRESETS.map((s) => ({ value: String(s.seeds), label: `${s.seeds}`, title: s.hint }))} />
        <span className="text-secondary tabular-nums text-fg-meta">{total.toLocaleString()} runs</span>
        <span className="flex-1" />
        {test?.running ? (
          <KitButton variant="danger" onClick={stopStatsTest}>
            <Square /> Stop
          </KitButton>
        ) : (
          <KitButton variant={test && !stale ? "neutral" : "accent"} onClick={run}>
            {test ? <RotateCcw /> : <Play />} {test ? "Test again" : "Run test"}
          </KitButton>
        )}
      </div>

      {test?.running && (
        <div className="space-y-1.5" aria-live="polite">
          <p className="text-secondary tabular-nums text-fg-muted">
            {finished} / {test.jobs.length} runs · {Math.round(done * 100)}%{remaining !== null && ` · about ${eta(remaining)} left`}
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
            <div className="h-full origin-left rounded-full bg-go transition-transform duration-200" style={{ transform: `scaleX(${done})` }} />
          </div>
        </div>
      )}
      {stale && (
        <p className="text-secondary text-warn">
          Your stats or the options changed since this test. <LinkButton onClick={run}>Test again</LinkButton> for current numbers.
        </p>
      )}
      {test?.error && !test.running && test.error !== "Stopped." && <p className="text-secondary text-problem">{test.error}</p>}

      {!test ? (
        <div className="grid place-items-center rounded-control border border-dashed border-line-strong px-6 py-8 text-center">
          <FlaskConical className="size-5 text-fg-meta" aria-hidden />
          <div className="mt-2 text-body text-fg-body">Not tested yet</div>
          <p className="mt-1 max-w-md text-secondary text-fg-meta">
            Run the flow with your stats over {seeds} seeds{span === "all" ? " at every frequency" : ""}. It runs in the background; you can keep reading the other tabs.
          </p>
        </div>
      ) : (
        <div className={stale ? "space-y-4 opacity-60" : "space-y-4"}>
          {at ? (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1" data-testid="stats-test-numbers">
              <Fact label={`Median · every ${shownEvery}`} value={<span className="text-coin">{formatCoins(at.median)}</span>} suffix="/ day" />
              <Fact label="Average" value={formatCoins(at.mean)} suffix={at.n > 1 ? `± ${formatCoins(at.meanMargin)}` : undefined} title="Mean over the seeds, ± its 95% margin of error" />
              <Fact label={RANGE_LABEL} value={`${formatCoins(at.lo)} – ${formatCoins(at.hi)}`} title="5th to 95th percentile: 90% of seeds land here" />
              <Fact label="Worst / best" value={`${formatCoins(at.min)} / ${formatCoins(at.max)}`} tone={at.min < 0 ? "bad" : undefined} />
              {serverAt !== null && (
                <Fact
                  label="Leaderboard estimate"
                  value={formatCoins(serverAt)}
                  suffix={at.median !== 0 && serverAt !== 0 ? `· yours ${at.median >= serverAt ? "+" : "−"}${Math.abs(Math.round(((at.median - serverAt) / Math.abs(serverAt)) * 100))}%` : undefined}
                  title="The server's number for the nearest stat tier, scaled to your yield stats"
                />
              )}
              {forgiving !== null && <Fact label="Forgiving" value={forgivingText(forgiving)} title="How much of the median profit you keep when you log in later than planned" />}
            </div>
          ) : (
            !test.running && <p className="text-secondary text-fg-meta">No seed finished.</p>
          )}
          {test.everys.length > 1 && points.some((p) => p.profitPerDay !== null) && (
            <FrequencyChart points={points} selected={shownEvery} hoursPerCycle={cycleHours(viewer.stats)} onSelect={setSelected} selectedLabel={selected === null ? "yours" : "selected"} height={phone ? 150 : 200} />
          )}
          {points.some((p) => p.dist) && <MonteCarloTable points={points} selected={shownEvery} onSelect={test.everys.length > 1 ? setSelected : undefined} hoursPerCycle={cycleHours(viewer.stats)} />}
          {failures.length > 0 && (
            <details className="text-secondary text-problem">
              <summary className="cursor-pointer">
                {failures.length} seed{failures.length === 1 ? "" : "s"} failed and {failures.length === 1 ? "is" : "are"} left out
              </summary>
              <ul className="mt-1 space-y-0.5">
                {failures.slice(0, 10).map((f, i) => (
                  <li key={i} className="break-words">
                    every {f!.every}: {f!.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!test.running && (
            <LinkButton onClick={clearStatsTest} className="text-meta">
              Clear result
            </LinkButton>
          )}
        </div>
      )}
    </section>
  );
};
