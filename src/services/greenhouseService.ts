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

// Polling interval for job status checks (ms)
const POLL_INTERVAL = 500;

/**
 * Submit a solve job to the queue.
 * Returns the job ID for status polling.
 */
export async function submitSolveJob(request: SolveRequest, endpoint?: ResolvedEndpoint): Promise<string> {
  const target = endpoint ?? (await resolveSolverEndpoint());
  // The local solver honours a per-solve time limit (the public API ignores it).
  const timeLimit = target.local ? request.time_limit ?? loadLocalSolverSettings().timeLimit : null;
  const response = await fetch(`${target.base}/greenhouse/jobs`, {
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
        ...(timeLimit ? { time_limit: timeLimit } : {}),
      },
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to submit job: ${response.statusText}`);
  }

  const result: JobSubmitResponse = await response.json();
  return result.job_id;
}

export async function getJobStatus(jobId: string, base: string = REMOTE_API_BASE): Promise<JobStatusResponse> {
  const response = await fetch(`${base}/greenhouse/jobs/${jobId}`);
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Job not found");
    }
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to get job status: ${response.statusText}`);
  }

  return response.json();
}

export async function cancelJob(jobId: string, base: string = REMOTE_API_BASE): Promise<void> {
  const response = await fetch(`${base}/greenhouse/jobs/${jobId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to cancel job: ${response.statusText}`);
  }
}

export interface SolveJobCallbacks {
  onProgress?: (progress: JobProgress) => void;
  onQueuePosition?: (position: number) => void;
  onPreviewUpdate?: (result: SolveResponse) => void;
  /** Which server took the job (local solver, or remote - possibly as a fallback). */
  onEndpoint?: (endpoint: ResolvedEndpoint) => void;
}

export async function solveGreenhouseWithJob(
  request: SolveRequest,
  callbacks?: SolveJobCallbacks,
  abortSignal?: AbortSignal
): Promise<SolveResponse> {
  // Pick the server (local solver if enabled and running, else the public API)
  const endpoint = await resolveSolverEndpoint();
  callbacks?.onEndpoint?.(endpoint);
  const base = endpoint.base;

  // Submit the job
  const jobId = await submitSolveJob(request, endpoint);

  // Poll for completion
  return new Promise((resolve, reject) => {
    let cancelled = false;

    // Handle abort signal
    if (abortSignal) {
      abortSignal.addEventListener("abort", async () => {
        cancelled = true;
        try {
          await cancelJob(jobId, base);
        } catch {
          // Ignore cancel errors
        }
      });
    }

    const poll = async () => {
      if (cancelled) {
        reject(new Error("Job cancelled"));
        return;
      }

      try {
        const status = await getJobStatus(jobId, base);

        switch (status.status) {
          case "queued":
            if (status.queue_position && callbacks?.onQueuePosition) {
              callbacks.onQueuePosition(status.queue_position);
            }
            setTimeout(poll, POLL_INTERVAL);
            break;

          case "running":
            if (status.progress) {
              // Call progress callback
              if (callbacks?.onProgress) {
                callbacks.onProgress(status.progress);
              }
              
              // If we have a preview solution, call preview callback
              if (
                status.progress.preview_placements &&
                status.progress.preview_mutations &&
                callbacks?.onPreviewUpdate
              ) {
                // Both preview and final result now use the same position/size format
                callbacks.onPreviewUpdate({
                  status: "SOLVING",
                  total_cells_used: status.progress.preview_cells_used || 0,
                  placements: status.progress.preview_placements,
                  mutations: status.progress.preview_mutations,
                });
              }
            }
            setTimeout(poll, POLL_INTERVAL);
            break;

          case "completed":
            if (status.result) {
              resolve(status.result);
            } else {
              reject(new Error("Job completed but no result returned"));
            }
            break;

          case "failed":
            reject(new Error(status.error || "Job failed"));
            break;

          case "cancelled":
            // Check if we have a partial result
            if (status.result) {
              resolve(status.result);
            } else {
              reject(new Error("Job was cancelled"));
            }
            break;

          default:
            setTimeout(poll, POLL_INTERVAL);
        }
      } catch (error) {
        reject(error);
      }
    };

    // Start polling
    poll();
  });
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
    body: JSON.stringify({ cells, targets }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || `Greenhouse solver error: ${response.statusText}`);
  }

  return response.json();
}
