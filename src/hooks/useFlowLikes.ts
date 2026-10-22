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

function loadFor(userId: string | null): void {
  if (loadedFor === userId) return;
  loadedFor = userId;
  emit({ liked: null });
  if (!userId) return;
  myLikedFlows()
    .then((ids) => loadedFor === userId && emit({ liked: new Set(ids) }))
    .catch(() => loadedFor === userId && emit({ liked: new Set() }));
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
        login();
        return;
      }
      if (state.busy.has(id)) return;
      emit({ busy: new Set([...state.busy, id]) });
      try {
        const r = await setFlowLike(id, liked);
        const next = new Set(state.liked ?? []);
        if (r.liked) next.add(id);
        else next.delete(id);
        emit({ liked: next, counts: { ...state.counts, [id]: { likes: r.likes, likes30d: r.likes30d } } });
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
