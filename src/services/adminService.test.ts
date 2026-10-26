import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A minimal Storage for the node test environment. */
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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const callOf = (m: ReturnType<typeof vi.fn>, i = 0) => m.mock.calls[i] as unknown as [string, RequestInit];

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("adminService", () => {
  it("keeps the key in sessionStorage only", async () => {
    const admin = await import("./adminService");
    expect(admin.getAdminKey()).toBeNull();
    admin.setAdminKey("s3cret");
    expect(sessionStorage.getItem("skyshards-admin-key")).toBe("s3cret");
    expect(localStorage.getItem("skyshards-admin-key")).toBeNull();
    expect(admin.getAdminKey()).toBe("s3cret");
    admin.clearAdminKey();
    expect(admin.getAdminKey()).toBeNull();
  });

  it("verifies a key with POST /greenhouse/admin/verify and the X-Admin-Key header", async () => {
    const admin = await import("./adminService");
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await admin.verifyAdminKey(" k1 ");
    const [url, init] = callOf(fetchMock);
    expect(url).toMatch(/\/greenhouse\/admin\/verify$/);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("X-Admin-Key")).toBe("k1");
    // verify alone doesn't store the key (the page does on success).
    expect(admin.getAdminKey()).toBeNull();
  });

  it("explains a wrong key (401) and a server without admin (404)", async () => {
    const admin = await import("./adminService");
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "Authentication required" }, 401)));
    await expect(admin.verifyAdminKey("bad")).rejects.toMatchObject({ status: 401, message: "Wrong admin key." });
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "Endpoint not available" }, 404)));
    await expect(admin.verifyAdminKey("bad")).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/no admin key/) });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(admin.verifyAdminKey("x")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("offline") });
    await expect(admin.verifyAdminKey("  ")).rejects.toMatchObject({ status: 401 });
  });

  it("lists with the status filter and normalises raw rows", async () => {
    const admin = await import("./adminService");
    admin.setAdminKey("k");
    const fetchMock = vi.fn(async () =>
      json({
        entries: [
          { id: "abc", owner_id: 123, title: "T", boards: "ironman,normal", cycles: "2000", plots: 2, status: "hidden", hidden_reason: "reports", report_count: 3, hidden_by_admin: 0, created_at: 1700000000, extra: "ignored" },
          { id: "def" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await admin.adminListFlows("reported");
    expect(callOf(fetchMock)[0]).toMatch(/\/greenhouse\/admin\/flows\?status=reported$/);
    expect(new Headers(callOf(fetchMock)[1].headers).get("X-Admin-Key")).toBe("k");
    expect(rows[0]).toMatchObject({ id: "abc", owner_id: "123", boards: ["ironman", "normal"], cycles: 2000, hidden_reason: "reports", report_count: 3, hidden_by_admin: false, reports: [] });
    expect(rows[0]).not.toHaveProperty("extra");
    expect(rows[1]).toMatchObject({ id: "def", title: "(untitled)", boards: [], status: "unknown", reject_reason: null });
    await admin.adminListFlows();
    expect(callOf(fetchMock, 1)[0]).toMatch(/\/greenhouse\/admin\/flows$/);
  });

  it("posts the moderation actions and the ban reason", async () => {
    const admin = await import("./adminService");
    admin.setAdminKey("k");
    const fetchMock = vi.fn(async (url: string) => json(url.endsWith("/unhide") ? { id: "a", status: "live" } : { id: "a", status: "hidden" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await admin.adminHide("a")).toBe("hidden");
    expect(await admin.adminUnhide("a")).toBe("live");
    await admin.adminDelete("a");
    await admin.adminBan("42", "spam");
    await admin.adminUnban("42");
    const calls = fetchMock.mock.calls.map((c) => c as unknown as [string, RequestInit]);
    expect(calls.map(([u]) => u.replace(/^.*\/greenhouse\/admin/, ""))).toEqual(["/flows/a/hide", "/flows/a/unhide", "/flows/a/delete", "/users/42/ban", "/users/42/unban"]);
    expect(calls.every(([, i]) => i.method === "POST" && new Headers(i.headers).get("X-Admin-Key") === "k")).toBe(true);
    expect(JSON.parse(String(calls[3][1].body))).toEqual({ reason: "spam" });
    expect(calls[4][1].body).toBeUndefined();
  });

  it("sets a user's own submission limit, or back to the default with null", async () => {
    const admin = await import("./adminService");
    admin.setAdminKey("k");
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { limit } = JSON.parse(String(init.body)) as { limit: number | null };
      return json({ id: "42", limit, effectiveLimit: limit ?? 5, used24h: 3 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await admin.adminSetSubmissionLimit("42", 50)).toEqual({ limit: 50, effectiveLimit: 50, used24h: 3 });
    expect(await admin.adminSetSubmissionLimit("42", null)).toEqual({ limit: null, effectiveLimit: 5, used24h: 3 });
    const calls = fetchMock.mock.calls.map((c) => c as unknown as [string, RequestInit]);
    expect(calls[0][0]).toMatch(/\/greenhouse\/admin\/users\/42\/limit$/);
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ limit: null });
    await expect(admin.adminSetSubmissionLimit("42", -1)).rejects.toMatchObject({ status: 422 });
    await expect(admin.adminSetSubmissionLimit("42", 2.5)).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(admin.normalizeAdminRow({ id: "a", author_submission_limit: 50 }).author_submission_limit).toBe(50);
    expect(admin.normalizeAdminRow({ id: "a" }).author_submission_limit).toBeNull();
  });

  it("drops the stored key on a 401 and needs a key at all", async () => {
    const admin = await import("./adminService");
    await expect(admin.adminHide("a")).rejects.toMatchObject({ status: 401 });
    admin.setAdminKey("old");
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "Authentication required" }, 401)));
    await expect(admin.adminListFlows()).rejects.toMatchObject({ status: 401, message: "Wrong admin key." });
    expect(admin.getAdminKey()).toBeNull();
    admin.setAdminKey("k");
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "User not found" }, 404)));
    await expect(admin.adminBan("1", "")).rejects.toMatchObject({ status: 404, message: "User not found" });
    expect(admin.getAdminKey()).toBe("k");
  });

  it("getFlow sends the admin key when given", async () => {
    const { getFlow } = await import("./flowsService");
    const fetchMock = vi.fn(async () => json({ id: "a" }));
    vi.stubGlobal("fetch", fetchMock);
    await getFlow("a", { adminKey: "k" });
    expect(new Headers(callOf(fetchMock)[1].headers).get("X-Admin-Key")).toBe("k");
    await getFlow("a");
    expect(new Headers(callOf(fetchMock, 1)[1].headers).get("X-Admin-Key")).toBeNull();
  });

  it("labels hidden reasons", async () => {
    const { hiddenReasonLabel } = await import("./adminService");
    expect(hiddenReasonLabel("reports")).toBe("by reports");
    expect(hiddenReasonLabel("admin")).toBe("by admin");
    expect(hiddenReasonLabel("ban")).toBe("banned");
    expect(hiddenReasonLabel(null)).toBeNull();
  });
});
