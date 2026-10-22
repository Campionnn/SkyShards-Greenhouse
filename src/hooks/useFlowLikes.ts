import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { LikeCounts } from "../leaderboard/view";
import { myLikedFlows, setFlowLike } from "../services/flowsService";
import { useAuth } from "./useAuth";

/**
 * The viewer's likes, shared by the ranking and detail pages for the session: which flows they
 * liked (`GET /flows/me/likes`, once per login) and the counts the server returned for each like
 * they changed, so the cached list shows them without a refetch.
 */
interface LikesState {
  /** null until loaded (or when logged out). */
  liked: ReadonlySet<string> | null;
  counts: LikeCounts;
  /** Requests in flight, by flow id. */
  busy: ReadonlySet<string>;
}

let state: LikesState = { liked: null, counts: {}, busy: new Set() };
let loadedFor: string | null = null;
const listeners = new Set<() => void>();
const emit = (patch: Partial<LikesState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;
const SERVER: LikesState = { liked: null, counts: {}, busy: new Set() };

/**
 * A like clicked while logged out, kept across the Discord redirect (sessionStorage, this tab
 * only) and applied once the login is back. Older than PENDING_MAX_MS = abandoned.
 */
const PENDING_KEY = "skyshards-pending-like";
const PENDING_MAX_MS = 15 * 60_000;

export function savePendingLike(id: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id, at: now }));
  } catch {
    // storage unavailable: the like is just not replayed
  }
}

/** Read and clear the pending like; null when none, malformed or stale. */
export function takePendingLike(now = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const p = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof p.id !== "string" || typeof p.at !== "number" || now - p.at > PENDING_MAX_MS || now < p.at) return null;
    return p.id;
  } catch {
    return null;
  }
}

/** Apply the server's reply to the store. */
function applyLike(id: string, liked: boolean, likes: number, likes30d: number): void {
  const next = new Set(state.liked ?? []);
  if (liked) next.add(id);
  else next.delete(id);
  emit({ liked: next, counts: { ...state.counts, [id]: { likes, likes30d } } });
}

/** Listeners for "a like clicked before logging in was saved" (the pages show a toast). */
const replayListeners = new Set<(id: string, ok: boolean, error?: string) => void>();

function loadFor(userId: string | null): void {
  if (loadedFor === userId) return;
  loadedFor = userId;
  emit({ liked: null });
  if (!userId) return;
  myLikedFlows()
    .catch(() => [] as string[])
    .then(async (ids) => {
      if (loadedFor !== userId) return;
      emit({ liked: new Set(ids) });
      const pending = takePendingLike();
      if (!pending || ids.includes(pending)) return;
      try {
        const r = await setFlowLike(pending, true);
        if (loadedFor === userId) applyLike(pending, r.liked, r.likes, r.likes30d);
        for (const l of replayListeners) l(pending, true);
      } catch (e) {
        for (const l of replayListeners) l(pending, false, e instanceof Error ? e.message : String(e));
      }
    });
}

export interface FlowLikes {
  /** Whether the viewer liked `id`; `fallback` (e.g. the detail's `liked`) until the list loads. */
  isLiked: (id: string, fallback?: boolean) => boolean;
  counts: LikeCounts;
  busy: (id: string) => boolean;
  /** Toggle a like; logged-out viewers are sent to the Discord login first. Throws on API errors. */
  toggle: (id: string, liked: boolean) => Promise<void>;
  loggedIn: boolean;
}

export function useFlowLikes(): FlowLikes {
  const { user, loading, login } = useAuth();
  const s = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!loading) loadFor(userId);
  }, [userId, loading]);

  const isLiked = useCallback((id: string, fallback = false) => (s.liked ? s.liked.has(id) : fallback), [s.liked]);
  const busy = useCallback((id: string) => s.busy.has(id), [s.busy]);
  const toggle = useCallback(
    async (id: string, liked: boolean) => {
      if (!userId) {
        // Liked again right after the login comes back.
        if (liked) savePendingLike(id);
        login();
        return;
      }
      if (state.busy.has(id)) return;
      emit({ busy: new Set([...state.busy, id]) });
      try {
        const r = await setFlowLike(id, liked);
        applyLike(id, r.liked, r.likes, r.likes30d);
      } finally {
        const b = new Set(state.busy);
        b.delete(id);
        emit({ busy: b });
      }
    },
    [userId, login]
  );
  return { isLiked, counts: s.counts, busy, toggle, loggedIn: !!userId };
}

/** Call `onReplay` when a like clicked before logging in is saved (or fails) after the login. */
export function useLikeReplay(onReplay: (id: string, ok: boolean, error?: string) => void): void {
  useEffect(() => {
    replayListeners.add(onReplay);
    return () => {
      replayListeners.delete(onReplay);
    };
  }, [onReplay]);
}
