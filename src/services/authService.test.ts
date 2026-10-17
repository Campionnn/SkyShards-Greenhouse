import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A minimal localStorage for the node test environment. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("authService: token handling", () => {
  it("stores, reads and clears the token under skyshards-auth-token", async () => {
    const auth = await import("./authService");
    expect(auth.getToken()).toBeNull();
    auth.setToken("abc.def.ghi");
    expect(localStorage.getItem("skyshards-auth-token")).toBe("abc.def.ghi");
    expect(auth.getToken()).toBe("abc.def.ghi");
    auth.clearToken();
    expect(auth.getToken()).toBeNull();
  });

  it("parses the callback fragment and only returns to in-app paths", async () => {
    const { parseAuthHash } = await import("./authService");
    expect(parseAuthHash("#token=t1&return=%2Fsimulator%3Fx%3D1")).toEqual({ kind: "token", token: "t1", returnPath: "/simulator?x=1" });
    expect(parseAuthHash("#token=t1")).toEqual({ kind: "token", token: "t1", returnPath: "/flows" });
    expect(parseAuthHash("#token=t1&return=https%3A%2F%2Fevil.example")).toMatchObject({ returnPath: "/flows" });
    expect(parseAuthHash("#token=t1&return=%2F%2Fevil.example")).toMatchObject({ returnPath: "/flows" });
    expect(parseAuthHash("#auth_error=account_too_new")).toMatchObject({ kind: "error", code: "account_too_new", message: expect.stringContaining("30 days") });
    expect(parseAuthHash("#auth_error=weird")).toMatchObject({ kind: "error", message: "Login failed (weird)." });
    expect(parseAuthHash("")).toBeNull();
  });

  it("builds the login URL with the return path", async () => {
    const { loginUrl } = await import("./authService");
    expect(loginUrl("/flows/abc")).toMatch(/\/auth\/discord\/login\?return=%2Fflows%2Fabc$/);
  });

  it("sends the bearer token and drops it on a 401", async () => {
    const auth = await import("./authService");
    auth.setToken("tok");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "expired" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(auth.fetchMe()).rejects.toMatchObject({ status: 401, message: "expired" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(auth.getToken()).toBeNull();
  });

  it("keeps the token on a 403 (banned) and reads {detail: {errors}} bodies", async () => {
    const auth = await import("./authService");
    auth.setToken("tok");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "banned" }), { status: 403 })));
    await expect(auth.fetchMe()).rejects.toMatchObject({ status: 403 });
    expect(auth.getToken()).toBe("tok");
    const err = await auth.readApiError(new Response(JSON.stringify({ detail: { errors: ["Plot 1: bad", "Plot 2: worse"] } }), { status: 400 }));
    expect(err.message).toBe("Plot 1: bad");
    expect(err.errors).toEqual(["Plot 1: bad", "Plot 2: worse"]);
    const fallback = await auth.readApiError(new Response("nope", { status: 429 }));
    expect(fallback.message).toMatch(/5 per day/);
  });

  it("loads the user once and shares it", async () => {
    const auth = await import("./authService");
    auth.setToken("tok");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "1", username: "u", global_name: null, avatar: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    auth.ensureAuthLoaded();
    auth.ensureAuthLoaded();
    expect(auth.authSnapshot().loading).toBe(true);
    await vi.waitFor(() => expect(auth.authSnapshot().user?.username).toBe("u"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    auth.clearToken();
    expect(auth.authSnapshot().user).toBeNull();
  });
});
