import type { EffortResult, RunResult } from "./result";
import type { Board, RunKind, SubmissionFile } from "./rules";
import type { FlowSummary } from "./summary";
import type { StepLayout } from "../simulator/flow/types";
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

/** The step layout a flow spends the most time in (the ranking thumbnail). */
export interface FlowThumb {
  plot: number;
  step: string;
  layout: StepLayout;
  /** Share of the run spent in it. */
  share: number;
}

/** One point of a list row's frequency curve: the parts of a RunResult the page prices. */
export interface CurvePoint {
  produced: Record<string, number>;
  bought: Record<string, number>;
  consumed: Record<string, number>;
  effort?: { avg: number | null; peak: number | null };
  /** The cell is scored at its trailing rate (most seeds slowed down at the end). */
  slowing?: true;
}

export interface FlowListEntry {
  id: string;
  title: string;
  /** The first ~240 characters of the description (Markdown source). */
  excerpt?: string;
  author: FlowAuthor;
  /** The boards the entry is on. */
  boards?: Board[];
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
  /** Seeds behind `cell`. */
  seeds?: number | null;
  effort: EffortResult | null;
  /** The static flow summary (summary.ts): plots, targets, thumbnails. Missing on old entries. */
  summary?: FlowSummary | null;
  /** The most-used step layout (set once verified); falls back to the summary's start layout. */
  thumb?: FlowThumb | null;
  /** The same tier's cells at every frequency (keyed by `every`), for the row's curve and Slack. */
  curve?: Record<string, CurvePoint>;
  /** Not in the contract yet: Slack if the API ever precomputes it. */
  slack?: number | null;
  /** Likes from logged-in users, all time and in the last 30 days (absent on older APIs). */
  likes?: number;
  likes30d?: number;
  /**
   * `ironman_strict` lists only: the same tier / every on the "with starting items" board (the
   * borrow run), for the "Kit +N%" chip. Null or absent when that cell isn't verified.
   */
  borrowPoint?: CurvePoint | null;
}

export interface FlowListResponse {
  engineVersion: string;
  /** The canonical board (an alias resolved) and its run kind; absent on older APIs. */
  board?: Board;
  runKind?: RunKind;
  entries: FlowListEntry[];
  /** More live entries exist than the API sends (it keeps the most recently updated). */
  truncated?: boolean;
}

export interface FlowCell {
  /** The run the cell measured (absent on old cells: use `board`, where `ironman` = ironman_strict). */
  runKind?: RunKind;
  board: Board;
  tier: TierId;
  every: number;
  median: RunResult;
  spread: Spread | null;
  seeds: number;
  engineVersion: string;
}

export interface FlowSeedResult {
  runKind?: RunKind;
  board: Board;
  tier: TierId;
  every: number;
  seedIndex: number;
  /** Normalised by the service (older APIs sent the result's fields flat on the row). */
  result: RunResult;
  ok?: boolean;
  error?: string | null;
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
  summary?: FlowSummary | null;
  thumb?: FlowThumb | null;
  cells: FlowCell[];
  seeds?: FlowSeedResult[];
  likes?: number;
  likes30d?: number;
  /** Whether the logged-in viewer liked it (absent when logged out). */
  liked?: boolean;
  /** Only with the owner's token or the admin key. */
  rejectReason?: string | null;
  hidden?: boolean;
  /** Why it is hidden: "reports" (auto-hide), "admin" or "ban". */
  hiddenReason?: string | null;
  reportCount?: number;
}

/** Admin list filter (`GET /greenhouse/admin/flows?status=`); "" = all. */
export type AdminStatusFilter = "" | "reported" | "hidden" | "pending" | "rejected" | "live";

/** One report on an entry (the admin list may include them). */
export interface AdminReport {
  reporter_id: string;
  reason: string;
  created_at: Timestamp;
}

/** A raw `entries` row from the admin list, normalised by adminService (unknown keys dropped). */
export interface AdminFlowRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  boards: string[];
  cycles: number;
  plots: number;
  status: string;
  reject_reason: string | null;
  engine_version: string;
  report_count: number;
  hidden_by_admin: boolean;
  hidden_reason: string | null;
  prev_status: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  author_username: string | null;
  author_global_name: string | null;
  author_avatar: string | null;
  /** Not in the contract; shown when the API sends it. */
  author_banned_at: Timestamp | null;
  /** The author's own submissions-per-24h limit set by an admin; null = the default. */
  author_submission_limit: number | null;
  reports: AdminReport[];
}

export interface FlowJob {
  id?: number | string;
  /** Absent on older APIs (they send `board` only). */
  runKind?: RunKind;
  board: Board;
  tier: TierId;
  priority: "A" | "B";
  status: string;
  error: string | null;
  /** Runs finished / total in this job. */
  done?: number;
  total?: number;
  /** 1-based place in the queue while queued. */
  queuePosition?: number | null;
}

export interface FlowStatusResponse {
  status: FlowStatus;
  rejectReason: string | null;
  jobs: FlowJob[];
}

/** Every flow is verified for all three boards: the body has no board choice (the API ignores an old client's `boards`). */
export interface FlowSubmitBody {
  title: string;
  description: string;
  cycles: number;
  payload: SubmissionFile;
}

export interface AuthUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}
