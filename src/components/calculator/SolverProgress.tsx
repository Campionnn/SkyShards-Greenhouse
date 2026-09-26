import React, { useEffect, useState } from "react";
import { Loader2, Clock, Cpu, Cloud, Check, Sparkles, TrendingUp, Target, Timer, Hourglass, Scale, LayoutGrid } from "lucide-react";
import { InfoHint } from "../ui";
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

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string; tone?: string }> = ({
  icon,
  label,
  value,
  hint,
  tone = "text-slate-100",
}) => (
  <div className="bg-slate-800/60 border border-slate-700/50 rounded-md px-2.5 py-1.5 min-w-0" title={hint}>
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400">
      <span className="[&>svg]:w-3 [&>svg]:h-3 flex-shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
    <div className={`text-sm font-semibold tabular-nums leading-tight mt-0.5 ${tone}`}>{value}</div>
  </div>
);

/**
 * Step tracker. Labels sit under the dots with an equal-width column per
 * step, so they never compete with the connector lines for room.
 */
const Stepper: React.FC<{ stage: SolveStage; local: boolean; hasScore: boolean }> = ({ stage, local, hasScore }) => {
  const current = stageIndex(stage);
  const steps = stageSteps({ local, hasScore });
  return (
    <ol className="flex mb-3" aria-label="Solve steps">
      {steps.map((s, i) => {
        const idx = stageIndex(s.key);
        const done = idx < current;
        const active = idx === current;
        return (
          <li key={s.key} className="relative flex-1 min-w-0 flex flex-col items-center" title={s.hint}>
            {/* connector to the previous step */}
            {i > 0 && (
              <span
                className={`absolute top-2 right-1/2 w-full h-px ${done || active ? "bg-emerald-500/60" : "bg-slate-700"}`}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 flex items-center justify-center w-4 h-4 rounded-full text-[9px] border ${
                done
                  ? "bg-emerald-500 border-emerald-400 text-white"
                  : active
                    ? "bg-slate-900 border-emerald-400 text-emerald-300"
                    : "bg-slate-900 border-slate-600 text-slate-500"
              }`}
            >
              {done ? <Check className="w-2.5 h-2.5" /> : active ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> : i + 1}
            </span>
            <span
              className={`mt-1 px-0.5 text-[11px] leading-tight text-center ${
                active ? "text-emerald-300 font-medium" : done ? "text-slate-300" : "text-slate-500"
              }`}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

/**
 * Live status of a running solve: where it is, how it is going, and what
 * every number means. Nothing is truncated; long activity text wraps.
 */
export const SolverProgress: React.FC<{ session: SolveSession }> = ({ session }) => {
  const now = useNow(true);
  const { progress, endpoint } = session;
  const wall = (now - session.startedAt) / 1000;
  const cancelling = session.phase === "cancelling";

  const stage: SolveStage =
    session.phase === "submitting" ? "submitting" : session.phase === "queued" ? "queued" : stageFromProgress(progress);

  // Only fixed-count targets and no effects: nothing to score, the solve is all tie-break.
  const hasScore = progress?.has_score !== false;
  const hasPriority = progress?.has_priority === true;
  const best = bestSoFar(progress);
  const solutions = progress?.solutions_found ?? 0;
  const pct = progress?.percentage ?? null;
  const serverElapsed = progress ? progress.elapsed_seconds : null;
  const elapsed = serverElapsed ?? wall;
  // The budget the solver actually got: reported by the API once solving
  // starts; before that (or on older local solvers) the limit we sent, if any.
  const budget = progress?.time_limit_seconds ?? session.timeLimit ?? null;
  const remaining = budget !== null && serverElapsed !== null ? Math.max(0, budget - serverElapsed) : null;
  const [detailsOpen, toggleDetails] = useSolverDetailsOpen();
  const sinceImprovement =
    session.lastImprovementAt !== null && serverElapsed !== null ? Math.max(0, serverElapsed - session.lastImprovementAt) : null;
  const running = stage === "maximizing" || stage === "tie_breaking";
  const tieBreakGoal = hasPriority ? "the fewest crop priority points, then the fewest cells used" : "the fewest cells used";

  const where = endpoint?.local ? "your computer" : "the SkyShards server";
  const WhereIcon = endpoint?.local ? Cpu : Cloud;

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
    <div className="mb-4 bg-slate-700/30 border border-slate-600/30 rounded-lg p-3" aria-live="polite">
      {/* Title row */}
      <div className={`flex items-start gap-2 ${detailsOpen ? "mb-3" : "mb-2"}`}>
        {stage === "queued" ? (
          <Clock className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        ) : (
          <Loader2 className={`w-4 h-4 animate-spin mt-0.5 flex-shrink-0 ${cancelling ? "text-amber-400" : "text-emerald-400"}`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-100">{headline}</div>
          {detailsOpen && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{detail}</p>}
        </div>
        <span
          className="flex items-center gap-1 text-[11px] text-slate-400 flex-shrink-0 bg-slate-800/60 rounded px-1.5 py-0.5"
          title={endpoint?.local ? "Running on the local solver" : "Running on api.skyshards.com"}
        >
          <WhereIcon className="w-3 h-3" />
          {endpoint ? (endpoint.local ? "Local" : "Server") : "..."}
        </span>
        <DetailsToggle open={detailsOpen} onToggle={toggleDetails} className="mt-0.5" />
      </div>

      {detailsOpen && <Stepper stage={stage} local={!!endpoint?.local} hasScore={hasScore} />}

      {/* Progress bar */}
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          {stage === "queued" ? "Queue" : "Progress"}
          {stage !== "queued" && detailsOpen && (
            <InfoHint title="What the progress bar means">
              <p>
                It shows whichever is further along: the share of the time budget used, or how close the best score is to
                the most the solver thinks might be possible.
              </p>
              <p>Solves normally use their whole time budget, so reaching 100% doesn't mean the answer is proven best.</p>
            </InfoHint>
          )}
        </span>
        <span className="tabular-nums text-right">
          {stage === "queued"
            ? session.queuePosition
              ? `position #${session.queuePosition}`
              : ""
            : running
              ? `${formatDuration(elapsed)}${budget !== null ? ` of ${formatDuration(budget)}` : ""}${pct !== null ? ` · ${Math.round(pct)}%` : ""}`
              : formatDuration(elapsed)}
        </span>
      </div>
      <div
        className={`h-2 bg-slate-800 rounded-full overflow-hidden ${detailsOpen ? "mb-3" : ""}`}
        role="progressbar"
        aria-valuenow={barPct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {barPct !== null && barPct !== undefined ? (
          <div
            className={`h-full transition-all duration-500 ${stage === "queued" ? "bg-blue-500" : cancelling ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${Math.min(100, barPct)}%` }}
          />
        ) : (
          <div
            className={`h-full w-1/3 rounded-full animate-[indeterminate_1.4s_ease-in-out_infinite] ${stage === "queued" ? "bg-blue-500/70" : "bg-emerald-500/70"}`}
          />
        )}
      </div>

      {detailsOpen && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            <Stat
              icon={<Timer />}
              label="Elapsed"
              value={formatDuration(elapsed)}
              hint={
                serverElapsed !== null
                  ? `Solver running for ${formatDuration(serverElapsed)}; ${formatDuration(wall)} since you pressed Solve`
                  : "Time since you pressed Solve"
              }
            />
            {budget !== null && (
              <Stat
                icon={<Hourglass />}
                label="Time budget"
                value={formatDuration(budget)}
                hint={
                  endpoint?.local && session.timeLimit !== null
                    ? "The time limit you set for the local solver"
                    : "How long the solver was given for this solve. It depends on grid size, number of targets and effects."
                }
              />
            )}
            {remaining !== null && running && (
              <Stat icon={<Hourglass />} label="Time left" value={`~${formatDuration(remaining)}`} hint="Remaining time budget" />
            )}
            {running && (
              <Stat
                icon={<Sparkles />}
                label="Layouts found"
                value={solutions}
                tone={solutions > 0 ? "text-emerald-300" : "text-slate-400"}
                hint="How many times the solver found a valid layout that beat its previous best"
              />
            )}
            {running && hasScore && best.score !== undefined && (
              <Stat
                icon={<TrendingUp />}
                label="Best score"
                value={best.score.toFixed(3)}
                tone="text-emerald-300"
                hint="Score of the best layout so far (higher is better)"
              />
            )}
            {stage === "maximizing" && hasScore && best.scoreBound !== undefined && best.score !== undefined && best.scoreBound > best.score && (
              <Stat
                icon={<TrendingUp />}
                label="Could reach"
                value={`≤ ${best.scoreBound.toFixed(3)}`}
                hint="The highest score the solver hasn't ruled out yet. The real best is usually the current score or close to it; once this drops to the current score, the score is proven best and tie-breaking starts."
              />
            )}
            {running && best.mutations !== undefined && (
              <Stat icon={<Target />} label="Mutation spots" value={best.mutations} hint="Target mutation spots in the best layout so far" />
            )}
            {running && hasPriority && best.priority !== undefined && (
              <Stat
                icon={<Scale />}
                label="Priority points"
                value={best.priority}
                hint="Sum of the crop priorities of every crop placed (lower is better). The first tie-breaker between layouts with the same score."
              />
            )}
            {running && best.cells !== undefined && (
              <Stat
                icon={<LayoutGrid />}
                label="Cells used"
                value={best.cells}
                hint="Cells occupied by the best layout so far (lower is better). The last tie-breaker."
              />
            )}
            {running && sinceImprovement !== null && (
              <Stat
                icon={<Clock />}
                label="Last improved"
                value={`${formatDuration(sinceImprovement)} ago`}
                hint="Time since the solver last found a better layout. A long time without improvement usually means the current layout is already the best or close to it."
              />
            )}
          </div>

          {/* Raw activity, in full */}
          {progress?.current_activity && (
            <p className="mt-2 text-[11px] text-slate-500 break-words" title="Latest message from the solver">
              <span className="text-slate-400">Solver:</span> {progress.current_activity}
            </p>
          )}
        </>
      )}
    </div>
  );
};
