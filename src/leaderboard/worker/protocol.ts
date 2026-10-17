import type { RunResult } from "../result";
import type { Board, Submission } from "../rules";
import type { TierId } from "../tiers";

/** The submit dialog's "Test with 5 random seeds": one seed per request. */
export interface LocalTestRequest {
  reqId: number;
  submission: Submission;
  board: Board;
  tier: TierId;
  every: number;
  seed: number;
  cycles: number;
  /** Wall-clock cap (the server's is 60 s per run). */
  wallMs: number;
}

export type LocalTestResponse =
  | { type: "progress"; reqId: number; done: number; total: number }
  | { type: "result"; reqId: number; ok: boolean; error: string | null; result: RunResult | null; wallMs: number };
