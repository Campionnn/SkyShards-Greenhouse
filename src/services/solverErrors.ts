/**
 * Turns the many ways a solve can fail into something a player can act on.
 *
 * Failures reach us three ways:
 * - HTTP errors on submit/poll: `{detail: "..."}` from FastAPI
 * - a job with status "failed": the worker stores
 *   `"<ExceptionType>: <str(e)>\n<last traceback lines>"`, and for the solver's
 *   HTTPExceptions str(e) is `"<code>: <detail>"`, e.g.
 *   `"HTTPException: 503: No solution found\n  File ..."`
 * - network errors (fetch throws TypeError)
 */

export type SolveErrorKind =
  | "no_solution" // solver finished without any valid layout
  | "infeasible_unique" // unique-crops goal cannot be met
  | "invalid_request" // the API rejected the setup (unknown crop, bad lock, ...)
  | "interrupted" // server restarted mid-solve
  | "network" // could not reach the server
  | "not_found" // job expired / vanished
  | "server"; // anything else

export interface SolveErrorInfo {
  kind: SolveErrorKind;
  title: string;
  message: string;
  /** Things the user can try. */
  suggestions: string[];
  /** Raw technical text, for a collapsible "details" block. */
  details?: string;
}

export class SolveError extends Error {
  info: SolveErrorInfo;
  constructor(info: SolveErrorInfo) {
    super(info.message);
    this.name = "SolveError";
    this.info = info;
  }
}

const NO_SOLUTION_SUGGESTIONS = [
  "Lower the target counts, or switch a target to Maximize so the solver can place as many as fit.",
  "Unlock more cells on the Grid, or remove locked placements that block space.",
  "Check the target's requirements (click it in the targets list): some mutations need several ingredient crops around each spot, which takes a lot of room.",
  "With the local solver you can raise the time limit: very large setups sometimes need longer to find a first layout.",
];

/** Parse a failed job's stored error string. */
export function parseJobError(raw: string | null | undefined): SolveErrorInfo {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      kind: "server",
      title: "Solve failed",
      message: "The solver stopped without saying why.",
      suggestions: ["Try solving again. If it keeps happening, let us know on Discord."],
    };
  }

  const firstLine = text.split("\n")[0].trim();
  // "HTTPException: 503: No solution found" -> code 503, detail "No solution found"
  const httpMatch = firstLine.match(/^HTTPException:\s*(\d{3}):\s*(.*)$/);
  if (httpMatch) {
    return describeHttpError(Number(httpMatch[1]), httpMatch[2], text);
  }

  if (/Server restarted while job was running/i.test(text)) {
    return {
      kind: "interrupted",
      title: "Solve interrupted",
      message: "The solver restarted while your job was running, so it was lost.",
      suggestions: ["Press Solve again."],
      details: text,
    };
  }

  if (/^ValidationError/.test(firstLine) || /validation error/i.test(firstLine)) {
    return {
      kind: "invalid_request",
      title: "Invalid setup",
      message: "The solver rejected this setup as malformed.",
      suggestions: ["Refresh the page (your setup is saved) and try again.", "If you use the local solver, make sure it is up to date."],
      details: text,
    };
  }

  // "SomeError: message" -> show the message part
  const typed = firstLine.match(/^([A-Za-z_][\w.]*(?:Error|Exception)):\s*(.*)$/);
  return {
    kind: "server",
    title: "Solver error",
    message: typed ? typed[2] || typed[1] : firstLine,
    suggestions: ["Try solving again. If it keeps happening, let us know on Discord with the details below."],
    details: text,
  };
}

/** Describe an HTTP error (from an endpoint, or embedded in a job failure). */
export function describeHttpError(status: number, detail: string, raw?: string): SolveErrorInfo {
  const d = detail.trim();
  if (status === 503 && /no solution/i.test(d)) {
    return {
      kind: "no_solution",
      title: "No layout found",
      message:
        "The solver could not find any layout that satisfies all of your targets. Either no such layout exists for this grid, or none was found before the time budget ran out.",
      suggestions: NO_SOLUTION_SUGGESTIONS,
      details: raw,
    };
  }
  if (/unique crops/i.test(d)) {
    return {
      kind: "infeasible_unique",
      title: "Unique crops goal can't be met",
      message: d,
      suggestions: ["Lower the Unique crops slider.", "Lower the target counts or unlock more cells."],
      details: raw,
    };
  }
  if (status === 404) {
    return {
      kind: "not_found",
      title: "Job not found",
      message: "The server no longer knows about this solve (it may have expired or the server restarted).",
      suggestions: ["Press Solve again."],
      details: raw,
    };
  }
  if (status === 400 || status === 422) {
    return {
      kind: "invalid_request",
      title: "Setup rejected",
      message: d || "The solver rejected this setup.",
      suggestions: ["Check your targets, locked placements and crop settings.", "If you use the local solver, make sure it is up to date."],
      details: raw,
    };
  }
  if (status === 429) {
    return {
      kind: "server",
      title: "Too many requests",
      message: d || "The server is busy. Please wait a moment.",
      suggestions: ["Wait a few seconds and try again, or use the local solver."],
      details: raw,
    };
  }
  return {
    kind: "server",
    title: status >= 500 ? "Server error" : "Request failed",
    message: d || `The server answered with HTTP ${status}.`,
    suggestions: ["Try again in a moment. If it keeps happening, the local solver avoids the public server entirely."],
    details: raw,
  };
}

export function networkError(err: unknown, local: boolean): SolveErrorInfo {
  return {
    kind: "network",
    title: local ? "Lost contact with the local solver" : "Can't reach the server",
    message: local
      ? "The local solver stopped answering. Is its window still open?"
      : "The solve server could not be reached. Check your connection.",
    suggestions: local
      ? ["Restart the local solver (start.bat / start.sh) and press Solve again.", "Or turn off \"Solve on this computer\" to use the public server."]
      : ["Check your internet connection and try again."],
    details: err instanceof Error ? err.message : String(err),
  };
}

/** Normalise anything thrown by the solve pipeline. */
export function toSolveErrorInfo(err: unknown): SolveErrorInfo {
  if (err instanceof SolveError) return err.info;
  if (err instanceof Error) {
    return {
      kind: "server",
      title: "Solve failed",
      message: err.message,
      suggestions: ["Try solving again."],
    };
  }
  return { kind: "server", title: "Solve failed", message: String(err), suggestions: [] };
}
