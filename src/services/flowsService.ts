/**
 * Typed wrappers for the leaderboard endpoints (docs/plans/flow-leaderboard.md §6.5). The list is
 * cached in memory per (board, tier, every, plots) for the session; `force` refetches (Refresh).
 * In development, `localStorage["skyshards-flows-mock"] = "1"` serves canned data (flowsMock.ts).
 */
import type { FlowDetail, FlowListResponse, FlowSeedResult, FlowStatusResponse, FlowSubmitBody } from "../leaderboard/api";
import type { RunResult } from "../leaderboard/result";
import type { Board } from "../leaderboard/rules";
import type { TierId } from "../leaderboard/tiers";
import { ApiError, apiFetch } from "./authService";
import { flowsMockEnabled, mockAdminDetailExtras, mockDetail, mockList, mockStatus, mockSubmit } from "./flowsMock";

const mock = () => import.meta.env.DEV && flowsMockEnabled();

export interface ListQuery {
  board: Board;
  tier: TierId;
  every: number;
  /** 1, 2 or 3; undefined = any. */
  plots?: number;
}

const listCache = new Map<string, Promise<FlowListResponse>>();
const listKey = (q: ListQuery) => `${q.board}|${q.tier}|${q.every}|${q.plots ?? "any"}`;

export function listFlows(q: ListQuery, opts: { force?: boolean } = {}): Promise<FlowListResponse> {
  const key = listKey(q);
  if (!opts.force) {
    const hit = listCache.get(key);
    if (hit) return hit;
  }
  const params = new URLSearchParams({ board: q.board, tier: q.tier, every: String(q.every) });
  if (q.plots) params.set("plots", String(q.plots));
  const p = mock()
    ? mockList(q.board, q.tier, q.every, q.plots)
    : apiFetch(`/flows?${params}`, {}, { auth: false }).then((r) => r.json() as Promise<FlowListResponse>);
  const guarded = p.then((res) => ({ engineVersion: res?.engineVersion ?? "", entries: Array.isArray(res?.entries) ? res.entries : [], truncated: res?.truncated === true }));
  listCache.set(key, guarded);
  // A failed fetch is not cached.
  guarded.catch(() => {
    if (listCache.get(key) === guarded) listCache.delete(key);
  });
  return guarded;
}

/** Drop the cached lists (after a submit, edit or delete). */
export function clearFlowsCache(): void {
  listCache.clear();
}

/**
 * `adminKey` (from adminService's sessionStorage) is sent as `X-Admin-Key`: the API then also
 * returns hidden / rejected entries with their moderation fields.
 */
export async function getFlow(id: string, opts: { adminKey?: string | null } = {}): Promise<FlowDetail> {
  if (mock()) {
    const d = await mockDetail(id);
    if (!d) throw new ApiError(404, "Not found (the flow may be hidden or deleted).");
    const extras = opts.adminKey ? mockAdminDetailExtras(id) : null;
    return extras ? { ...d, ...extras } : d;
  }
  const r = await apiFetch(`/flows/${encodeURIComponent(id)}`, opts.adminKey ? { headers: { "X-Admin-Key": opts.adminKey } } : {});
  return normalizeDetail((await r.json()) as FlowDetail);
}

const EMPTY_EFFORT = { sessions: 0, avg: 0, peak: 0, byKind: {} };

/** One seed row as a `FlowSeedResult` with a full `result`, or null for a failed run without counts. */
function normalizeSeed(raw: unknown): FlowSeedResult | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown> & Partial<FlowSeedResult>;
  const src = (row.result && typeof row.result === "object" ? row.result : row) as Partial<RunResult>;
  if (!src.produced || typeof src.produced !== "object") return null;
  const result: RunResult = {
    cycles: src.cycles ?? 0,
    days: src.days ?? 0,
    produced: src.produced,
    consumed: src.consumed ?? {},
    bought: src.bought ?? {},
    built: src.built ?? {},
    shortfall: src.shortfall ?? {},
    uptime: src.uptime ?? 0,
    sustainable: src.sustainable ?? false,
    effort: { ...EMPTY_EFFORT, ...(src.effort ?? {}) },
    halted: src.halted ?? false,
    ...(src.bySource ? { bySource: src.bySource } : {}),
    ...(src.stepTime ? { stepTime: src.stepTime } : {}),
    // Ironman bootstrap debt (absent on normal-board and old results).
    ...(src.peakDebt ? { peakDebt: src.peakDebt } : {}),
    ...(src.paybackCycle !== undefined ? { paybackCycle: src.paybackCycle } : {}),
    ...(typeof src.solvent === "boolean" ? { solvent: src.solvent } : {}),
  };
  return { board: row.board as FlowSeedResult["board"], tier: row.tier as FlowSeedResult["tier"], every: Number(row.every), seedIndex: Number(row.seedIndex), result, ok: row.ok, error: row.error };
}

/** Defensive shape fixes for the detail response (cells without a median are dropped). */
export function normalizeDetail(d: FlowDetail): FlowDetail {
  return {
    ...d,
    cells: (d.cells ?? []).filter((c) => c && c.median && typeof c.median.produced === "object"),
    seeds: d.seeds ? d.seeds.map(normalizeSeed).filter((s): s is FlowSeedResult => s !== null) : d.seeds,
  };
}

export async function getFlowStatus(id: string): Promise<FlowStatusResponse> {
  if (mock()) return mockStatus();
  const r = await apiFetch(`/flows/${encodeURIComponent(id)}/status`);
  return (await r.json()) as FlowStatusResponse;
}

export async function submitFlow(body: FlowSubmitBody): Promise<{ id: string; status: string }> {
  if (mock()) return mockSubmit();
  const r = await apiFetch("/flows", { method: "POST", body: JSON.stringify(body) });
  clearFlowsCache();
  return (await r.json()) as { id: string; status: string };
}

export async function updateFlow(id: string, patch: Partial<FlowSubmitBody>): Promise<void> {
  clearFlowsCache();
  if (mock()) return;
  await apiFetch(`/flows/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) });
}

export async function deleteFlow(id: string): Promise<void> {
  clearFlowsCache();
  if (mock()) return;
  await apiFetch(`/flows/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Resolves false when this user already reported the entry (409). */
export async function reportFlow(id: string, reason: string): Promise<boolean> {
  if (mock()) return true;
  try {
    await apiFetch(`/flows/${encodeURIComponent(id)}/report`, { method: "POST", body: JSON.stringify({ reason: reason.slice(0, 200) }) });
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return false;
    throw e;
  }
}

/** `{origin}/flows/ID`. */
export function flowLink(id: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/flows/${id}`;
}
