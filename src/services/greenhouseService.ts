import type {
  SolveRequest,
  SolveResponse,
  ExpansionRequest,
  ExpansionResponse,
  JobSubmitResponse,
  JobStatusResponse,
  JobProgress,
  MutationGoal,
} from "../types/greenhouse";

import { REMOTE_API_BASE, loadLocalSolverSettings, resolveSolverEndpoint } from "./solverEndpoint";
import type { ResolvedEndpoint } from "./solverEndpoint";
import { SolveError, describeHttpError, networkError, parseJobError } from "./solverErrors";

// Polling interval for job status checks (ms)
const POLL_INTERVAL = 500;
// Consecutive failed status polls tolerated before giving up (network blips)
const MAX_POLL_FAILURES = 6;
// After Stop is pressed, how long to wait for the server to hand back its partial result
const CANCEL_GRACE_MS = 8000;

/** Thrown when the user stopped a solve and no partial layout was available. */
export class SolveCancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "SolveCancelledError";
  }
}

/**
 * Pull a readable message out of an API error body. FastAPI sends
 * `{detail: string}` for HTTPExceptions and `{detail: [{loc, msg}, ...]}` for
 * request validation errors.
 */
async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null);
  const detail = data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((p: unknown) => p !== "body").join(".") : "";
        return loc ? `${loc}: ${d?.msg ?? "invalid"}` : String(d?.msg ?? d);
      })
      .join("; ");
  }
  return `${fallback} (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""})`;
}

/** Extra facts about a finished solve that the result itself does not carry. */
export interface SolveRunInfo {
  endpoint: ResolvedEndpoint;
  jobId: string;
  /** Seconds between the job starting and finishing on the server (null if unknown). */
  serverSeconds: number | null;
  /** Seconds the job waited in the queue (null if unknown). */
  queuedSeconds: number | null;
}

/**
 * Submit a solve job to the queue.
 * Returns the job ID for status polling.
 */
export async function submitSolveJob(request: SolveRequest, endpoint?: ResolvedEndpoint): Promise<string> {
  const target = endpoint ?? (await resolveSolverEndpoint());
  // The local solver honours a per-solve time limit (the public API ignores it).
  const timeLimit = target.local ? request.time_limit ?? loadLocalSolverSettings().timeLimit : null;
  let response: Response;
  try {
    response = await fetch(`${target.base}/greenhouse/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "greenhouse",
        params: {
          cells: request.cells,
          targets: request.targets,
          priorities: request.priorities || {},
          locks: request.locks || [],
          effect_weights: request.effect_weights ?? {},
          ...(request.buff_crops ? { buff_crops: request.buff_crops } : {}),
          ...(request.unique_crops ? { unique_crops: request.unique_crops } : {}), // UNIQUE_CROPS
          ...(timeLimit ? { time_limit: timeLimit } : {}),
        },
      }),
    });
  } catch (err) {
    throw new SolveError(networkError(err, target.local));
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to submit job");
    throw new SolveError(describeHttpError(response.status, detail));
  }

  const result: JobSubmitResponse = await response.json();
  return result.job_id;
}

export async function getJobStatus(jobId: string, base: string = REMOTE_API_BASE): Promise<JobStatusResponse> {
  const response = await fetch(`${base}/greenhouse/jobs/${jobId}`);

  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to get job status");
    throw new SolveError(describeHttpError(response.status, detail));
  }

  return response.json();
}

export async function cancelJob(jobId: string, base: string = REMOTE_API_BASE): Promise<void> {
  const response = await fetch(`${base}/greenhouse/jobs/${jobId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response, "Failed to cancel job");
    throw new Error(detail);
  }
}

export interface SolveJobCallbacks {
  onProgress?: (progress: JobProgress) => void;
  onQueuePosition?: (position: number) => void;
  onPreviewUpdate?: (result: SolveResponse) => void;
  /** Which server took the job (local solver, or remote - possibly as a fallback). */
  onEndpoint?: (endpoint: ResolvedEndpoint) => void;
  /** The job was accepted by the server. */
  onSubmitted?: (jobId: string) => void;
  /** Every raw status poll, for anything the other callbacks do not cover. */
  onJobStatus?: (status: JobStatusResponse) => void;
  /** Stop was pressed and the server was asked to stop; waiting for its partial result. */
  onCancelling?: () => void;
}

export interface SolveOutcome {
  result: SolveResponse;
  run: SolveRunInfo;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function runInfoFrom(status: JobStatusResponse | null, endpoint: ResolvedEndpoint, jobId: string): SolveRunInfo {
  const started = status?.started_at ?? null;
  const completed = status?.completed_at ?? null;
  const created = status?.created_at ?? null;
  return {
    endpoint,
    jobId,
    serverSeconds: started !== null && completed !== null ? Math.max(0, completed - started) : null,
    queuedSeconds: started !== null && created !== null ? Math.max(0, started - created) : null,
  };
}

/**
 * Run a solve through the job queue.
 *
 * Resolves with the final layout, including when the user pressed Stop and the
 * server handed back the best layout found so far (result.status "CANCELLED").
 * Rejects with SolveCancelledError when stopped without any layout, and with
 * SolveError (see solverErrors.ts) for everything else, including the solver
 * finding no layout at all.
 */
export async function solveGreenhouseWithJob(
  request: SolveRequest,
  callbacks?: SolveJobCallbacks,
  abortSignal?: AbortSignal
): Promise<SolveOutcome> {
  // Pick the server (local solver if enabled and running, else the public API)
  const endpoint = await resolveSolverEndpoint();
  callbacks?.onEndpoint?.(endpoint);
  const base = endpoint.base;

  if (abortSignal?.aborted) throw new SolveCancelledError();

  // Submit the job
  const jobId = await submitSolveJob(request, endpoint);
  callbacks?.onSubmitted?.(jobId);

  // Stop: ask the server to stop, then keep polling briefly so the partial
  // result the worker saves (status "completed", result.status "CANCELLED")
  // still reaches the page.
  let cancelRequestedAt: number | null = null;
  const onAbort = () => {
    if (cancelRequestedAt !== null) return;
    cancelRequestedAt = Date.now();
    callbacks?.onCancelling?.();
    cancelJob(jobId, base).catch(() => {
      // Already finished (400) or unreachable: polling decides what happened.
    });
  };
  if (abortSignal) {
    if (abortSignal.aborted) onAbort();
    else abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  let failures = 0;
  try {
    for (;;) {
      if (cancelRequestedAt !== null && Date.now() - cancelRequestedAt > CANCEL_GRACE_MS) {
        throw new SolveCancelledError();
      }

      let status: JobStatusResponse;
      try {
        status = await getJobStatus(jobId, base);
        failures = 0;
      } catch (err) {
        if (err instanceof SolveError) throw err; // 404 etc: the server answered
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) throw new SolveError(networkError(err, endpoint.local));
        await sleep(POLL_INTERVAL * failures);
        continue;
      }
      callbacks?.onJobStatus?.(status);

      switch (status.status) {
        case "queued":
          if (status.queue_position && callbacks?.onQueuePosition) {
            callbacks.onQueuePosition(status.queue_position);
          }
          break;

        case "running":
          if (status.progress) {
            callbacks?.onProgress?.(status.progress);
            if (status.progress.preview_placements && status.progress.preview_mutations && callbacks?.onPreviewUpdate) {
              // Both preview and final result use the same position/size format
              callbacks.onPreviewUpdate({
                status: "SOLVING",
                total_cells_used: status.progress.preview_cells_used || 0,
                placements: status.progress.preview_placements,
                mutations: status.progress.preview_mutations,
              });
            }
          }
          break;

        case "completed":
          if (status.result) {
            return { result: status.result, run: runInfoFrom(status, endpoint, jobId) };
          }
          throw new SolveError({
            kind: "server",
            title: "Empty result",
            message: "The job finished but the server returned no layout.",
            suggestions: ["Try solving again."],
          });

        case "failed":
          // Stopping before any layout was found makes the engine raise
          // "No solution found": that is the user's stop, not a real failure.
          if (cancelRequestedAt !== null) throw new SolveCancelledError();
          throw new SolveError(parseJobError(status.error));

        case "cancelled":
          if (status.result) {
            return {
              result: { ...status.result, status: "CANCELLED" },
              run: runInfoFrom(status, endpoint, jobId),
            };
          }
          throw new SolveCancelledError();
      }

      await sleep(POLL_INTERVAL);
    }
  } finally {
    abortSignal?.removeEventListener("abort", onAbort);
  }
}

// Expansion always runs on the public API, never on the local solver.
export async function optimizeExpansion(request: ExpansionRequest): Promise<ExpansionResponse> {
  const response = await fetch(`${REMOTE_API_BASE}/greenhouse/expansion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Expansion optimizer error: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Solve greenhouse synchronously (direct response, no job queue).
 * Used for quick solves like mutation requirement previews.
 */
export async function solveGreenhouseDirect(
  cells: [number, number][],
  targets: MutationGoal[],
  abortSignal?: AbortSignal,
  timeLimitSeconds?: number
): Promise<SolveResponse> {
  const query = timeLimitSeconds ? `?time_limit=${timeLimitSeconds}` : "";
  const { base } = await resolveSolverEndpoint();
  const response = await fetch(`${base}/greenhouse/solver${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cells, targets, effect_weights: {} }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response, "Greenhouse solver error");
    throw new SolveError(describeHttpError(response.status, detail));
  }

  return response.json();
}
