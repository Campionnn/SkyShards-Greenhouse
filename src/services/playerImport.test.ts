import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyManual,
  cleanCropFortune,
  cleanManual,
  cleanTools,
  fetchGreenhouseStats,
  IMPORT_FIELDS,
  importedFields,
  isValidUsername,
  loadManualChoices,
  MANUAL_KEY,
  manualAddAt,
  normalizeResponse,
  PlayerImportError,
  saveManualChoices,
  statsPatchFromImport,
  validChoices,
  type ManualSource,
} from "./playerImport";
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
    expect(rows.find((r) => r.field.key === "growthUpgradeTier")!.display).toBe("Tier 7 · +35%");
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

describe("friendly registry values", () => {
  const display = (stats: Record<string, unknown>, key: string) => importedFields({ stats }).find((r) => r.field.key === key)?.display;

  it("uses the shared stat option labels", () => {
    expect(display({ mutationChanceBonus: 0.1 }, "mutationChanceBonus")).toBe("Ring · +10%");
    expect(display({ growthUpgradeTier: 7 }, "growthUpgradeTier")).toBe("Tier 7 · +35%");
    expect(display({ growthUpgradeTier: 9 }, "growthUpgradeTier")).toBe("Tier 9 · +50%");
    expect(display({ evergreenChip: 0.375 }, "evergreenChip")).toBe("Epic 15 · +37.5%");
    expect(display({ evergreenChip: 0.6 }, "evergreenChip")).toBe("Legendary 20 · +60%");
    expect(display({ evergreenChip: 0 }, "evergreenChip")).toBe("None");
    expect(display({ plantYieldUpgrade: 0.14 }, "plantYieldUpgrade")).toBe("Tier 7 · +14%");
    expect(display({ floraShard: 10 }, "floraShard")).toBe("Level 10 · +10 unique");
  });
});

// A hand-made `manual` list per MANUAL_SOURCES.md (the API builds the real one).
const MANUAL = [
  {
    id: "gardenFortuneUpgrade",
    label: "Garden Farming Fortune upgrade",
    group: "permanent",
    input: "select",
    options: Array.from({ length: 11 }, (_, t) => ({ value: t, label: `Tier ${t}`, add: { farmingFortune: 4 * t } })),
    default: 10,
  },
  {
    id: "mooshroomStrength",
    label: "Mooshroom Cow Strength",
    group: "permanent",
    input: "number",
    number: { min: 0, max: 1780, step: 10, unit: "Strength", rate: { farmingFortune: 0.035 }, floor: true },
    default: 1780,
  },
  {
    id: "hyperchargeRarity",
    label: "Hypercharge Chip rarity",
    group: "chips",
    input: "select",
    options: [
      { value: "rare", label: "Rare 10", add: { hyperchargeMultiplier: 1.3 } },
      { value: "legendary", label: "Legendary 10", add: { hyperchargeMultiplier: 1.5 } },
    ],
    default: "legendary",
  },
  {
    id: "evergreenRarity",
    label: "Evergreen Chip rarity",
    group: "chips",
    input: "select",
    options: [
      { value: "rare", label: "Rare 10", add: { evergreenChip: 0.2 } },
      { value: "legendary", label: "Legendary 10", add: { evergreenChip: 0.3 } },
    ],
    default: "legendary",
  },
  {
    id: "overdriveRarity",
    label: "Overdrive Chip",
    group: "chips",
    input: "select",
    options: [
      { value: "none", label: "Not in a contest", add: {} },
      { value: "rare", label: "Rare 4", add: { cropFortune: { wheat: 20, carrot: 20 } } },
      { value: "legendary", label: "Legendary 4", add: { cropFortune: { wheat: 28, carrot: 28 } } },
    ],
    default: "legendary",
  },
  {
    id: "masonJar",
    label: "Celestial Mason Jar",
    group: "temporary",
    condition: "Mixin active",
    input: "select",
    options: [
      { value: 0, label: "Off", add: {} },
      { value: 1, label: "On", add: { farmingFortune: 15 } },
    ],
    default: 1,
    hypercharged: true,
  },
  {
    id: "cropFever",
    label: "Crop Fever",
    group: "temporary",
    input: "select",
    options: [
      { value: 0, label: "Off", add: {} },
      { value: 1, label: "On", add: { farmingFortune: 100, overbloom: 15 } },
    ],
    default: 1,
    hypercharged: true,
  },
];

describe("manual sources", () => {
  // Server stats at the defaults: FF = base 1000 + 40 + floor(1780 × 0.035)=62 + (15 + 100) × 1.5 = 1274.5.
  const resp = normalizeResponse({
    stats: { farmingFortune: 1274.5, overbloom: 115, evergreenChip: 0.3, cropFortune: { wheat: 78, carrot: 28, potato: 10 } },
    manual: MANUAL as unknown as ManualSource[],
  });

  it("keeps well-formed sources and drops malformed ones", () => {
    const cleaned = cleanManual([
      ...MANUAL,
      { id: "noOptions", label: "x", group: "permanent", input: "select", options: [], default: 0 },
      { id: "badDefault", label: "x", group: "permanent", input: "select", options: [{ value: 1, label: "a", add: {} }], default: 5 },
      { id: "badGroup", label: "x", group: "weird", input: "select", options: [{ value: 1, label: "a", add: {} }], default: 1 },
      { id: "badNumber", label: "x", group: "permanent", input: "number", number: { min: 5, max: 1 }, default: 1 },
      { id: "gardenFortuneUpgrade", label: "duplicate", group: "permanent", input: "select", options: [{ value: 1, label: "a", add: {} }], default: 1 },
      { label: "no id" },
      null,
      "junk",
    ]);
    expect(cleaned.map((s) => s.id)).toEqual(MANUAL.map((s) => s.id));
    expect(cleanManual("nope")).toEqual([]);
    expect(normalizeResponse({}).manual).toEqual([]);
  });

  it("is the identity at the defaults (or with no choices)", () => {
    expect(applyManual(resp, {})).toEqual(resp.stats);
    expect(applyManual(resp)).toEqual(resp.stats);
    expect(applyManual(resp, { gardenFortuneUpgrade: 10, masonJar: 1 })).toEqual(resp.stats);
  });

  it("swaps a select source's add", () => {
    expect(applyManual(resp, { gardenFortuneUpgrade: 3 }).farmingFortune).toBe(1274.5 - 28);
  });

  it("floors a number source per stat", () => {
    // floor(1000 × 0.035) = 35 vs 62 at max.
    expect(applyManual(resp, { mooshroomStrength: 1000 }).farmingFortune).toBe(1274.5 - 27);
    // floor(15 × 0.035 = 0.525) = 0.
    expect(applyManual(resp, { mooshroomStrength: 15 }).farmingFortune).toBe(1274.5 - 62);
    expect(manualAddAt(cleanManual(MANUAL)[1], 1780)).toEqual({ farmingFortune: 62 });
  });

  it("scales hypercharged FF by the chosen multiplier", () => {
    // (15 + 100) × (1.3 − 1.5) = −23.
    expect(applyManual(resp, { hyperchargeRarity: "rare" }).farmingFortune).toBeCloseTo(1274.5 - 23, 6);
    // Mason Jar off: −15 × 1.5.
    expect(applyManual(resp, { masonJar: 0 }).farmingFortune).toBeCloseTo(1274.5 - 22.5, 6);
    // Both: only Crop Fever stays hypercharged, at the lower multiplier: 100 × 1.3 − 115 × 1.5.
    expect(applyManual(resp, { masonJar: 0, hyperchargeRarity: "rare" }).farmingFortune).toBeCloseTo(1274.5 + 130 - 172.5, 6);
  });

  it("adjusts overbloom and clamps evergreen to 0..0.6", () => {
    const off = applyManual(resp, { cropFever: 0 });
    expect(off.overbloom).toBe(100);
    expect(off.farmingFortune).toBeCloseTo(1274.5 - 150, 6);
    expect(applyManual(resp, { evergreenRarity: "rare" }).evergreenChip).toBeCloseTo(0.2, 9);
    const high = normalizeResponse({ stats: { evergreenChip: 0.6 }, manual: MANUAL as unknown as ManualSource[] });
    const custom = { ...high, manual: high.manual!.map((s) => (s.id === "evergreenRarity" ? { ...s, default: "rare" } : s)) };
    expect(applyManual(custom, { evergreenRarity: "legendary" }).evergreenChip).toBe(0.6);
  });

  it("adjusts crop fortune per crop and drops crops at or below 0", () => {
    const cf = applyManual(resp, { overdriveRarity: "none" }).cropFortune;
    expect(cf).toEqual({ wheat: 50, potato: 10 });
    expect(applyManual(resp, { overdriveRarity: "rare" }).cropFortune).toEqual({ wheat: 70, carrot: 20, potato: 10 });
  });

  it("ignores invalid or stale choices", () => {
    expect(applyManual(resp, { gardenFortuneUpgrade: 99, hyperchargeRarity: "mythic", unknownSource: 3 })).toEqual(resp.stats);
    expect(applyManual(resp, { mooshroomStrength: 99999 }).farmingFortune).toBe(1274.5);
    expect(validChoices(resp.manual!, { gardenFortuneUpgrade: 3, mooshroomStrength: 99999, stale: 1, hyperchargeRarity: "rare" })).toEqual({
      gardenFortuneUpgrade: 3,
      hyperchargeRarity: "rare",
    });
  });

  it("feeds the patch and the imported list", () => {
    const patch = statsPatchFromImport(resp, ["farmingFortune", "cropFortune"], { gardenFortuneUpgrade: 0, overdriveRarity: "none" });
    expect(patch).toEqual({ farmingFortune: 1234.5, cropFortune: { wheat: 50, potato: 10 } });
    expect(importedFields(resp, { evergreenRarity: "rare" }).find((r) => r.field.key === "evergreenChip")!.display).toBe("Rare 10 · +20%");
  });

  it("remembers choices in localStorage, valid values only", () => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v) });
    saveManualChoices({ gardenFortuneUpgrade: 3, hyperchargeRarity: "rare", bad: NaN });
    expect(JSON.parse(map.get(MANUAL_KEY)!)).toEqual({ gardenFortuneUpgrade: 3, hyperchargeRarity: "rare" });
    map.set(MANUAL_KEY, JSON.stringify({ a: 1, b: { x: 1 }, c: "on" }));
    expect(loadManualChoices()).toEqual({ a: 1, c: "on" });
    map.set(MANUAL_KEY, "not json");
    expect(loadManualChoices()).toEqual({});
    vi.unstubAllGlobals();
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
