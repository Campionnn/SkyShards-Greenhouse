/**
 * Leaderboard moderation (docs/plans/flow-leaderboard.md §6.5, Phase 3): the API's admin endpoints,
 * authorised by the `X-Admin-Key` header. The key is kept in sessionStorage only (gone when the tab
 * closes), like the API's own cache browser. In development with the flows mock on, canned rows are
 * served and the key "mock" is accepted (flowsMock.ts).
 */
import type { AdminFlowRow, AdminReport, AdminStatusFilter, Timestamp } from "../leaderboard/api";
import { ApiError, readApiError } from "./authService";
import { flowsMockEnabled, MOCK_ADMIN_KEY, mockAdminAction, mockAdminBan, mockAdminLimit, mockAdminList } from "./flowsMock";
import { clearFlowsCache } from "./flowsService";
import { REMOTE_API_BASE } from "./solverEndpoint";

export const ADMIN_KEY_STORAGE = "skyshards-admin-key";

const mock = () => import.meta.env.DEV && flowsMockEnabled();

const session = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export function getAdminKey(): string | null {
  try {
    return session()?.getItem(ADMIN_KEY_STORAGE) || null;
  } catch {
    return null;
  }
}

export function setAdminKey(key: string): void {
  try {
    session()?.setItem(ADMIN_KEY_STORAGE, key);
  } catch {
    // sessionStorage unavailable: the key lives for this call only.
  }
}

export function clearAdminKey(): void {
  try {
    session()?.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    // nothing stored
  }
}

const ADMIN_STATUS_TEXT: Record<number, string> = {
  401: "Wrong admin key.",
  404: "Not found (or this server has no admin key configured).",
};

/** fetch with the admin key; errors become ApiError with a readable message. A 401 drops the stored key. */
async function adminFetch(path: string, init: RequestInit = {}, key: string | null = getAdminKey()): Promise<Response> {
  if (!key) throw new ApiError(401, "No admin key.");
  const headers = new Headers(init.headers);
  headers.set("X-Admin-Key", key);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${REMOTE_API_BASE}${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, `Could not reach the leaderboard server${e instanceof Error && e.message ? ` (${e.message})` : ""}.`);
  }
  if (!response.ok) {
    const err = await readApiError(response);
    if (response.status === 401 && key === getAdminKey()) clearAdminKey();
    // FastAPI's generic texts ("Authentication required", "Endpoint not available") say less than ours.
    const generic = /^(Authentication required|Endpoint not available)$/i.test(err.message) || /^Request failed/.test(err.message);
    if (generic && ADMIN_STATUS_TEXT[response.status]) throw new ApiError(response.status, ADMIN_STATUS_TEXT[response.status], err.errors);
    throw err;
  }
  return response;
}

/** Checks a key with `POST /greenhouse/admin/verify`; throws ApiError (401 wrong key, 404 no admin on this server). */
export async function verifyAdminKey(key: string): Promise<void> {
  const k = key.trim();
  if (!k) throw new ApiError(401, "Enter the admin key.");
  if (mock()) {
    if (k !== MOCK_ADMIN_KEY) throw new ApiError(401, ADMIN_STATUS_TEXT[401]);
    return;
  }
  await adminFetch("/greenhouse/admin/verify", { method: "POST" }, k);
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const time = (v: unknown): Timestamp => (typeof v === "number" || typeof v === "string" ? v : "");

/** A raw row from the API, tolerant of missing or extra keys. */
export function normalizeAdminRow(raw: unknown): AdminFlowRow {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const boards = Array.isArray(r.boards) ? r.boards.map(String) : str(r.boards).split(",").map((b) => b.trim()).filter(Boolean);
  const reports: AdminReport[] = Array.isArray(r.reports)
    ? r.reports.map((x) => {
        const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        return { reporter_id: str(o.reporter_id), reason: str(o.reason), created_at: time(o.created_at) };
      })
    : [];
  return {
    id: str(r.id),
    owner_id: str(r.owner_id),
    title: str(r.title) || "(untitled)",
    description: str(r.description),
    boards,
    cycles: num(r.cycles),
    plots: num(r.plots),
    status: str(r.status) || "unknown",
    reject_reason: strOrNull(r.reject_reason),
    engine_version: str(r.engine_version),
    report_count: num(r.report_count),
    hidden_by_admin: !!r.hidden_by_admin,
    hidden_reason: strOrNull(r.hidden_reason),
    prev_status: strOrNull(r.prev_status),
    created_at: time(r.created_at),
    updated_at: time(r.updated_at),
    author_username: strOrNull(r.author_username),
    author_global_name: strOrNull(r.author_global_name),
    author_avatar: strOrNull(r.author_avatar),
    author_banned_at: r.author_banned_at === null || r.author_banned_at === undefined ? null : time(r.author_banned_at),
    author_submission_limit: r.author_submission_limit === null || r.author_submission_limit === undefined || !Number.isFinite(Number(r.author_submission_limit)) ? null : Number(r.author_submission_limit),
    reports,
  };
}

/** `GET /greenhouse/admin/flows?status=` ("" = every entry). */
export async function adminListFlows(status: AdminStatusFilter = ""): Promise<AdminFlowRow[]> {
  let body: unknown;
  if (mock()) body = await mockAdminList(status || undefined);
  else {
    const q = status ? `?${new URLSearchParams({ status })}` : "";
    body = await (await adminFetch(`/greenhouse/admin/flows${q}`)).json();
  }
  const entries = (body as { entries?: unknown } | null)?.entries;
  return Array.isArray(entries) ? entries.map(normalizeAdminRow) : [];
}

async function flowAction(id: string, action: "hide" | "unhide" | "delete"): Promise<Record<string, unknown>> {
  clearFlowsCache();
  if (mock()) {
    const r = await mockAdminAction(id, action);
    if (!r) throw new ApiError(404, "Flow not found");
    return r;
  }
  const res = await adminFetch(`/greenhouse/admin/flows/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  return ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

/** Returns the new status ("hidden"). */
export const adminHide = async (id: string): Promise<string> => str((await flowAction(id, "hide")).status) || "hidden";
/** Returns the restored status. */
export const adminUnhide = async (id: string): Promise<string> => str((await flowAction(id, "unhide")).status);
export const adminDelete = async (id: string): Promise<void> => {
  await flowAction(id, "delete");
};

async function banAction(userId: string, ban: boolean, reason = ""): Promise<void> {
  clearFlowsCache();
  if (mock()) {
    if (!(await mockAdminBan(userId, ban))) throw new ApiError(404, "User not found");
    return;
  }
  await adminFetch(`/greenhouse/admin/users/${encodeURIComponent(userId)}/${ban ? "ban" : "unban"}`, {
    method: "POST",
    ...(ban ? { body: JSON.stringify({ reason: reason.trim().slice(0, 200) }) } : {}),
  });
}

/** Ban a Discord user: hides every entry of theirs. */
export const adminBan = (userId: string, reason: string): Promise<void> => banAction(userId, true, reason);
/** Lift a ban: restores only the entries the ban hid. */
export const adminUnban = (userId: string): Promise<void> => banAction(userId, false);

export interface SubmissionLimitResult {
  /** The user's own limit; null = the default. */
  limit: number | null;
  /** The limit that applies now (own or default). */
  effectiveLimit: number;
  /** Submissions in the last 24 h. */
  used24h: number;
}

/**
 * `POST /greenhouse/admin/users/{id}/limit`: give a user their own submissions-per-24h limit
 * (e.g. 50), or `null` to put them back on the default. Applies at once.
 */
export async function adminSetSubmissionLimit(userId: string, limit: number | null): Promise<SubmissionLimitResult> {
  if (limit !== null && !(Number.isInteger(limit) && limit >= 0)) throw new ApiError(422, "The limit must be a whole number of 0 or more.");
  if (mock()) {
    const r = await mockAdminLimit(userId, limit);
    if (!r) throw new ApiError(404, "User not found");
    return r;
  }
  const res = await adminFetch(`/greenhouse/admin/users/${encodeURIComponent(userId)}/limit`, { method: "POST", body: JSON.stringify({ limit }) });
  const body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return {
    limit: body.limit === null || body.limit === undefined ? null : num(body.limit),
    effectiveLimit: num(body.effectiveLimit),
    used24h: num(body.used24h),
  };
}

/** Why an entry is hidden, for a badge: "by reports", "by admin", "banned". */
export function hiddenReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "reports") return "by reports";
  if (reason === "admin") return "by admin";
  if (reason === "ban") return "banned";
  return reason;
}
