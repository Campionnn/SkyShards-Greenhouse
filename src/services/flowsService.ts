/**
 * Typed wrappers for the leaderboard endpoints (docs/plans/flow-leaderboard.md §6.5). The list is
 * cached in memory per (board, tier, every, plots) for the session; `force` refetches (Refresh).
 * In development, `localStorage["skyshards-flows-mock"] = "1"` serves canned data (flowsMock.ts).
 */
import type { FlowDetail, FlowListResponse, FlowStatusResponse, FlowSubmitBody } from "../leaderboard/api";
import type { Board } from "../leaderboard/rules";
import type { TierId } from "../leaderboard/tiers";
import { ApiError, apiFetch } from "./authService";
import { flowsMockEnabled, mockDetail, mockList, mockStatus, mockSubmit } from "./flowsMock";

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
  const guarded = p.then((res) => ({ engineVersion: res?.engineVersion ?? "", entries: Array.isArray(res?.entries) ? res.entries : [] }));
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

export async function getFlow(id: string): Promise<FlowDetail> {
  if (mock()) {
    const d = await mockDetail(id);
    if (!d) throw new ApiError(404, "Not found (the flow may be hidden or deleted).");
    return d;
  }
  const r = await apiFetch(`/flows/${encodeURIComponent(id)}`);
  return (await r.json()) as FlowDetail;
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
