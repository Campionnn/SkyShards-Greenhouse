/**
 * Typed wrappers for the leaderboard endpoints (docs/plans/flow-leaderboard.md §6.5). The list is
 * cached in memory per (board, kit, tier, every, plots) for the session; `force` refetches (Refresh).
 * In development, `localStorage["skyshards-flows-mock"] = "1"` serves canned data (flowsMock.ts).
 */
import type { FlowCell, FlowDetail, FlowListResponse, FlowSeedResult, FlowStatusResponse, FlowSubmitBody } from "../leaderboard/api";
import type { RunResult } from "../leaderboard/result";
import { BOARDS, CELL_KIND_RUN_KIND, cellKindFrom, type Board, type CellKind, type RunKind } from "../leaderboard/rules";
import { boardOfCellKind, readPrep } from "../leaderboard/view";
import type { TierId } from "../leaderboard/tiers";
import { SHARE_BASE_URL } from "../utilities/shareLink";
import { ApiError, apiFetch, getToken } from "./authService";
import { flowsMockEnabled, mockAdminDetailExtras, mockDetail, mockList, mockMyLikes, mockSeeds, mockSetLike, mockStatus, mockSubmit } from "./flowsMock";

const mock = () => import.meta.env.DEV && flowsMockEnabled();

export interface ListQuery {
  board: Board;
  /** Ironman board: "I have the starting items" (the `ironman_kit` cells). */
  kit?: boolean;
  tier: TierId;
  every: number;
  /** 1, 2 or 3; undefined = any. */
  plots?: number;
}

const listCache = new Map<string, Promise<FlowListResponse>>();
const listKey = (q: ListQuery) => `${q.board}|${q.board === "ironman" && q.kit ? 1 : 0}|${q.tier}|${q.every}|${q.plots ?? "any"}`;

export function listFlows(q: ListQuery, opts: { force?: boolean } = {}): Promise<FlowListResponse> {
  const key = listKey(q);
  if (!opts.force) {
    const hit = listCache.get(key);
    if (hit) return hit;
  }
  const kit = q.board === "ironman" && !!q.kit;
  const params = new URLSearchParams({ board: q.board, tier: q.tier, every: String(q.every) });
  if (kit) params.set("kit", "1");
  if (q.plots) params.set("plots", String(q.plots));
  const p = mock()
    ? mockList(q.board, q.tier, q.every, q.plots, kit)
    : apiFetch(`/flows?${params}`, {}, { auth: false }).then((r) => r.json() as Promise<FlowListResponse>);
  const guarded = p.then((res) => ({ engineVersion: res?.engineVersion ?? "", entries: normalizeListEntries(res?.entries), truncated: res?.truncated === true }));
  listCache.set(key, guarded);
  // A failed fetch is not cached.
  guarded.catch(() => {
    if (listCache.get(key) === guarded) listCache.delete(key);
  });
  return guarded;
}

/** Drop the cached lists and seed rows (after a submit, edit or delete). */
export function clearFlowsCache(): void {
  listCache.clear();
  seedsCache.clear();
}

/**
 * The query for a detail / seeds request: `private=1` when logged in or with the admin key, so the
 * URL never matches a publicly cached anonymous response (those carry no `liked`, and a shared cache
 * must never hand a viewer's own response to someone else).
 */
function readQuery(params: Record<string, string>, adminKey?: string | null): string {
  const q = new URLSearchParams(params);
  if (getToken() || adminKey) q.set("private", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * The flow without its per-seed rows (`seeds=0`, ~2 MB lighter; `getFlowSeeds` loads one cell's
 * rows when the page shows them). `adminKey` (from adminService's sessionStorage) is sent as
 * `X-Admin-Key`: the API then also returns hidden / rejected entries with their moderation fields.
 */
export async function getFlow(id: string, opts: { adminKey?: string | null } = {}): Promise<FlowDetail> {
  if (mock()) {
    const d = await mockDetail(id);
    if (!d) throw new ApiError(404, "Not found (the flow may be hidden or deleted).");
    const extras = opts.adminKey ? mockAdminDetailExtras(id) : null;
    const { seeds: _seeds, ...slim } = extras ? { ...d, ...extras } : d;
    void _seeds;
    return normalizeDetail(slim);
  }
  const r = await apiFetch(`/flows/${encodeURIComponent(id)}${readQuery({ seeds: "0" }, opts.adminKey)}`, opts.adminKey ? { headers: { "X-Admin-Key": opts.adminKey } } : {});
  return normalizeDetail((await r.json()) as FlowDetail);
}

export interface SeedsQuery {
  cellKind: CellKind;
  tier: TierId;
  every: number;
}

const seedsCache = new Map<string, Promise<FlowSeedResult[]>>();

/**
 * One cell's per-seed rows (`GET /flows/{id}/seeds`), normalised like the detail's; failed runs
 * without counts are left out. Cached for the session per (flow, cell); a failed fetch isn't.
 */
export function getFlowSeeds(id: string, q: SeedsQuery, opts: { adminKey?: string | null } = {}): Promise<FlowSeedResult[]> {
  const key = `${id}|${q.cellKind}|${q.tier}|${q.every}|${opts.adminKey ? 1 : 0}`;
  const hit = seedsCache.get(key);
  if (hit) return hit;
  const p = mock()
    ? mockSeeds(id, q).then((rows) => rows.map(normalizeSeed).filter((s): s is FlowSeedResult => s !== null))
    : apiFetch(
        `/flows/${encodeURIComponent(id)}/seeds${readQuery({ cellKind: q.cellKind, tier: q.tier, every: String(q.every) }, opts.adminKey)}`,
        opts.adminKey ? { headers: { "X-Admin-Key": opts.adminKey } } : {},
      )
        .then((r) => r.json() as Promise<{ seeds?: unknown[] }>)
        .then((body) => (Array.isArray(body?.seeds) ? body.seeds : []).map(normalizeSeed).filter((s): s is FlowSeedResult => s !== null));
  seedsCache.set(key, p);
  p.catch(() => {
    if (seedsCache.get(key) === p) seedsCache.delete(key);
  });
  return p;
}

const EMPTY_EFFORT = { sessions: 0, avg: 0, peak: 0, byKind: {} };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A count map with finite numbers only (else undefined). */
function counts(v: unknown): Record<string, number> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (isNum(n)) out[k] = n;
  return out;
}

/**
 * A stored result with every v2 field checked (old results lack them; malformed ones are dropped)
 * and the retired payback fields (`peakDebt`, `paybackCycle`, `solvent`) left out. Null when it
 * has no counts (a failed run).
 */
export function normalizeResult(raw: unknown): RunResult | null {
  if (!isObj(raw) || !isObj(raw.produced)) return null;
  const src = raw as Partial<RunResult> & Record<string, unknown>;
  const result: RunResult = {
    cycles: isNum(src.cycles) ? src.cycles : 0,
    days: isNum(src.days) ? src.days : 0,
    produced: counts(src.produced) ?? {},
    consumed: counts(src.consumed) ?? {},
    bought: counts(src.bought) ?? {},
    built: counts(src.built) ?? {},
    shortfall: counts(src.shortfall) ?? {},
    uptime: isNum(src.uptime) ? src.uptime : 0,
    sustainable: src.sustainable === true,
    effort: { ...EMPTY_EFFORT, ...(isObj(src.effort) ? src.effort : {}) },
    halted: src.halted === true,
  };
  if (isObj(src.bySource)) result.bySource = Object.fromEntries(Object.entries(src.bySource).filter(([, m]) => isObj(m)).map(([k, m]) => [k, counts(m)!]));
  if (isObj(src.stepTime)) result.stepTime = src.stepTime as RunResult["stepTime"];
  if (isObj(src.window) && isNum(src.window.from) && isNum(src.window.to)) result.window = { from: src.window.from, to: src.window.to, cuts: isNum(src.window.cuts) ? src.window.cuts : 0 };
  for (const key of ["startItems", "usedUp", "upkeep"] as const) {
    const m = counts(src[key]);
    if (m) result[key] = m;
  }
  if (Array.isArray(src.sessionOnly)) result.sessionOnly = src.sessionOnly.filter((x): x is string => typeof x === "string");
  if (Array.isArray(src.starved)) {
    result.starved = src.starved.filter(
      (e): e is NonNullable<RunResult["starved"]>[number] => isObj(e) && isNum(e.plot) && typeof e.step === "string" && typeof e.item === "string" && isNum(e.cells)
    );
  }
  if (isObj(src.ramp)) {
    const c = src.ramp.complete;
    result.ramp = { complete: c === null ? null : isNum(c) ? c : null, produced: counts(src.ramp.produced) ?? {}, bought: counts(src.ramp.bought) ?? {} };
  }
  if (src.slowing === true) result.slowing = true;
  const prep = readPrep(src.prep);
  if (prep) result.prep = prep;
  const cs = src.cantStart as unknown;
  if (isObj(cs) && isNum(cs.plot) && isNum(cs.cells) && Array.isArray(cs.items)) {
    result.cantStart = { plot: cs.plot, cells: cs.cells, items: cs.items.filter((x): x is string => typeof x === "string") };
  }
  return result;
}

/**
 * A cell's or seed row's cell kind, run kind and board: `cellKind` when sent, else what older APIs
 * sent (v2's run kind strict = from nothing, borrow = with the starting items, or a board name; the
 * pre-v2 board "ironman" is from nothing).
 */
function kindAndBoard(row: Record<string, unknown>): { cellKind: CellKind; runKind: RunKind; board: Board } | null {
  const kind = cellKindFrom(row.cellKind) ?? cellKindFrom(row.runKind) ?? cellKindFrom(row.board) ?? (row.board === "ironman" ? "ironman" : null);
  return kind ? { cellKind: kind, runKind: CELL_KIND_RUN_KIND[kind], board: boardOfCellKind(kind) } : null;
}

/** A job's run kind and board (v2's strict / borrow jobs are ironman). */
function jobKind(row: Record<string, unknown>): { runKind: RunKind; board: Board } | null {
  const kind = cellKindFrom(row.runKind) ?? cellKindFrom(row.board) ?? (row.runKind === "ironman" || row.board === "ironman" ? "ironman" : null);
  return kind ? { runKind: CELL_KIND_RUN_KIND[kind], board: boardOfCellKind(kind) } : null;
}

/** One seed row as a `FlowSeedResult` with a full `result`, or null for a failed run without counts. */
function normalizeSeed(raw: unknown): FlowSeedResult | null {
  if (!isObj(raw)) return null;
  const row = raw as Record<string, unknown> & Partial<FlowSeedResult>;
  const result = normalizeResult(isObj(row.result) ? row.result : row);
  const kb = kindAndBoard(row);
  if (!result || !kb) return null;
  return { ...kb, tier: row.tier as FlowSeedResult["tier"], every: Number(row.every), seedIndex: Number(row.seedIndex), result, ok: row.ok, error: row.error };
}

function normalizeCell(raw: unknown): FlowCell | null {
  if (!isObj(raw)) return null;
  const median = normalizeResult(raw.median);
  const kb = kindAndBoard(raw);
  if (!median || !kb) return null;
  return { ...(raw as unknown as FlowCell), ...kb, median };
}

/**
 * Defensive shape fixes for the detail response: cells and seeds get a cell kind, run kind and v3
 * board (v2's strict cells are "from nothing", borrow ones "with the starting items"), cells without
 * a median are dropped, and every flow is on both boards.
 */
export function normalizeDetail(d: FlowDetail): FlowDetail {
  return {
    ...d,
    boards: [...BOARDS],
    cells: (d.cells ?? []).map(normalizeCell).filter((c): c is FlowCell => c !== null),
    seeds: d.seeds ? d.seeds.map(normalizeSeed).filter((s): s is FlowSeedResult => s !== null) : d.seeds,
  };
}

/** List rows: drop the retired payback fields and malformed fields from each cell; `altPoint` / `borrowPoint` / `prep` checked. */
export function normalizeListEntries(entries: unknown): FlowListResponse["entries"] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(isObj)
    .map((e) => {
      const entry = e as unknown as FlowListResponse["entries"][number];
      return {
        ...entry,
        cell: entry.cell ? normalizeResult(entry.cell) : null,
        altPoint: isObj(entry.altPoint) ? entry.altPoint : null,
        borrowPoint: isObj(entry.borrowPoint) ? entry.borrowPoint : null,
        prep: readPrep(entry.prep),
      };
    });
}

/** Status jobs get a v3 run kind and board (v2's strict / borrow jobs are ironman; older APIs sent `board` only). */
export function normalizeStatus(s: FlowStatusResponse): FlowStatusResponse {
  const jobs: unknown[] = Array.isArray(s?.jobs) ? s.jobs : [];
  return {
    ...s,
    jobs: jobs.filter(isObj).map((j) => {
      const kb = jobKind(j);
      return { ...(j as unknown as FlowStatusResponse["jobs"][number]), ...(kb ?? {}) };
    }),
  };
}

export async function getFlowStatus(id: string): Promise<FlowStatusResponse> {
  if (mock()) return normalizeStatus(await mockStatus());
  const r = await apiFetch(`/flows/${encodeURIComponent(id)}/status`);
  return normalizeStatus((await r.json()) as FlowStatusResponse);
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

export interface LikeResult {
  id: string;
  liked: boolean;
  likes: number;
  likes30d: number;
}

/** Like (or unlike) a live flow; needs the Discord login. Resolves the new counts. */
export async function setFlowLike(id: string, liked: boolean): Promise<LikeResult> {
  if (mock()) return mockSetLike(id, liked);
  const r = await apiFetch(`/flows/${encodeURIComponent(id)}/like`, { method: liked ? "PUT" : "DELETE" });
  return (await r.json()) as LikeResult;
}

/** The ids of the flows the logged-in user liked. */
export async function myLikedFlows(): Promise<string[]> {
  if (mock()) return mockMyLikes();
  const r = await apiFetch("/flows/me/likes");
  const body = (await r.json()) as { ids?: unknown };
  return Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
}

/** `{origin}/flows/ID`. */
export function flowLink(id: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/flows/${id}`;
}

/** The view a share link carries (the detail page's `?board=&kit=1&tier=&every=&tab=`). */
export interface FlowShareView {
  board?: Board | null;
  /** Ironman board: with the starting items. */
  kit?: boolean;
  /** Stat tier of the embed's numbers (default max). */
  tier?: TierId;
  /** Online every N cycles (default 1). */
  every?: number;
  /** The detail tab the link opens on (default the first). */
  tab?: string | null;
}

/** The share view as a query string ("" for the default view); the API's share.view_query mirrors it. */
export function flowShareQuery(view: FlowShareView = {}): string {
  const q = new URLSearchParams();
  if (view.board) {
    q.set("board", view.board);
    if (view.board === "ironman" && view.kit) q.set("kit", "1");
  }
  if (view.tier && view.tier !== "max") q.set("tier", view.tier);
  if (view.every && Math.round(view.every) !== 1) q.set("every", String(Math.round(view.every)));
  if (view.tab && view.tab !== "need") q.set("tab", view.tab);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * The link to paste into Discord etc.: the API's `/share/flow/ID` page carries the Open Graph tags
 * (title, the board numbers, author, plots, cycles) and redirects people to `/flows/ID`. The SPA
 * page itself has no per-flow meta tags, so pasting `flowLink` gives a generic embed. With a
 * `view`, the embed's numbers are that tier's at that frequency, the board's number is marked, and
 * the redirect opens the page on the same board, frequency and tab.
 */
export function flowShareLink(id: string, view?: FlowShareView): string {
  return `${SHARE_BASE_URL}/flow/${encodeURIComponent(id)}${flowShareQuery(view)}`;
}
