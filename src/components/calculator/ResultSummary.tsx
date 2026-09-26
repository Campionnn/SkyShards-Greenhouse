import React, { useState } from "react";
import { CheckCircle2, AlertTriangle, Info, Database, Zap, Cpu, Cloud, ChevronDown, ChevronUp, SearchX, RotateCcw } from "lucide-react";
import { InfoHint } from "../ui";
import { CropImage } from "../shared";
import { getRarityTextColor } from "../../utilities";
import { useGreenhouseData } from "../../context";
import type { SolveResponse } from "../../types/greenhouse";
import type { SolveErrorInfo } from "../../services";
import {
  RESULT_STATUS_INFO,
  TONE_BADGE,
  cacheInfo,
  formatDuration,
  resultStatusInfo,
  type SolveRunMeta,
} from "./solverStatus";
import { useSolverDetailsOpen } from "./solverDetails";
import { DetailsToggle } from "./DetailsToggle";

// ---------------------------------------------------------------------------
// Explainer: what Optimal / Feasible / cached mean
// ---------------------------------------------------------------------------

/** Full glossary, reused by the "?" next to the status and the collapsible guide. */
export const StatusGlossary: React.FC<{ highlight?: string; cacheHit?: string | null }> = ({ highlight, cacheHit }) => (
  <div className="space-y-2">
    {(["OPTIMAL", "FEASIBLE", "CANCELLED"] as const).map((k) => {
      const info = RESULT_STATUS_INFO[k];
      return (
        <div key={k} className={`rounded px-2 py-1.5 ${highlight === k ? "bg-slate-700/60 ring-1 ring-slate-500/60" : ""}`}>
          <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded border mr-1.5 ${TONE_BADGE[info.tone]}`}>{info.label}</span>
          <span className="text-slate-300">{info.long}</span>
        </div>
      );
    })}
    <div className={`rounded px-2 py-1.5 ${cacheHit ? "bg-slate-700/60 ring-1 ring-slate-500/60" : ""}`}>
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border mr-1.5 bg-slate-600/30 border-slate-500/40 text-slate-300">
        <Database className="w-2.5 h-2.5" /> Cache
      </span>
      <span className="text-slate-300">
        Solves of setups people have used before are saved. A cached answer is never worse than a fresh solve: the
        solver either reuses a proven answer or starts from the saved layout and keeps improving it.
      </span>
    </div>
  </div>
);

const Badge: React.FC<{ className: string; children: React.ReactNode; title?: string }> = ({ className, children, title }) => (
  <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${className}`}>
    {children}
  </span>
);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Result summary: status + score always, everything else behind "Details"
// ---------------------------------------------------------------------------

const StatTile: React.FC<{ label: string; value: string; hint: string; tone?: string; sub?: string }> = ({ label, value, hint, tone = "text-slate-200", sub }) => (
  <div className="bg-slate-700/30 rounded-md px-3 py-2 min-w-0">
    <div className="flex items-center gap-1">
      <span className="text-[11px] uppercase tracking-wide text-slate-400 truncate">{label}</span>
      <InfoHint title={label}>
        <p>{hint}</p>
      </InfoHint>
    </div>
    <span className={`text-lg font-semibold leading-tight tabular-nums ${tone}`}>{value}</span>
    {sub && (
      <span className="block text-[11px] text-slate-500 truncate" title={sub}>
        {sub}
      </span>
    )}
  </div>
);

const SCORE_HINT =
  "What the solver maximizes: expected spawns per growth tick of your Maximize targets, plus the weighted value of the effects on every target spot. Higher is better. Only compare scores between solves with the same settings.";

export const ResultSummary: React.FC<{ result: SolveResponse; meta: SolveRunMeta | null; unlockedCount: number }> = ({
  result,
  meta,
  unlockedCount,
}) => {
  const [open, toggle] = useSolverDetailsOpen();
  const status = resultStatusInfo(result.status);
  const cache = cacheInfo(result.cache_hit);
  const Icon = result.status === "OPTIMAL" ? CheckCircle2 : result.status === "CANCELLED" ? AlertTriangle : Info;
  const iconColor = result.status === "OPTIMAL" ? "text-emerald-400" : result.status === "CANCELLED" ? "text-amber-400" : "text-sky-400";

  const hasScore = result.score !== undefined && result.score !== null;
  const mutationSpots = result.mutations?.length ?? 0;
  const cells =
    result.total_cells_used ??
    (result.placements || []).reduce((s, p) => s + p.size * p.size, 0) + (result.mutations || []).reduce((s, m) => s + m.size * m.size, 0);
  const effect = result.effect_value ?? null;
  // The budget the solver was given. Absent when the cache answered instantly.
  const budget = result.time_limit ?? null;

  return (
    <div className="mb-4 bg-slate-700/30 border border-slate-600/30 rounded-lg p-3">
      {/* Always visible: status, and the score */}
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
          <Badge className={TONE_BADGE[status.tone]}>{status.label}</Badge>
          {cache && (
            <InfoHint
              title={cache.label}
              trigger={
                <Badge className="bg-slate-600/30 border-slate-500/40 text-slate-300">
                  {cache.instant ? <Zap className="w-3 h-3 text-amber-300" /> : <Database className="w-3 h-3" />}
                  {cache.label}
                </Badge>
              }
            >
              <p>{cache.long}</p>
              <p className="text-slate-400">A cached answer is never worse than a fresh solve.</p>
            </InfoHint>
          )}
          <InfoHint title="What does this status mean?" width={360}>
            <StatusGlossary highlight={result.status} cacheHit={result.cache_hit} />
          </InfoHint>
        </div>
        {hasScore && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[11px] uppercase tracking-wide text-slate-400">Score</span>
            <span className="text-sm font-semibold tabular-nums text-emerald-400">{result.score!.toFixed(2)}</span>
            <InfoHint title="Score">
              <p>{SCORE_HINT}</p>
            </InfoHint>
          </span>
        )}
        <DetailsToggle open={open} onToggle={toggle} />
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-slate-600/40">
          <p className="text-xs text-slate-300 leading-relaxed">{status.short}</p>
          {cache?.instant && <p className="text-xs text-slate-400 mt-1 leading-relaxed">Answered from the cache, so no new search was needed.</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
            {result.expected_spawns_per_tick !== undefined && result.expected_spawns_per_tick !== null && (
              <StatTile
                label="Spawns / tick"
                value={result.expected_spawns_per_tick.toFixed(2)}
                hint="Expected mutation spawns per growth tick, summed over every target spot. Spots that can host several mutations split their roll between them."
              />
            )}
            {effect !== null && (
              <StatTile
                label="Effect value"
                value={`${effect >= 0 ? "+" : ""}${effect.toFixed(2)}`}
                tone={effect > 0 ? "text-sky-300" : effect < 0 ? "text-rose-300" : "text-slate-200"}
                hint="The part of the score that comes from your effect weights: good effects on the target spots add to it, bad effects subtract. Zero if you gave no effect weights."
              />
            )}
            <StatTile label="Mutation spots" value={String(mutationSpots)} hint="How many target mutation spots the layout contains, over all targets." />
            <StatTile
              label="Cells used"
              value={unlockedCount > 0 ? `${cells} / ${unlockedCount}` : String(cells)}
              sub={unlockedCount > 0 ? `${Math.round((cells / unlockedCount) * 100)}% of unlocked cells` : undefined}
              hint="Cells covered by crops and mutation spots, out of your unlocked cells. Crops that add nothing to the score are removed, so free cells are normal."
            />
            {budget !== null && (
              <StatTile
                label="Time budget"
                value={formatDuration(budget)}
                hint="How long the solver was given for this solve. It depends on grid size, number of targets and effects, or on the time limit you set for the local solver."
              />
            )}
            {meta?.serverSeconds !== null && meta?.serverSeconds !== undefined && (
              <StatTile
                label="Solve time"
                value={formatDuration(meta.serverSeconds)}
                hint="How long the solver actually ran. Shorter than the budget when it proved the answer optimal early or answered from the cache."
              />
            )}
          </div>

          {meta && (
            <p className="text-[11px] text-slate-500 mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {meta.endpoint && (
                <span className="flex items-center gap-1">
                  {meta.endpoint.local ? <Cpu className="w-3 h-3" /> : <Cloud className="w-3 h-3" />}
                  {meta.endpoint.local ? "Solved on this computer" : "Solved on the server"}
                </span>
              )}
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

// ---------------------------------------------------------------------------
// Mutations in the layout
// ---------------------------------------------------------------------------

/**
 * Count per mutation, with its share of the score. Fixed-count targets are
 * hard constraints, so they are always met exactly: no requested-vs-got.
 */
export const MutationList: React.FC<{ result: SolveResponse }> = ({ result }) => {
  const { getMutationDef } = useGreenhouseData();

  const counts = new Map<string, number>();
  const values = new Map<string, number>();
  for (const m of result.mutations || []) {
    counts.set(m.mutation, (counts.get(m.mutation) || 0) + 1);
    if (typeof m.value === "number") values.set(m.mutation, (values.get(m.mutation) || 0) + m.value);
  }

  if (counts.size === 0) {
    return <div className="text-center py-2 text-xs text-slate-500">No mutations in this layout</div>;
  }

  return (
    <div className="space-y-1.5">
      {Array.from(counts.entries()).map(([id, count]) => {
        const def = getMutationDef(id);
        const name = def?.name || id.replace(/_/g, " ");
        const value = values.get(id);
        return (
          <div key={id} className="flex items-center gap-2 bg-slate-700/30 rounded-md px-3 py-2">
            <CropImage cropId={id} cropName={name} size="xs" showFallback={false} />
            <span className={`text-sm truncate flex-1 min-w-0 ${def ? getRarityTextColor(def.rarity) : "text-slate-200"}`}>{name}</span>
            {value !== undefined && (
              <span className="text-[11px] text-slate-500 tabular-nums" title="This mutation's contribution to the score (spawn rate plus weighted effects)">
                score {value.toFixed(2)}
              </span>
            )}
            <span className="text-sm font-semibold tabular-nums text-emerald-400">x{count}</span>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Error / no solution
// ---------------------------------------------------------------------------

export const SolveErrorPanel: React.FC<{ error: SolveErrorInfo; onDismiss?: () => void; onRetry?: () => void }> = ({ error, onDismiss, onRetry }) => {
  const [showDetails, setShowDetails] = useState(false);
  const isNoSolution = error.kind === "no_solution" || error.kind === "infeasible_unique";
  const Icon = isNoSolution ? SearchX : AlertTriangle;
  const tone = isNoSolution ? "border-amber-500/40 bg-amber-500/10" : "border-red-500/40 bg-red-500/10";
  const iconTone = isNoSolution ? "text-amber-300" : "text-red-300";

  return (
    <div className={`mb-4 border rounded-lg p-3 ${tone}`} role="alert">
      <div className="flex items-start gap-2">
        <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconTone}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-100">{error.title}</div>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed break-words">{error.message}</p>
          {error.suggestions.length > 0 && (
            <>
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-3 mb-1">Things to try</div>
              <ul className="text-xs text-slate-300 list-disc pl-4 space-y-1">
                {error.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-2.5 py-1 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded text-emerald-200 flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" /> Try again
              </button>
            )}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="px-2.5 py-1 text-xs bg-slate-600/40 hover:bg-slate-600/60 border border-slate-600/40 rounded text-slate-300 cursor-pointer"
              >
                Dismiss
              </button>
            )}
            {error.details && (
              <button
                onClick={() => setShowDetails((s) => !s)}
                className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-0.5 cursor-pointer"
              >
                Technical details {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>
          {showDetails && error.details && (
            <pre className="mt-2 text-[10px] text-slate-400 bg-slate-900/60 rounded p-2 whitespace-pre-wrap break-words max-h-48 overflow-auto">
              {error.details}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
