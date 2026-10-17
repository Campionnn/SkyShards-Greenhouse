/**
 * Leaderboard login (Discord OAuth via the SkyShards API, docs/plans/flow-leaderboard.md §6.4).
 * The API's JWT lives in localStorage (`skyshards-auth-token`); logout is client-side. A small
 * store shares the signed-in user between every `useAuth()` and fetches `/auth/me` once per load.
 */
import type { AuthUser } from "../leaderboard/api";
import { LocalStorageManager } from "../utilities/localStorageManager";
import { flowsMockEnabled, MOCK_TOKEN, MOCK_USER } from "./flowsMock";
import { REMOTE_API_BASE } from "./solverEndpoint";

export const getToken = (): string | null => LocalStorageManager.loadAuthToken();

export function setToken(token: string): void {
  LocalStorageManager.saveAuthToken(token);
  reset();
  // Mounted useAuth() hooks won't call ensureAuthLoaded again; fetch the new user for them.
  if (listeners.size) ensureAuthLoaded();
}

export function clearToken(): void {
  LocalStorageManager.clearAuthToken();
  reset();
}

/** A relative in-app path only (no protocol-relative or absolute URLs: an open redirect otherwise). */
export function safeReturnPath(path: string | null | undefined, fallback = "/flows"): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  return path;
}

export function loginUrl(returnPath: string): string {
  return `${REMOTE_API_BASE}/auth/discord/login?return=${encodeURIComponent(safeReturnPath(returnPath))}`;
}

export const AUTH_ERROR_TEXT: Record<string, string> = {
  account_too_new: "Your Discord account must be at least 30 days old to submit flows.",
  denied: "Discord login was cancelled.",
  failed: "Discord login failed. Please try again.",
  banned: "This account is banned from the leaderboard.",
};

export type AuthHash = { kind: "token"; token: string; returnPath: string } | { kind: "error"; code: string; message: string } | null;

/** Read `#token=…&return=…` or `#auth_error=…` from the callback URL's fragment. */
export function parseAuthHash(hash: string): AuthHash {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("auth_error");
  if (error) return { kind: "error", code: error, message: AUTH_ERROR_TEXT[error] ?? `Login failed (${error}).` };
  const token = params.get("token");
  if (token) return { kind: "token", token, returnPath: safeReturnPath(params.get("return")) };
  return null;
}

export class ApiError extends Error {
  readonly status: number;
  /** Extra messages from a `{detail: {errors: [...]}}` body. */
  readonly errors: string[];
  constructor(status: number, message: string, errors: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

const STATUS_TEXT: Record<number, string> = {
  401: "Your login expired. Log in with Discord again.",
  403: "This account is banned from the leaderboard.",
  404: "Not found (the flow may be hidden or deleted).",
  409: "Already done.",
  413: "The flows are too large to submit.",
  429: "Too many submissions today (5 per day). Try again tomorrow.",
};

/** A readable error from a FastAPI body: `{detail: string}`, `{detail: {errors: [...]}}` or `{detail: [{msg}]}`. */
export async function readApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = body?.detail;
  let message = "";
  let errors: string[] = [];
  if (typeof detail === "string") message = detail;
  else if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as { errors?: unknown; message?: unknown };
    if (Array.isArray(d.errors)) errors = d.errors.map(String);
    if (typeof d.message === "string") message = d.message;
  } else if (Array.isArray(detail)) errors = detail.map((d) => String((d as { msg?: unknown })?.msg ?? d));
  if (!message) message = errors.length ? errors[0] : STATUS_TEXT[response.status] ?? `Request failed (HTTP ${response.status}).`;
  return new ApiError(response.status, message, errors);
}

/**
 * fetch against the API with the bearer token when logged in. A 401 on an authenticated request
 * drops the token (logged out locally) before the error is thrown.
 */
export async function apiFetch(path: string, init: RequestInit = {}, opts: { auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = opts.auth === false ? null : getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${REMOTE_API_BASE}${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, `Could not reach the leaderboard server${e instanceof Error && e.message ? ` (${e.message})` : ""}.`);
  }
  if (!response.ok) {
    if (response.status === 401 && token) clearToken();
    throw await readApiError(response);
  }
  return response;
}

export async function fetchMe(): Promise<AuthUser> {
  if (import.meta.env.DEV && flowsMockEnabled()) return MOCK_USER;
  const r = await apiFetch("/auth/me");
  return (await r.json()) as AuthUser;
}

// ---- Shared auth state --------------------------------------------------------------------------

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** Set when /auth/me said the account is banned (403). */
  banned: boolean;
}

let state: AuthState = { user: null, loading: false, banned: false };
let started = false;
const listeners = new Set<() => void>();

const emit = (next: AuthState) => {
  state = next;
  for (const l of listeners) l();
};

function reset(): void {
  started = false;
  emit({ user: null, loading: false, banned: false });
}

export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const authSnapshot = (): AuthState => state;

/** Fetch the signed-in user once per page load (again after a login or logout). */
export function ensureAuthLoaded(): void {
  if (started) return;
  started = true;
  if (!getToken()) return;
  emit({ user: null, loading: true, banned: false });
  fetchMe()
    .then((user) => emit({ user, loading: false, banned: false }))
    .catch((e: unknown) => {
      const status = e instanceof ApiError ? e.status : 0;
      // 401 already dropped the token in apiFetch; keep it on network errors (try again next load).
      emit({ user: null, loading: false, banned: status === 403 });
    });
}

/** Leave for Discord (full page redirect); the API sends the browser back to /auth/callback. */
export function startLogin(returnPath: string): void {
  if (import.meta.env.DEV && flowsMockEnabled()) {
    setToken(MOCK_TOKEN);
    window.location.assign(safeReturnPath(returnPath));
    return;
  }
  window.location.assign(loginUrl(returnPath));
}
