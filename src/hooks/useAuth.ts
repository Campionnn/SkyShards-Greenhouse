import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AuthUser } from "../leaderboard/api";
import { authSnapshot, clearToken, ensureAuthLoaded, startLogin, subscribeAuth, type AuthState } from "../services/authService";

const SERVER_STATE: AuthState = { user: null, loading: false, banned: false };

export interface AuthView {
  user: AuthUser | null;
  loading: boolean;
  banned: boolean;
  /** Full-page redirect to Discord; comes back to `returnPath` (default: the current path). */
  login: (returnPath?: string) => void;
  logout: () => void;
}

/** The leaderboard login, shared by every component (one /auth/me per page load). */
export function useAuth(): AuthView {
  const state = useSyncExternalStore(subscribeAuth, authSnapshot, () => SERVER_STATE);
  useEffect(() => ensureAuthLoaded(), []);
  const login = useCallback((returnPath?: string) => {
    startLogin(returnPath ?? `${window.location.pathname}${window.location.search}`);
  }, []);
  const logout = useCallback(() => clearToken(), []);
  return { user: state.user, loading: state.loading, banned: state.banned, login, logout };
}
