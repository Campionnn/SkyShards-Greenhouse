import type { EffortResult, RunResult } from "./result";
import type { Board, SubmissionFile } from "./rules";
import type { TierId } from "./tiers";

/**
 * The leaderboard API's JSON shapes (docs/plans/flow-leaderboard.md §6.5), shared by the page's
 * fetch wrappers (`src/services/flowsService.ts`) and the pure view module (`view.ts`).
 * Framework-free: types only.
 */

/** ISO string or epoch (seconds or milliseconds); see `toMillis` in view.ts. */
export type Timestamp = string | number;

export interface FlowAuthor {
  id: string;
  name: string;
  /** Discord avatar hash, or null for the default avatar. */
  avatar: string | null;
}

/**
 * One cell's seed spread under the server's reference valuation (leaderboard/stats.py `spread`):
 * `ratio` = best / median (null = unbounded, a median of 0).
 */
export interface SpreadInfo {
  seeds: number;
  values: number[];
  best: number;
  median: number;
  worst: number;
  ratio: number | null;
}

/** Spread as the API sends it: one cell's info, a map per `every`, or a bare ratio. */
export type Spread = SpreadInfo | Record<string, SpreadInfo | number> | number;

export interface FlowListEntry {
  id: string;
  title: string;
  author: FlowAuthor;
  plots: number;
  cycles: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** Scored by an older engine; re-verification is queued. */
  stale: boolean;
  /** The max-tier cell stands in because this tier isn't verified yet. */
  estimated: boolean;
  /** Median result for the requested board / tier / every; null when not verified yet. */
  cell: RunResult | null;
  spread: Spread | null;
  effort: EffortResult | null;
  /** Not in the contract yet: Slack if the API ever precomputes it (the page shows "—" otherwise). */
  slack?: number | null;
}

export interface FlowListResponse {
  engineVersion: string;
  entries: FlowListEntry[];
}

export interface FlowCell {
  board: Board;
  tier: TierId;
  every: number;
  median: RunResult;
  spread: Spread | null;
  seeds: number;
  engineVersion: string;
}

export interface FlowSeedResult {
  board: Board;
  tier: TierId;
  every: number;
  seedIndex: number;
  result: RunResult;
}

export type FlowStatus = "pending" | "live" | "rejected" | "hidden";

export interface FlowDetail {
  id: string;
  title: string;
  description: string;
  author: FlowAuthor;
  boards: Board[];
  plots: number;
  cycles: number;
  status: FlowStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  engineVersion: string;
  stale: boolean;
  payload: SubmissionFile;
  cells: FlowCell[];
  seeds?: FlowSeedResult[];
}

export interface FlowJob {
  board: Board;
  tier: TierId;
  priority: "A" | "B";
  status: string;
  error: string | null;
}

export interface FlowStatusResponse {
  status: FlowStatus;
  rejectReason: string | null;
  jobs: FlowJob[];
}

export interface FlowSubmitBody {
  title: string;
  description: string;
  boards: Board[];
  cycles: number;
  payload: SubmissionFile;
}

export interface AuthUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}
