/**
 * The result's headline and parts (C20, C22, C24):
 * - `ResultSummary`: one line: the score (large), the status pill (+ cache), cells used and spawns per
 *   tick; "Details" opens the rest (effect value, mutation spots, time budget, solve time, run meta).
 * - `MutationList`: count per mutation with its share of the score; hovering finds it on the grid.
 * - `SolveErrorPanel`: no layout / failed solve, with things to try, Try again and Dismiss.
 * - `StatusGlossary`: what Optimal / Feasible / Stopped early / cached mean.
 */
import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { InfoHint } from "../ui/InfoHint";
import { cn } from "../ui/cn";
import { KitButton, Pill } from "../ui/kit";
import { CropImage } from "../shared";
import { getRarityTextColor } from "../../utilities";
import { useGreenhouseData } from "../../context";
import type { SolveResponse } from "../../types/greenhouse";
import type { SolveErrorInfo } from "../../services";
import { focusKey, type PlacementFocus } from "../../hooks/usePlacementFocus";
import { focusItemClass } from "../grid/placementStyles";
import { RESULT_STATUS_INFO, TONE_PILL, cacheInfo, formatDuration, resultStatusInfo, type SolveRunMeta } from "./solverStatus";
import { useSolverDetailsOpen } from "./solverDetails";
import { DetailsToggle } from "./DetailsToggle";

/** Full glossary, reused by the "?" next to the status. */
export const StatusGlossary: React.FC<{ highlight?: string; cacheHit?: string | null }> = ({ highlight, cacheHit }) => (
  <div className="space-y-1.5">
    {(["OPTIMAL", "FEASIBLE", "CANCELLED"] as const).map((k) => {
      const info = RESULT_STATUS_INFO[k];
      return (
        <p key={k} className={cn("rounded-inner px-1.5 py-1", highlight === k && "bg-surface-hover")}>
          <Pill tone={TONE_PILL[info.tone]} className="mr-1.5">
            {info.label}
          </Pill>
          {info.long}
        </p>
      );
    })}
    <p className={cn("rounded-inner px-1.5 py-1", cacheHit && "bg-surface-hover")}>
      <Pill tone="neutral" className="mr-1.5">
        Cache
      </Pill>
      Solves of setups people have used before are saved. A cached answer is never worse than a fresh solve: the solver either reuses a proven answer or starts from the saved
      layout and keeps improving it.
    </p>
  </div>
);

/** One detail figure: label over value (no tiles). */
const Fact: React.FC<{ label: string; value: string; hint: string; sub?: string }> = ({ label, value, hint, sub }) => (
  <div className="min-w-0">
    <dt className="flex items-center gap-1 text-meta text-fg-meta">
      {label}
      <InfoHint title={label}>{hint}</InfoHint>
    </dt>
    <dd className="text-body font-semibold tabular-nums text-fg">
      {value}
      {sub && <span className="ml-1.5 text-meta font-normal text-fg-meta">{sub}</span>}
    </dd>
  </div>
);

const SCORE_HINT =
  "What the solver maximizes: expected spawns per growth tick of your Max targets, plus the weighted value of the effects on every target spot. Higher is better. Only compare scores between solves with the same settings.";

export const ResultSummary: React.FC<{ result: SolveResponse; meta: SolveRunMeta | null; unlockedCount: number; className?: string }> = ({ result, meta, unlockedCount, className }) => {
  const [open, toggle] = useSolverDetailsOpen();
  const status = resultStatusInfo(result.status);
  const cache = cacheInfo(result.cache_hit);
  const hasScore = result.score !== undefined && result.score !== null;
  const mutationSpots = result.mutations?.length ?? 0;
  const cells =
    result.total_cells_used ?? (result.placements || []).reduce((s, p) => s + p.size * p.size, 0) + (result.mutations || []).reduce((s, m) => s + m.size * m.size, 0);
  const effect = result.effect_value ?? null;
  // Time budget the solver got; absent when the cache answered instantly.
  const budget = result.time_limit ?? null;
  const spawns = result.expected_spawns_per_tick;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {hasScore && (
          <span className="flex items-baseline gap-1.5">
            <span className="text-hero tabular-nums text-fg">{result.score!.toFixed(2)}</span>
            <span className="text-body text-fg-muted">score</span>
            <InfoHint title="Score">{SCORE_HINT}</InfoHint>
          </span>
        )}
        <span className="flex items-center gap-1">
          <Pill tone={TONE_PILL[status.tone]} title={status.short}>
            {status.label}
          </Pill>
          {cache && (
            <Pill tone="neutral" title={`${cache.long} A cached answer is never worse than a fresh solve.`}>
              {cache.label}
            </Pill>
          )}
          <InfoHint title="What does this status mean?" width={360} label="What the status means">
            <StatusGlossary highlight={result.status} cacheHit={result.cache_hit} />
          </InfoHint>
        </span>
        <span className="text-secondary tabular-nums text-fg-meta">
          {unlockedCount > 0 ? `${cells}/${unlockedCount}` : cells} cells
          {spawns !== undefined && spawns !== null && ` · ${spawns.toFixed(1)} spawns/tick`}
        </span>
        <DetailsToggle open={open} onToggle={toggle} />
      </div>

      {open && (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          <p className="text-secondary text-fg-body">
            {status.short}
            {cache?.instant && " Answered from the cache, so no new search was needed."}
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
            {spawns !== undefined && spawns !== null && (
              <Fact
                label="Spawns / tick"
                value={spawns.toFixed(2)}
                hint="Expected mutation spawns per growth tick, summed over every target spot. Spots that can host several mutations split their roll between them."
              />
            )}
            {effect !== null && (
              <Fact
                label="Effect value"
                value={`${effect >= 0 ? "+" : ""}${effect.toFixed(2)}`}
                hint="The part of the score that comes from your effect weights: good effects on the target spots add to it, bad effects subtract. Zero if you gave no effect weights."
              />
            )}
            <Fact label="Mutation spots" value={String(mutationSpots)} hint="How many target mutation spots the layout contains, over all targets." />
            <Fact
              label="Cells used"
              value={unlockedCount > 0 ? `${cells} / ${unlockedCount}` : String(cells)}
              sub={unlockedCount > 0 ? `${Math.round((cells / unlockedCount) * 100)}%` : undefined}
              hint="Cells covered by crops and mutation spots, out of your unlocked cells. Crops that add nothing to the score are removed, so free cells are normal."
            />
            {budget !== null && (
              <Fact
                label="Time budget"
                value={formatDuration(budget)}
                hint="How long the solver was given for this solve. It depends on grid size, number of targets and effects, or on the time limit you set for the local solver."
              />
            )}
            {meta?.serverSeconds !== null && meta?.serverSeconds !== undefined && (
              <Fact
                label="Solve time"
                value={formatDuration(meta.serverSeconds)}
                hint="How long the solver actually ran. Shorter than the budget when it proved the answer optimal early or answered from the cache."
              />
            )}
          </dl>
          {meta && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-fg-meta">
              {meta.endpoint && <span>{meta.endpoint.local ? "Solved on this computer" : "Solved on the server"}</span>}
              {meta.queuedSeconds !== null && meta.queuedSeconds >= 1 && <span>Queued {formatDuration(meta.queuedSeconds)}</span>}
              <span>Total {formatDuration(meta.wallSeconds)}</span>
              {meta.solutionsFound !== null && meta.solutionsFound > 0 && (
                <span>
                  {meta.solutionsFound} improving layout{meta.solutionsFound === 1 ? "" : "s"} found
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Count per mutation with its share of the score. Fixed-count targets are hard constraints, so no
 * requested-vs-got is shown. With `focus`, hovering or clicking a row finds that mutation on the grid.
 */
export const MutationList: React.FC<{ result: SolveResponse; focus?: PlacementFocus }> = ({ result, focus }) => {
  const { getMutationDef } = useGreenhouseData();
  const counts = new Map<string, number>();
  const values = new Map<string, number>();
  for (const m of result.mutations || []) {
    counts.set(m.mutation, (counts.get(m.mutation) || 0) + 1);
    if (typeof m.value === "number") values.set(m.mutation, (values.get(m.mutation) || 0) + m.value);
  }
  if (counts.size === 0) return <p className="py-1 text-secondary text-fg-meta">No mutations in this layout</p>;
  return (
    <ul>
      {Array.from(counts.entries()).map(([id, count]) => {
        const def = getMutationDef(id);
        const name = def?.name || id.replace(/_/g, " ");
        const value = values.get(id);
        const key = focusKey("target", id);
        return (
          <li
            key={id}
            {...(focus ? focus.itemProps(key, name) : {})}
            className={cn("flex min-h-8 items-center gap-2 rounded-inner px-1.5 py-1 hover:bg-surface-hover", focus && focusItemClass(focus, key))}
          >
            <CropImage cropId={id} cropName={name} size="xs" showFallback={false} />
            <span className={cn("min-w-0 flex-1 truncate text-body", def ? getRarityTextColor(def.rarity) : "text-fg-body")}>{name}</span>
            {value !== undefined && (
              <span className="text-meta tabular-nums text-fg-meta" title="This mutation's contribution to the score (spawn rate plus weighted effects)">
                score {value.toFixed(2)}
              </span>
            )}
            <span className="w-10 text-right text-body font-semibold tabular-nums text-fg">×{count}</span>
          </li>
        );
      })}
    </ul>
  );
};

export const SolveErrorPanel: React.FC<{ error: SolveErrorInfo; onDismiss?: () => void; onRetry?: () => void }> = ({ error, onDismiss, onRetry }) => {
  const [showDetails, setShowDetails] = useState(false);
  const isNoSolution = error.kind === "no_solution" || error.kind === "infeasible_unique";
  return (
    <div className={cn("rounded-container border p-3", isNoSolution ? "border-warn/30 bg-warn/10" : "border-problem/30 bg-problem/10")} role="alert">
      <p className={cn("text-title", isNoSolution ? "text-warn" : "text-problem")}>{error.title}</p>
      <p className="mt-1 text-body break-words text-fg-body">{error.message}</p>
      {error.suggestions.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-secondary text-fg-body" aria-label="Things to try">
          {error.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onRetry && (
          <KitButton variant="primary" size="md" onClick={onRetry}>
            Try again
          </KitButton>
        )}
        {onDismiss && (
          <KitButton size="md" onClick={onDismiss}>
            Dismiss
          </KitButton>
        )}
        {error.details && (
          <button
            type="button"
            onClick={() => setShowDetails((s) => !s)}
            aria-expanded={showDetails}
            className="focus-ring inline-flex cursor-pointer items-center gap-0.5 rounded-inner text-secondary text-fg-muted hover:text-fg"
          >
            Technical details <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-(--duration-ink)", showDetails && "rotate-180")} />
          </button>
        )}
      </div>
      {showDetails && error.details && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-inner bg-surface-well p-2 text-meta break-words whitespace-pre-wrap text-fg-meta">{error.details}</pre>
      )}
    </div>
  );
};
