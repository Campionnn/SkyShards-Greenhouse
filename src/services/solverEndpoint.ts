/**
 * Which server solves: the public API or a local solver on the user's machine.
 *
 * The local solver (https://github.com/Campionnn/SkyShards-Solver) is the same
 * solver as api.skyshards.com, started by the user on 127.0.0.1. Settings live
 * in localStorage; the services read them at call time, so flipping the toggle
 * takes effect on the next solve.
 */

export const REMOTE_API_BASE = import.meta.env.DEV ? "/api" : "https://api.skyshards.com";

export const DEFAULT_LOCAL_PORT = 8765;

const STORAGE_KEY = "skyshards-local-solver";
const CHANGE_EVENT = "skyshards-local-solver-changed";
const PROBE_TIMEOUT_MS = 1500;
const PROBE_CACHE_MS = 5000;

export interface LocalSolverSettings {
  enabled: boolean;
  port: number;
  /** Seconds per solve; null = the solver's own default budget. */
  timeLimit: number | null;
}

export interface LocalSolverHealth {
  ok: boolean;
  name: string;
  version: string;
  ortools?: string;
  contribute?: boolean;
  solver_threads?: number;
}

export interface LocalSolverRelease {
  version: string;
  download_url: string;
  repo_url: string;
}

export interface ResolvedEndpoint {
  base: string;
  local: boolean;
  /** Local mode is on but the local solver did not answer; remote is used. */
  fallback: boolean;
}

const DEFAULTS: LocalSolverSettings = { enabled: false, port: DEFAULT_LOCAL_PORT, timeLimit: null };

export function loadLocalSolverSettings(): LocalSolverSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<LocalSolverSettings>;
    const port = Number(parsed.port);
    const timeLimit = parsed.timeLimit === null || parsed.timeLimit === undefined ? null : Number(parsed.timeLimit);
    // The local solver runs on this machine and applies whatever we send, so
    // the only rule is that the number is positive.
    return {
      enabled: Boolean(parsed.enabled),
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_LOCAL_PORT,
      timeLimit: timeLimit !== null && Number.isFinite(timeLimit) && timeLimit > 0 ? timeLimit : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLocalSolverSettings(settings: LocalSolverSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable: the setting just does not persist
  }
  probeCache = null;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Subscribe to settings changes made through saveLocalSolverSettings. */
export function onLocalSolverSettingsChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function localSolverBase(port: number = loadLocalSolverSettings().port): string {
  // 127.0.0.1 rather than localhost: avoids an IPv6 (::1) first attempt that the
  // local server, bound to 127.0.0.1, would refuse.
  return `http://127.0.0.1:${port}`;
}

let probeCache: { at: number; port: number; health: LocalSolverHealth | null } | null = null;

/**
 * Ask the local solver for its health. Null when it is not running (or the
 * browser blocked the request). Results are cached briefly so the mutation
 * preview grid, which solves often, does not probe on every call.
 */
export async function probeLocalSolver(
  port: number = loadLocalSolverSettings().port,
  { force = false }: { force?: boolean } = {}
): Promise<LocalSolverHealth | null> {
  const now = Date.now();
  if (!force && probeCache && probeCache.port === port && now - probeCache.at < PROBE_CACHE_MS) {
    return probeCache.health;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let health: LocalSolverHealth | null = null;
  try {
    const response = await fetch(`${localSolverBase(port)}/local/health`, { signal: controller.signal });
    if (response.ok) {
      const data = (await response.json()) as LocalSolverHealth;
      if (data && data.ok) health = data;
    }
  } catch {
    health = null;
  } finally {
    clearTimeout(timer);
  }
  probeCache = { at: Date.now(), port, health };
  return health;
}

/** The base URL to use right now, honouring the toggle and falling back to remote. */
export async function resolveSolverEndpoint(): Promise<ResolvedEndpoint> {
  const settings = loadLocalSolverSettings();
  if (!settings.enabled) return { base: REMOTE_API_BASE, local: false, fallback: false };
  const health = await probeLocalSolver(settings.port);
  if (health) return { base: localSolverBase(settings.port), local: true, fallback: false };
  return { base: REMOTE_API_BASE, local: false, fallback: true };
}

let releaseCache: LocalSolverRelease | null = null;

/** Current release of the local solver, from the public API. Null if unreachable. */
export async function fetchLatestLocalSolver(): Promise<LocalSolverRelease | null> {
  if (releaseCache) return releaseCache;
  try {
    const response = await fetch(`${REMOTE_API_BASE}/greenhouse/local-solver`);
    if (!response.ok) return null;
    const data = (await response.json()) as LocalSolverRelease;
    if (data && data.download_url) releaseCache = data;
    return releaseCache;
  } catch {
    return null;
  }
}
