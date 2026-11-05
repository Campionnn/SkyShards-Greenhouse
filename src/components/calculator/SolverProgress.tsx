/**
 * A running solve (C18): one headline ("Finding the max score"), where it runs, a thin progress bar
 * (the page's one progress element) and, behind Details, the steps and the live numbers.
 */
import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { InfoHint } from "../ui/InfoHint";
import { cn } from "../ui/cn";
import { Pill } from "../ui/kit";
import {
  bestSoFar,
  formatDuration,
  stageFromProgress,
  stageIndex,
  stageSteps,
  type SolveSession,
  type SolveStage,
} from "./solverStatus";
import { useSolverDetailsOpen } from "./solverDetails";
import { DetailsToggle } from "./DetailsToggle";

/** Re-render every second so elapsed/remaining time keeps ticking between polls. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** One live figure: label over value. */
const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="min-w-0" title={hint}>
    <dt className="truncate text-meta text-fg-meta">{label}</dt>
    <dd className="text-body font-semibold tabular-nums text-fg">{value}</dd>
  </div>
);

/** The steps, as a quiet row of labels: done ones ticked, the current one bold. */
const Steps: React.FC<{ stage: SolveStage; local: boolean; hasScore: boolean }> = ({ stage, local, hasScore }) => {
  const current = stageIndex(stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-secondary" aria-label="Solve steps">
      {stageSteps({ local, hasScore }).map((s) => {
        const idx = stageIndex(s.key);
        const done = idx < current;
        const active = idx === current;
        return (
          <li key={s.key} title={s.hint} aria-current={active ? "step" : undefined} className={cn("flex items-center gap-1", active ? "font-medium text-fg" : done ? "text-fg-muted" : "text-fg-meta")}>
            {done && <Check aria-hidden className="size-3" />}
            {s.label}
          </li>
        );
      })}
    </ol>
  );
};
export const SolverProgress: React.FC<{ session: SolveSession }> = ({ session }) => {
  const now = useNow(true);
  const { progress, endpoint } = session;
  const wall = (now - session.startedAt) / 1000;
  const cancelling = session.phase === "cancelling";

  const stage: SolveStage =
    session.phase === "submitting" ? "submitting" : session.phase === "queued" ? "queued" : stageFromProgress(progress);

  // Only fixed-count targets and no effects: nothing to score, so the solve is all tie-break.
  const hasScore = progress?.has_score !== false;
  const hasPriority = progress?.has_priority === true;
  const best = bestSoFar(progress);
  const solutions = progress?.solutions_found ?? 0;
  const pct = progress?.percentage ?? null;
  const serverElapsed = progress ? progress.elapsed_seconds : null;
  const elapsed = serverElapsed ?? wall;
  // Budget the solver got, reported once solving starts; until then (or from local solvers that
  // don't report it), the limit that was sent, if any.
  const budget = progress?.time_limit_seconds ?? session.timeLimit ?? null;
  const remaining = budget !== null && serverElapsed !== null ? Math.max(0, budget - serverElapsed) : null;
  const [detailsOpen, toggleDetails] = useSolverDetailsOpen();
  const sinceImprovement =
    session.lastImprovementAt !== null && serverElapsed !== null ? Math.max(0, serverElapsed - session.lastImprovementAt) : null;
  const running = stage === "maximizing" || stage === "tie_breaking";
  const tieBreakGoal = hasPriority ? "the fewest crop priority points, then the fewest cells used" : "the fewest cells used";

  const where = endpoint?.local ? "your computer" : "the SkyShards server";

  let headline: string;
  let detail: string;
  switch (stage) {
    case "submitting":
      headline = "Sending your setup";
      detail = endpoint ? `Submitting the job to ${where}.` : "Choosing a solver and submitting the job.";
      break;
    case "queued":
      headline = session.queuePosition ? `Waiting in queue: #${session.queuePosition}` : "Waiting in queue";
      detail =
        session.queuePosition && session.queuePosition > 1
          ? `${session.queuePosition - 1} solve${session.queuePosition - 1 === 1 ? "" : "s"} ahead of you. Each normally takes 30 to 90 seconds. The local solver has no queue.`
          : "You're next. Your solve starts as soon as the current one finishes.";
      break;
    case "building":
      headline = "Building the model";
      detail = "Turning your grid, targets, locks and effect weights into equations for the solver.";
      break;
    case "maximizing":
      headline = solutions > 0 ? "Finding the max score" : "Looking for a valid layout";
      detail =
        solutions > 0
          ? "The grid shows the best layout so far. The solver keeps looking for higher-scoring layouts while trying to prove that none exist."
          : "No valid layout yet. For hard or impossible targets this can take a while, and if none turns up before time runs out, the solve ends with \"No layout found\".";
      break;
    case "tie_breaking":
      headline = hasScore ? "Best score proven: tie-breaking" : "Tie-breaking";
      detail = hasScore
        ? `No layout can score higher than this one. Among the layouts that tie on score, the solver now looks for the one with ${tieBreakGoal}. Stopping now keeps the score.`
        : `Your targets are fixed counts, so there is no score to maximize. The solver looks for the layout with ${tieBreakGoal}.`;
      break;
  }
  if (cancelling) {
    headline = "Stopping...";
    detail = "Asked the solver to stop. The best layout found so far will be kept.";
  }

  const barPct =
    stage === "queued" && session.queueStart && session.queuePosition
      ? Math.max(5, ((session.queueStart - session.queuePosition + 1) / (session.queueStart + 1)) * 100)
      : running
        ? pct
        : null;


  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("text-title", cancelling ? "text-warn" : "text-fg")}>{headline}</span>
        <Pill tone="neutral" title={endpoint?.local ? "Running on the local solver" : "Running on api.skyshards.com"}>
          {endpoint ? (endpoint.local ? "Local" : "Server") : "…"}
        </Pill>
        <span className="ml-auto flex items-center gap-1 text-secondary tabular-nums text-fg-meta">
          {stage === "queued"
            ? session.queuePosition
              ? `position #${session.queuePosition}`
              : ""
            : running
              ? `${formatDuration(elapsed)}${budget !== null ? ` of ${formatDuration(budget)}` : ""}${pct !== null ? ` · ${Math.round(pct)}%` : ""}`
              : formatDuration(elapsed)}
          {stage !== "queued" && (
            <InfoHint title="What the progress bar means">
              <p>It shows whichever is further along: the share of the time budget used, or how close the best score is to the most the solver thinks might be possible.</p>
              <p>Solves normally use their whole time budget, so reaching 100% doesn't mean the answer is proven best.</p>
            </InfoHint>
          )}
        </span>
        <DetailsToggle open={detailsOpen} onToggle={toggleDetails} />
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={stage === "queued" ? "Queue" : "Solve progress"} aria-valuenow={barPct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        {barPct !== null && barPct !== undefined ? (
          <div
            className={cn("h-full w-full origin-left rounded-full transition-transform duration-500 motion-reduce:transition-none", cancelling ? "bg-warn" : "bg-fg-meta")}
            style={{ transform: `scaleX(${Math.min(100, barPct) / 100})` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-fg-meta motion-reduce:animate-none" />
        )}
      </div>

      {detailsOpen && (
        <div className="space-y-2">
          <p className="text-secondary text-fg-muted">{detail}</p>
          <Steps stage={stage} local={!!endpoint?.local} hasScore={hasScore} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Stat
              label="Elapsed"
              value={formatDuration(elapsed)}
              hint={serverElapsed !== null ? `Solver running for ${formatDuration(serverElapsed)}; ${formatDuration(wall)} since you pressed Solve` : "Time since you pressed Solve"}
            />
            {budget !== null && (
              <Stat
                label="Time budget"
                value={formatDuration(budget)}
                hint={
                  endpoint?.local && session.timeLimit !== null
                    ? "The time limit you set for the local solver"
                    : "How long the solver was given for this solve. It depends on grid size, number of targets and effects."
                }
              />
            )}
            {remaining !== null && running && <Stat label="Time left" value={`~${formatDuration(remaining)}`} hint="Remaining time budget" />}
            {running && <Stat label="Layouts found" value={solutions} hint="How many times the solver found a valid layout that beat its previous best" />}
            {running && hasScore && best.score !== undefined && <Stat label="Best score" value={best.score.toFixed(3)} hint="Score of the best layout so far (higher is better)" />}
            {stage === "maximizing" && hasScore && best.scoreBound !== undefined && best.score !== undefined && best.scoreBound > best.score && (
              <Stat
                label="Could reach"
                value={`≤ ${best.scoreBound.toFixed(3)}`}
                hint="The highest score the solver hasn't ruled out yet. The real best is usually the current score or close to it; once this drops to the current score, the score is proven best and tie-breaking starts."
              />
            )}
            {running && best.mutations !== undefined && <Stat label="Mutation spots" value={best.mutations} hint="Target mutation spots in the best layout so far" />}
            {running && hasPriority && best.priority !== undefined && (
              <Stat
                label="Priority points"
                value={best.priority}
                hint="Sum of the crop priorities of every crop placed (lower is better). The first tie-breaker between layouts with the same score."
              />
            )}
            {running && best.cells !== undefined && <Stat label="Cells used" value={best.cells} hint="Cells occupied by the best layout so far (lower is better). The last tie-breaker." />}
            {running && sinceImprovement !== null && (
              <Stat
                label="Last improved"
                value={`${formatDuration(sinceImprovement)} ago`}
                hint="Time since the solver last found a better layout. A long time without improvement usually means the current layout is already the best or close to it."
              />
            )}
          </dl>
          {progress?.current_activity && (
            <p className="text-meta break-words text-fg-meta" title="Latest message from the solver">
              Solver: {progress.current_activity}
            </p>
          )}
        </div>
      )}
    </div>
  );
};