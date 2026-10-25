import type { RunResult } from "../result";
import type { RunKind, Submission } from "../rules";
import type { TierId } from "../tiers";

/** The submit dialog's local test with random seeds: one seed of one run kind per request. */
export interface LocalTestRequest {
  reqId: number;
  submission: Submission;
  runKind: RunKind;
  tier: TierId;
  every: number;
  seed: number;
  /** The author's length; the run goes on through the end window (rules.ts endCycles). */
  cycles: number;
  /** Wall-clock cap (the server's is 60 s per run). */
  wallMs: number;
}

export type LocalTestResponse =
  | { type: "progress"; reqId: number; done: number; total: number }
  | { type: "result"; reqId: number; ok: boolean; error: string | null; result: RunResult | null; wallMs: number };
