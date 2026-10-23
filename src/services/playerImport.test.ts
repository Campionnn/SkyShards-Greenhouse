import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanCropFortune, cleanTools, fetchGreenhouseStats, IMPORT_FIELDS, importedFields, isValidUsername, normalizeResponse, PlayerImportError, statsPatchFromImport } from "./playerImport";
import { REMOTE_API_BASE } from "./solverEndpoint";

const field = (key: string) => IMPORT_FIELDS.find((f) => f.key === key)!;

describe("IMPORT_FIELDS", () => {
  it("has one row per key", () => {
    const keys = IMPORT_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("clamps numeric fields to their ranges and rounds integer fields", () => {
    expect(field("floraShard").apply(12)).toEqual({ floraShard: 10 });
    expect(field("floraShard").apply(4.6)).toEqual({ floraShard: 5 });
    expect(field("speedAttribute").apply(-3)).toEqual({ speedAttribute: 0 });
    expect(field("cropGrowth").apply(400)).toEqual({ cropGrowth: 210 });
    expect(field("growthUpgradeTier").apply(9.4)).toEqual({ growthUpgradeTier: 9 });
    expect(field("plantYieldUpgrade").apply(0.5)).toEqual({ plantYieldUpgrade: 0.2 });
    expect(field("evergreenChip").apply(0.45)).toEqual({ evergreenChip: 0.45 });
    expect(field("evergreenChip").apply(1)).toEqual({ evergreenChip: 0.6 });
    expect(field("overbloom").apply(-1)).toEqual({ overbloom: 0 });
    expect(field("farmingFortune").apply(1234.5)).toEqual({ farmingFortune: 1234.5 });
  });

  it("drops non-finite and non-number values", () => {
    for (const key of ["farmingFortune", "floraShard", "cropGrowth", "overbloom", "mutationChanceBonus"]) {
      expect(field(key).apply(NaN)).toBeNull();
      expect(field(key).apply(Infinity)).toBeNull();
      expect(field(key).apply("12")).toBeNull();
      expect(field(key).apply(null)).toBeNull();
    }
  });

  it("only accepts the Bioanalysis tiers and known armor sets", () => {
    expect(field("mutationChanceBonus").apply(0.15)).toEqual({ mutationChanceBonus: 0.15 });
    expect(field("mutationChanceBonus").apply(0.1)).toEqual({ mutationChanceBonus: 0.1 });
    expect(field("mutationChanceBonus").apply(0.07)).toBeNull();
    expect(field("armorSet").apply("helianthus")).toEqual({ armorSet: "helianthus" });
    expect(field("armorSet").apply("melon")).toBeNull();
    expect(field("armorSet").apply(3)).toBeNull();
  });

  it("cleans crop fortune to FORTUNE_CROPS keys with finite values ≥ 0", () => {
    expect(cleanCropFortune({ wheat: 85, mushroom: 60, seeds: 10, wheat_x: 1, carrot: -5, potato: NaN, melon: "3", cactus: 0 })).toEqual({ wheat: 85, mushroom: 60 });
    expect(cleanCropFortune({ foo: 1 })).toBeNull();
    expect(cleanCropFortune([1, 2])).toBeNull();
    expect(cleanCropFortune(null)).toBeNull();
  });

  it("cleans tools: needs a name, fortune is cleaned", () => {
    expect(cleanTools([{ name: " Euclid's Wheat Hoe ", fortune: { wheat: 310, carrot: 120, bogus: 5 } }, { fortune: { wheat: 1 } }, { name: "", fortune: {} }, null, { name: "Bare" }])).toEqual([
      { name: "Euclid's Wheat Hoe", fortune: { wheat: 310, carrot: 120 } },
      { name: "Bare", fortune: {} },
    ]);
    expect(cleanTools([])).toBeNull();
    expect(cleanTools({ name: "x" })).toBeNull();
  });
});

describe("statsPatchFromImport", () => {
  const resp = {
    stats: {
      farmingFortune: 1500,
      cropFortune: { wheat: 40 },
      tools: [{ name: "Hoe", fortune: { wheat: 200 } }],
      floraShard: 10,
      growthUpgradeTier: 7,
      armorSet: "nope",
      unknownFutureKey: 42,
    },
  };

  it("builds the patch from every valid known key and ignores unknown or invalid ones", () => {
    expect(statsPatchFromImport(resp)).toEqual({
      farmingFortune: 1500,
      cropFortune: { wheat: 40 },
      tools: [{ name: "Hoe", fortune: { wheat: 200 } }],
      floraShard: 10,
      growthUpgradeTier: 7,
    });
  });

  it("limits the patch to the selected keys", () => {
    expect(statsPatchFromImport(resp, ["farmingFortune", "tools", "armorSet"])).toEqual({ farmingFortune: 1500, tools: [{ name: "Hoe", fortune: { wheat: 200 } }] });
    expect(statsPatchFromImport(resp, [])).toEqual({});
  });

  it("lists imported fields in registry order with readable values", () => {
    const rows = importedFields(resp);
    expect(rows.map((r) => r.field.key)).toEqual(["farmingFortune", "cropFortune", "tools", "floraShard", "growthUpgradeTier"]);
    expect(rows.find((r) => r.field.key === "growthUpgradeTier")!.display).toBe("Tier 7");
    expect(rows.find((r) => r.field.key === "tools")!.display).toBe("Hoe");
  });

  it("survives a missing stats object", () => {
    expect(statsPatchFromImport(normalizeResponse({}))).toEqual({});
  });

  it("normalises the item counts", () => {
    const r = normalizeResponse({
      items: { godseed: 6, dead_plant: 210.9, bad: -1, worse: "x" } as unknown as Record<string, number>,
      itemSources: { dead_plant: { sacks: 64, inventory: 146, junk: Number.NaN } },
    });
    expect(r.items).toEqual({ godseed: 6, dead_plant: 210 });
    expect(r.itemSources).toEqual({ dead_plant: { sacks: 64, inventory: 146 } });
    // Inventory API off (null) vs an older server (no key).
    expect(normalizeResponse({ items: null }).items).toBeNull();
    expect(normalizeResponse({}).items).toBeUndefined();
  });
});

describe("fetchGreenhouseStats", () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) => vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

  it("validates the username", () => {
    expect(isValidUsername("Ke5o")).toBe(true);
    expect(isValidUsername("a_b_1")).toBe(true);
    expect(isValidUsername("")).toBe(false);
    expect(isValidUsername("bad name")).toBe(false);
    expect(isValidUsername("x".repeat(26))).toBe(false);
  });

  it("rejects an invalid username without fetching", async () => {
    const fetchMock = ok({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchGreenhouseStats("../etc")).rejects.toBeInstanceOf(PlayerImportError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the SkyShards endpoint, with ?profile= when given, and normalises the answer", async () => {
    const fetchMock = ok({ username: "Ke5o", uuid: "u", profileId: "p2", profiles: [{ profileId: "p2", cuteName: "Raspberry", gameMode: null, selected: true }, { bad: 1 }], stats: { floraShard: 3 } });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchGreenhouseStats(" Ke5o ");
    expect(fetchMock.mock.calls[0][0]).toBe(`${REMOTE_API_BASE}/skyshards/greenhouse-stats/Ke5o`);
    expect(r.profiles).toEqual([{ profileId: "p2", cuteName: "Raspberry", gameMode: null, selected: true }]);
    expect(r.missing).toEqual([]);
    await fetchGreenhouseStats("Ke5o", "abc-123");
    expect(fetchMock.mock.calls[1][0]).toBe(`${REMOTE_API_BASE}/skyshards/greenhouse-stats/Ke5o?profile=abc-123`);
  });

  it("turns HTTP errors and network failures into readable messages", async () => {
    const status = (code: number, detail = "x") => vi.fn(async () => new Response(JSON.stringify({ detail }), { status: code }));
    vi.stubGlobal("fetch", status(404, "Player 'Nobody' not found"));
    await expect(fetchGreenhouseStats("Nobody")).rejects.toMatchObject({ status: 404, message: 'Player "Nobody" not found.' });
    vi.stubGlobal("fetch", status(404, "No SkyBlock profiles"));
    await expect(fetchGreenhouseStats("Nobody")).rejects.toMatchObject({ message: "Nobody has no SkyBlock profiles." });
    vi.stubGlobal("fetch", status(429));
    await expect(fetchGreenhouseStats("a")).rejects.toMatchObject({ status: 429, message: expect.stringContaining("Wait a minute") });
    vi.stubGlobal("fetch", status(502));
    await expect(fetchGreenhouseStats("a")).rejects.toMatchObject({ status: 502, message: expect.stringContaining("Hypixel") });
    vi.stubGlobal("fetch", status(503));
    await expect(fetchGreenhouseStats("a")).rejects.toMatchObject({ status: 503, message: expect.stringContaining("unavailable") });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    await expect(fetchGreenhouseStats("a")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("Could not reach") });
  });
});
