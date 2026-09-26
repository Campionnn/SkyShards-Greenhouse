/**
 * Plain-language meaning of every status the solver reports, shared by the
 * live progress panel and the result header. Players regularly mistake
 * "Feasible" for "bad" and "cached" for "stale"; these texts are the fix.
 */
import type { JobProgress } from "../../types/greenhouse";
import type { ResolvedEndpoint } from "../../services/solverEndpoint";

/** Everything the page knows about a solve that is still running. */
export interface SolveSession {
  phase: "submitting" | "queued" | "running" | "cancelling";
  /** Date.now() when Solve was pressed. */
  startedAt: number;
  endpoint: ResolvedEndpoint | null;
  queuePosition: number | null;
  /** Highest queue position seen, to show queue progress. */
  queueStart: number | null;
  progress: JobProgress | null;
  /** Time limit sent to the local solver (null = solver default / public server). */
  timeLimit: number | null;
  /** Server elapsed seconds when the best layout last improved. */
  lastImprovementAt: number | null;
}

/** Facts about a finished solve, for the result header. */
export interface SolveRunMeta {
  endpoint: ResolvedEndpoint | null;
  /** Seconds the solver ran on the server. */
  serverSeconds: number | null;
  queuedSeconds: number | null;
  /** Seconds from pressing Solve to the answer. */
  wallSeconds: number;
  /** Layouts the solver went through, from the last progress update. */
  solutionsFound: number | null;
}

export type Tone = "emerald" | "sky" | "amber" | "rose" | "slate" | "violet";

export interface StatusInfo {
  label: string;
  tone: Tone;
  /** One line, shown next to the badge. */
  short: string;
  /** A few sentences, shown in the tooltip / explainer. */
  long: string;
}

export const RESULT_STATUS_INFO: Record<string, StatusInfo> = {
  OPTIMAL: {
    label: "Optimal",
    tone: "emerald",
    short: "Proven best: no layout scores higher for these settings.",
    long:
      "The solver checked every possibility and proved that no layout can score higher with your grid, targets, priorities and effect weights. Solving again will not find anything better.",
  },
  FEASIBLE: {
    label: "Feasible",
    tone: "sky",
    short: "A valid layout. It is usually the best one, but that wasn't proven in time.",
    long:
      "\"Feasible\" does not mean bad. The layout is valid and is the best the solver found within its time budget, which is normally the best there is. The solver just ran out of time before it could prove that nothing scores higher; that proof is often far harder than finding the layout. Most solves end as Feasible. The server keeps working on popular setups in the background, so solving again later (or on the local solver with a longer time limit) can sometimes improve it.",
  },
  CANCELLED: {
    label: "Stopped early",
    tone: "amber",
    short: "You stopped the solve; this is the best layout found up to that point.",
    long:
      "You pressed Stop, so this is the best layout found up to that moment. It is valid, but a full-length solve may find a better one.",
  },
  SOLVING: {
    label: "Solving",
    tone: "violet",
    short: "Live preview of the best layout found so far. It updates as the solver improves it.",
    long:
      "The solver is still running. The grid shows the best layout found so far and updates whenever a better one turns up. Stats like score appear once the solve finishes.",
  },
};

export function resultStatusInfo(status: string | undefined | null): StatusInfo {
  const key = (status || "").toUpperCase();
  return (
    RESULT_STATUS_INFO[key] ?? {
      label: key ? key.charAt(0) + key.slice(1).toLowerCase() : "Unknown",
      tone: "slate",
      short: "The solver returned an unusual status.",
      long: `The solver reported status "${status}". The layout shown is what it returned.`,
    }
  );
}

export interface CacheInfo {
  label: string;
  /** True when the answer came back instantly without a new search. */
  instant: boolean;
  long: string;
}

export const CACHE_INFO: Record<string, CacheInfo> = {
  exact_optimal: {
    label: "From cache (proven optimal)",
    instant: true,
    long:
      "Someone already solved this exact setup and it was proven optimal, so the saved answer came back instantly. It is exactly as good as a fresh solve.",
  },
  resume_stopped: {
    label: "From cache (best known)",
    instant: true,
    long:
      "This exact setup has been solved several times already and later solves stopped improving on it, so the best known layout came back instantly instead of searching again.",
  },
  resume: {
    label: "Continued from cache",
    instant: false,
    long:
      "This exact setup was solved before. Instead of starting from scratch, the solver continued from that earlier layout and what it had already proven, so this result is at least as good as the saved one.",
  },
  warm_start: {
    label: "Head start from cache",
    instant: false,
    long:
      "A layout saved from a similar setup was used as a starting point. The solve still ran in full; the head start just gets it to a good answer sooner.",
  },
  priority_variant: {
    label: "Head start from cache",
    instant: false,
    long:
      "The same grid and targets were solved before with different crop priorities. What that solve proved (like how many mutations can fit) was reused to speed this one up. The solve still ran in full.",
  },
};

export function cacheInfo(kind: string | undefined | null): CacheInfo | null {
  if (!kind) return null;
  return (
    CACHE_INFO[kind] ?? {
      label: "Cache used",
      instant: false,
      long: `Earlier solve data was used (${kind}).`,
    }
  );
}

export const TONE_BADGE: Record<Tone, string> = {
  emerald: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
  sky: "bg-sky-500/15 border-sky-500/40 text-sky-300",
  amber: "bg-amber-500/15 border-amber-500/40 text-amber-300",
  rose: "bg-rose-500/15 border-rose-500/40 text-rose-300",
  slate: "bg-slate-600/30 border-slate-500/40 text-slate-300",
  violet: "bg-violet-500/15 border-violet-500/40 text-violet-300",
};

// ---------------------------------------------------------------------------
// Live progress
// ---------------------------------------------------------------------------

export type SolveStage = "submitting" | "queued" | "building" | "maximizing" | "tie_breaking";

/**
 * Where a running job is. The solver's objective is lexicographic: first the
 * highest score, then (among layouts with that score) the fewest priority
 * points, then the fewest cells. The API reports which of those it is still
 * working on in progress.stage; older local solvers do not, and then the
 * solve counts as maximizing throughout.
 */
export function stageFromProgress(progress: JobProgress | null): SolveStage {
  if (!progress) return "building";
  const phase = (progress.phase || "").toLowerCase();
  if (phase === "preparing" || phase === "initializing") return "building";
  if (progress.stage === "tie_breaking") return "tie_breaking";
  return "maximizing";
}

export interface StageStep {
  key: SolveStage;
  label: string;
  hint: string;
}

export function stageSteps(opts: { local: boolean; hasScore: boolean }): StageStep[] {
  const steps: StageStep[] = [
    { key: "submitting", label: "Submit", hint: "Sending your setup to the solver" },
    { key: "queued", label: "Queue", hint: "Waiting for earlier solves on the server to finish" },
    { key: "building", label: "Build", hint: "Turning your grid, targets and settings into a model for the solver" },
    {
      key: "maximizing",
      label: "Max score",
      hint: "Searching for the highest-scoring layout and trying to prove nothing scores higher",
    },
    {
      key: "tie_breaking",
      label: "Tie-break",
      hint: "The best score is proven. Among layouts with that score, the solver now looks for the one with the fewest crop priority points, then the fewest cells used",
    },
  ];
  return steps.filter((s) => !(opts.local && s.key === "queued") && !(!opts.hasScore && s.key === "maximizing"));
}

const STAGE_ORDER: SolveStage[] = ["submitting", "queued", "building", "maximizing", "tie_breaking"];

export function stageIndex(stage: SolveStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export interface BestSoFar {
  score?: number;
  scoreBound?: number;
  mutations?: number;
  cells?: number;
  priority?: number;
}

/**
 * Best-layout numbers for the progress panel. Newer APIs send them as fields;
 * older ones only inside the activity text:
 *   "Found 12 solutions, best score 3.456 (8 mutations, 40 cells, priority 2)"
 *   "Found 12 solutions, best has 8 mutations"
 *   "Found 12 solutions, best uses 40 cells"
 */
export function bestSoFar(progress: JobProgress | null): BestSoFar {
  const out: BestSoFar = {};
  if (!progress) return out;
  const text = progress.current_activity || "";
  const num = (re: RegExp) => {
    const m = text.match(re);
    return m ? Number(m[1]) : undefined;
  };
  out.score = progress.best_score ?? num(/best score (-?[\d.]+)/i);
  out.scoreBound = progress.score_bound ?? undefined;
  out.mutations = progress.best_mutations ?? num(/(\d+) mutations?/i);
  // preview_cells_used includes locked placements, matching the grid.
  out.cells = progress.preview_cells_used ?? progress.best_cells ?? num(/(\d+) cells?/i);
  out.priority = progress.best_priority ?? num(/priority (\d+)/i);
  return out;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec.toString().padStart(2, "0")}s`;
  return `${sec}s`;
}
