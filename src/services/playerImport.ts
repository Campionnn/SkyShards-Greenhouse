/**
 * Player stats import (docs/plans/player-stats-import.md). SkyShards-API reads Hypixel and computes
 * the Greenhouse-relevant stats; this module fetches them and turns them into a `PlayerStats` patch.
 *
 * The field registry `IMPORT_FIELDS` has one row per `stats` key of the response: a label and an
 * `apply` that validates/clamps the raw value into a patch (or null = drop it). Adding a field later
 * = the server adds a key and this file adds one row. Unknown keys are ignored.
 */
import { ARMOR_SET_LABEL, ARMOR_SETS, FORTUNE_CROPS, type ArmorSet, type CropFortune, type FarmingToolStats, type FortuneCrop } from "../simulator";
import type { PlayerStats } from "../simulator/sim/state";
import {
  BIOANALYSIS_OPTIONS,
  chipFromValue,
  CHIP_RARITIES,
  CHIP_RARITY_LABEL,
  EVERGREEN_CHIP,
  FLORA_OPTIONS,
  GROWTH_UPGRADE_OPTIONS,
  nearestOption,
  PLANT_YIELD_OPTIONS,
  SPEED_ATTRIBUTE_OPTIONS,
  STAT_FIELDS,
  type StatOption,
} from "../components/playerStats/statFields";
import { REMOTE_API_BASE } from "./solverEndpoint";

// ---- Response ------------------------------------------------------------------------------------

export interface ImportProfile {
  profileId: string;
  cuteName: string;
  /** null = normal; "ironman", "island" (stranded), "bingo", ... */
  gameMode: string | null;
  selected: boolean;
}

/** Per-source breakdown for the details disclosure. Values are fortune points. */
export interface ImportBreakdown {
  general?: Record<string, number>;
  crop?: Record<string, Record<string, number>>;
  tools?: Record<string, Record<string, Record<string, number>>>;
}

export interface GreenhouseStatsResponse {
  username: string;
  uuid: string;
  profileId: string;
  profiles: ImportProfile[];
  /** Every key optional and untrusted: run it through `statsPatchFromImport`. */
  stats: Record<string, unknown>;
  breakdown?: ImportBreakdown;
  missing?: string[];
  /**
   * Greenhouse items owned (every mutation, Dead Plants, Fermento, Aloe fragments), summed over
   * sacks, ender chest, backpacks and inventory: item id -> count. Null when the player's
   * Inventory API is off; missing on an older server.
   */
  items?: Record<string, number> | null;
  /** Where each item was found: item id -> source ("sacks", "enderChest", "backpacks", "inventory") -> count. */
  itemSources?: Record<string, Record<string, number>>;
  /**
   * Sources the API can't read, set by the player (SkyShards-API docs/fortune/MANUAL_SOURCES.md).
   * `stats` already counts each at its `default` (= max); `applyManual` swaps in the player's choices.
   */
  manual?: ManualSource[];
}

// ---- Manual sources ------------------------------------------------------------------------------

export type ManualGroup = "permanent" | "chips" | "temporary";

export const MANUAL_GROUPS: readonly ManualGroup[] = ["permanent", "chips", "temporary"];

/** The absolute contribution of one manual source at one setting (not a delta). */
export interface ManualAdd {
  farmingFortune?: number;
  cropFortune?: CropFortune;
  overbloom?: number;
  /** Fraction, like `PlayerStats.evergreenChip`. */
  evergreenChip?: number;
  /** Hypercharge Chip only: 1 + per-level × level; scales the farmingFortune of `hypercharged` sources. */
  hyperchargeMultiplier?: number;
}

export type ManualValue = number | string;

export interface ManualOption {
  value: ManualValue;
  label: string;
  add: ManualAdd;
}

export interface ManualNumberSpec {
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** add[stat] = rate[stat] × value (cropFortune per crop). */
  rate: ManualAdd;
  /** Floor each stat (and each crop) after multiplying. */
  floor?: boolean;
}

export interface ManualSource {
  id: string;
  label: string;
  group: ManualGroup;
  hint?: string;
  /** When it applies, for temporary / conditional sources ("Spring only"). */
  condition?: string;
  input: "select" | "number";
  options?: ManualOption[];
  number?: ManualNumberSpec;
  /** The setting `stats` was computed with: the max option / number max. */
  default: ManualValue;
  hypercharged?: boolean;
}

/** The player's settings: source id → value. Ids not in the response are ignored. */
export type ManualChoices = Record<string, ManualValue>;

const MODE_LABEL: Record<string, string> = { ironman: "Ironman", island: "Stranded", bingo: "Bingo" };

/** "Raspberry" / "Banana (Ironman)". */
export const profileLabel = (p: ImportProfile): string => `${p.cuteName}${p.gameMode ? ` (${MODE_LABEL[p.gameMode] ?? p.gameMode})` : ""}`;

/** Readable names of the `itemSources` keys. */
export const ITEM_SOURCE_LABEL: Record<string, string> = { sacks: "sacks", enderChest: "ender chest", backpacks: "backpacks", inventory: "inventory" };

/** Whole, non-negative counts only; anything else is dropped. */
function cleanCounts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

export class PlayerImportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PlayerImportError";
    this.status = status;
  }
}

export const USERNAME_RE = /^[A-Za-z0-9_]{1,25}$/;

/** The last username imported, shared by every import box (simulator, leaderboard, Guide). */
export const USERNAME_KEY = "skyshards-import-username";

export function rememberedUsername(): string {
  try {
    return localStorage.getItem(USERNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberUsername(name: string): void {
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch {
    // localStorage unavailable: the name is not remembered.
  }
}

export const isValidUsername = (name: string): boolean => USERNAME_RE.test(name.trim());

function statusMessage(status: number, username: string, detail: string | null): string {
  switch (status) {
    case 404:
      return detail && /profile/i.test(detail) ? `${username} has no SkyBlock profiles.` : `Player "${username}" not found.`;
    case 429:
      return "Too many imports right now. Wait a minute and try again.";
    case 502:
      return "Hypixel did not answer. Try again in a moment.";
    case 503:
      return "Importing is unavailable right now.";
    default:
      return detail || `Import failed (HTTP ${status}).`;
  }
}

/**
 * Fetch the Greenhouse stats of a player. `profileId` picks a profile; omitted = the one Hypixel
 * marks selected. Throws `PlayerImportError` with a readable message (status 0 = network).
 */
export async function fetchGreenhouseStats(username: string, profileId?: string, opts: { signal?: AbortSignal } = {}): Promise<GreenhouseStatsResponse> {
  const name = username.trim();
  if (!USERNAME_RE.test(name)) throw new PlayerImportError(400, "Enter a Minecraft username (letters, digits and _, up to 25).");
  const query = profileId ? `?${new URLSearchParams({ profile: profileId })}` : "";
  const url = `${REMOTE_API_BASE}/skyshards/greenhouse-stats/${encodeURIComponent(name)}${query}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new PlayerImportError(0, "Could not reach the SkyShards server. Check your connection.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new PlayerImportError(response.status, statusMessage(response.status, name, detail));
  }
  const data = (await response.json().catch(() => null)) as Partial<GreenhouseStatsResponse> | null;
  if (!data || typeof data !== "object") throw new PlayerImportError(502, "The server sent an unreadable answer.");
  return normalizeResponse(data, name);
}

/** Defensive shape fixes: the page must survive a partial answer. */
export function normalizeResponse(data: Partial<GreenhouseStatsResponse>, fallbackName = ""): GreenhouseStatsResponse {
  const profiles = Array.isArray(data.profiles)
    ? data.profiles
        .filter((p): p is ImportProfile => !!p && typeof p === "object" && typeof (p as ImportProfile).profileId === "string")
        .map((p) => ({ profileId: p.profileId, cuteName: typeof p.cuteName === "string" && p.cuteName ? p.cuteName : p.profileId.slice(0, 8), gameMode: typeof p.gameMode === "string" ? p.gameMode : null, selected: p.selected === true }))
    : [];
  return {
    username: typeof data.username === "string" && data.username ? data.username : fallbackName,
    uuid: typeof data.uuid === "string" ? data.uuid : "",
    profileId: typeof data.profileId === "string" ? data.profileId : "",
    profiles,
    stats: data.stats && typeof data.stats === "object" && !Array.isArray(data.stats) ? (data.stats as Record<string, unknown>) : {},
    breakdown: data.breakdown && typeof data.breakdown === "object" ? data.breakdown : undefined,
    missing: Array.isArray(data.missing) ? data.missing.filter((m): m is string => typeof m === "string") : [],
    items: data.items === null ? null : data.items && typeof data.items === "object" ? cleanCounts(data.items) : undefined,
    itemSources:
      data.itemSources && typeof data.itemSources === "object" && !Array.isArray(data.itemSources)
        ? Object.fromEntries(Object.entries(data.itemSources).map(([k, v]) => [k, cleanCounts(v)]))
        : {},
    manual: cleanManual(data.manual),
  };
}

// ---- Field registry ------------------------------------------------------------------------------

export interface ImportField {
  /** The `stats` key of the response (= the PlayerStats field name). */
  key: string;
  label: string;
  /** The patch for a raw value, or null when it is missing/invalid. */
  apply: (raw: unknown) => Partial<PlayerStats> | null;
  /** Short readable value for the "what was imported" list. */
  format: (patch: Partial<PlayerStats>, ctx?: FormatContext) => string;
}

/** What `format` may use besides the value: the manual sources' current settings (id → value). */
export interface FormatContext {
  manual: Record<string, ManualValue>;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 2) => Number(v.toFixed(digits));
const pct = (v: number) => `${round(v * 100, 1)}%`;
const isFortuneCrop = (s: string): s is FortuneCrop => (FORTUNE_CROPS as readonly string[]).includes(s);

/** Crop-specific fortune: FORTUNE_CROPS keys only, finite ≥ 0 (zeros are dropped). Null when nothing is left. */
export function cleanCropFortune(raw: unknown): CropFortune | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: CropFortune = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isFortuneCrop(k) && finite(v) && v > 0) out[k] = round(v);
  }
  return Object.keys(out).length ? out : null;
}

/** Farming tools: a name and a cleaned per-crop fortune. Tools without a name are dropped. */
export function cleanTools(raw: unknown): FarmingToolStats[] | null {
  if (!Array.isArray(raw)) return null;
  const out: FarmingToolStats[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const { name, fortune } = t as { name?: unknown; fortune?: unknown };
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({ name: name.trim().slice(0, 80), fortune: cleanCropFortune(fortune) ?? {} });
  }
  return out.length ? out : null;
}

// ---- Manual sources: cleaning, math, persistence -------------------------------------------------

const isManualValue = (v: unknown): v is ManualValue => (typeof v === "string" && v.length <= 80) || finite(v);

/** A manual `add` with finite numbers only (≥ 0; the multiplier > 0). */
function cleanAdd(raw: unknown): ManualAdd | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: ManualAdd = {};
  for (const k of ["farmingFortune", "overbloom", "evergreenChip"] as const) {
    if (finite(r[k]) && r[k] >= 0) out[k] = r[k];
  }
  if (finite(r.hyperchargeMultiplier) && r.hyperchargeMultiplier > 0) out.hyperchargeMultiplier = r.hyperchargeMultiplier;
  if (r.cropFortune && typeof r.cropFortune === "object" && !Array.isArray(r.cropFortune)) {
    const cf: CropFortune = {};
    for (const [c, v] of Object.entries(r.cropFortune as Record<string, unknown>)) if (isFortuneCrop(c) && finite(v) && v >= 0) cf[c] = v;
    if (Object.keys(cf).length) out.cropFortune = cf;
  }
  return out;
}

function cleanManualSource(raw: unknown): ManualSource | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id || typeof r.label !== "string" || !r.label) return null;
  if (!(MANUAL_GROUPS as readonly unknown[]).includes(r.group)) return null;
  const base = {
    id: r.id,
    label: r.label,
    group: r.group as ManualGroup,
    ...(typeof r.hint === "string" && r.hint ? { hint: r.hint } : {}),
    ...(typeof r.condition === "string" && r.condition ? { condition: r.condition } : {}),
    ...(r.hypercharged === true ? { hypercharged: true } : {}),
  };
  if (r.input === "select") {
    if (!Array.isArray(r.options)) return null;
    const options: ManualOption[] = [];
    for (const o of r.options) {
      if (!o || typeof o !== "object") continue;
      const { value, label, add } = o as Record<string, unknown>;
      const a = cleanAdd(add);
      if (!isManualValue(value) || typeof label !== "string" || !a || options.some((x) => x.value === value)) continue;
      options.push({ value, label, add: a });
    }
    if (!options.length || !options.some((o) => o.value === r.default)) return null;
    return { ...base, input: "select", options, default: r.default as ManualValue };
  }
  if (r.input === "number") {
    const n = r.number as Record<string, unknown> | undefined;
    if (!n || typeof n !== "object") return null;
    const rate = cleanAdd(n.rate);
    if (!finite(n.min) || !finite(n.max) || n.min > n.max || !rate || !finite(r.default)) return null;
    const spec: ManualNumberSpec = {
      min: n.min,
      max: n.max,
      step: finite(n.step) && n.step > 0 ? n.step : 1,
      rate,
      ...(typeof n.unit === "string" && n.unit ? { unit: n.unit } : {}),
      ...(n.floor === true ? { floor: true } : {}),
    };
    return { ...base, input: "number", number: spec, default: clamp(r.default, spec.min, spec.max) };
  }
  return null;
}

/** Well-formed manual sources only (unique ids); malformed entries are dropped. */
export function cleanManual(raw: unknown): ManualSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ManualSource[] = [];
  for (const s of raw) {
    const c = cleanManualSource(s);
    if (c && !out.some((x) => x.id === c.id)) out.push(c);
  }
  return out;
}

/** The value a source is set to under `choices`: a valid choice, else its default. */
export function manualValue(source: ManualSource, choices?: ManualChoices): ManualValue {
  const v = choices?.[source.id];
  if (v === undefined) return source.default;
  if (source.input === "select") return source.options!.some((o) => o.value === v) ? v : source.default;
  return finite(v) ? clamp(v, source.number!.min, source.number!.max) : source.default;
}

/** The absolute contribution of a source at a value (number input: rate × value, floored when set). */
export function manualAddAt(source: ManualSource, value: ManualValue): ManualAdd {
  if (source.input === "select") return source.options!.find((o) => o.value === value)?.add ?? {};
  const spec = source.number!;
  const v = finite(value) ? clamp(value, spec.min, spec.max) : 0;
  const f = (x: number) => (spec.floor ? Math.floor(x + 1e-9) : x);
  const out: ManualAdd = {};
  for (const k of ["farmingFortune", "overbloom", "evergreenChip", "hyperchargeMultiplier"] as const) {
    if (spec.rate[k] !== undefined) out[k] = f(spec.rate[k]! * v);
  }
  if (spec.rate.cropFortune) {
    out.cropFortune = {};
    for (const [c, r] of Object.entries(spec.rate.cropFortune)) out.cropFortune[c as FortuneCrop] = f(r * v);
  }
  return out;
}

interface ManualTotal {
  farmingFortune: number;
  overbloom: number;
  evergreenChip: number;
  cropFortune: Partial<Record<FortuneCrop, number>>;
}

/** Every source's add at its setting under `choices`, hypercharged FF scaled by the chosen multiplier. */
function manualTotal(sources: readonly ManualSource[], choices?: ManualChoices): ManualTotal {
  const adds = sources.map((s) => ({ s, add: manualAddAt(s, manualValue(s, choices)) }));
  let mult = 1;
  for (const { add } of adds) if (add.hyperchargeMultiplier !== undefined) mult *= add.hyperchargeMultiplier;
  const t: ManualTotal = { farmingFortune: 0, overbloom: 0, evergreenChip: 0, cropFortune: {} };
  for (const { s, add } of adds) {
    t.farmingFortune += (add.farmingFortune ?? 0) * (s.hypercharged ? mult : 1);
    t.overbloom += add.overbloom ?? 0;
    t.evergreenChip += add.evergreenChip ?? 0;
    for (const [c, v] of Object.entries(add.cropFortune ?? {})) t.cropFortune[c as FortuneCrop] = (t.cropFortune[c as FortuneCrop] ?? 0) + v;
  }
  return t;
}

/**
 * `stats` with the player's manual settings instead of the defaults it was computed with:
 * final = stats + total(choices) − total(defaults). Evergreen is clamped to 0..0.6, crops ≤ 0 are
 * dropped. A number missing from `stats` stays missing (no base to adjust); a missing cropFortune
 * starts at {}.
 */
export function applyManual(resp: Pick<GreenhouseStatsResponse, "stats" | "manual">, choices?: ManualChoices): Record<string, unknown> {
  const stats = resp.stats ?? {};
  const sources = resp.manual ?? [];
  if (!sources.length || !choices) return stats;
  const now = manualTotal(sources, choices);
  const def = manualTotal(sources);
  const out: Record<string, unknown> = { ...stats };
  const shift = (key: "farmingFortune" | "overbloom" | "evergreenChip", lo: number, hi: number) => {
    const d = now[key] - def[key];
    if (d !== 0 && finite(stats[key])) out[key] = clamp(round((stats[key] as number) + d, 6), lo, hi);
  };
  shift("farmingFortune", 0, Infinity);
  shift("overbloom", 0, Infinity);
  shift("evergreenChip", 0, 0.6);
  const crops = new Set([...Object.keys(now.cropFortune), ...Object.keys(def.cropFortune)]) as Set<FortuneCrop>;
  const changed = [...crops].some((c) => (now.cropFortune[c] ?? 0) !== (def.cropFortune[c] ?? 0));
  if (changed) {
    const base = stats.cropFortune && typeof stats.cropFortune === "object" && !Array.isArray(stats.cropFortune) ? (stats.cropFortune as Record<string, unknown>) : {};
    const cf: Record<string, number> = {};
    for (const [c, v] of Object.entries(base)) if (finite(v)) cf[c] = v;
    for (const c of crops) cf[c] = round((cf[c] ?? 0) + (now.cropFortune[c] ?? 0) - (def.cropFortune[c] ?? 0), 6);
    for (const c of Object.keys(cf)) if (!(cf[c] > 0)) delete cf[c];
    out.cropFortune = cf;
  }
  return out;
}

/** "+62 FF", "+15 Overbloom", "+25 crop", "+37.5% Evergreen", "×1.6"; "0" when it adds nothing. */
export function describeAdd(add: ManualAdd): string {
  const parts: string[] = [];
  const n = (v: number) => String(round(v, 1));
  if (add.farmingFortune) parts.push(`+${n(add.farmingFortune)} FF`);
  const crops = Object.values(add.cropFortune ?? {}).filter((v) => v > 0);
  if (crops.length) parts.push(`+${n(Math.max(...crops))} crop FF`);
  if (add.overbloom) parts.push(`+${n(add.overbloom)} Overbloom`);
  if (add.evergreenChip) parts.push(`+${round(add.evergreenChip * 100, 1)}% Evergreen`);
  if (add.hyperchargeMultiplier !== undefined && add.hyperchargeMultiplier !== 1) parts.push(`×${round(add.hyperchargeMultiplier, 3)}`);
  return parts.length ? parts.join(", ") : "0";
}

/** Remembered manual settings, keyed by source id (across profiles and pages). */
export const MANUAL_KEY = "skyshards-import-manual";

export function loadManualChoices(): ManualChoices {
  try {
    const raw = JSON.parse(localStorage.getItem(MANUAL_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: ManualChoices = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isManualValue(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveManualChoices(choices: ManualChoices): void {
  try {
    const clean: ManualChoices = {};
    for (const [k, v] of Object.entries(choices)) if (isManualValue(v)) clean[k] = v;
    localStorage.setItem(MANUAL_KEY, JSON.stringify(clean));
  } catch {
    // localStorage unavailable: the settings are not remembered.
  }
}

/** The stored choices that are valid for these sources (stale ids and invalid values left out). */
export function validChoices(sources: readonly ManualSource[], stored: ManualChoices): ManualChoices {
  const out: ManualChoices = {};
  for (const s of sources) {
    const v = stored[s.id];
    if (v !== undefined && manualValue(s, { [s.id]: v }) === v) out[s.id] = v;
  }
  return out;
}

// ---- Registry helpers ----------------------------------------------------------------------------

/** A number clamped to [lo, hi] (rounded to an integer when `int`). */
function numberField(key: keyof PlayerStats, label: string, lo: number, hi: number, opts: { int?: boolean; format?: (v: number) => string } = {}): ImportField {
  return {
    key,
    label,
    apply: (raw) => {
      if (!finite(raw)) return null;
      const v = clamp(opts.int ? Math.round(raw) : round(raw, 4), lo, hi);
      return { [key]: v } as Partial<PlayerStats>;
    },
    format: (p) => {
      const v = p[key] as number;
      return opts.format ? opts.format(v) : String(round(v, 2));
    },
  };
}

const cropLabel = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

/** The option's label when the value is (about) exactly an option, else the fallback. */
const optionLabel = (options: StatOption[], fallback: (v: number) => string) => (v: number) => {
  const o = nearestOption(options, v);
  return Math.abs(o.value - v) < 1e-6 ? o.label : fallback(v);
};

/**
 * "Epic 15 · +37.5%", "None", or the bare percentage for a value no rarity/level hits. A value two
 * rarities can hit (0.2 = Rare 10 = Epic 8) uses the rarity set in the Evergreen manual source.
 */
function evergreenLabel(v: number, ctx?: FormatContext): string {
  const set = ctx?.manual.evergreenRarity;
  const rarity = typeof set === "string" ? CHIP_RARITIES.find((r) => r === set.toLowerCase()) : undefined;
  if (rarity && v > 0) {
    const level = v / EVERGREEN_CHIP.perLevel[rarity];
    const rounded = Math.round(level);
    if (Math.abs(level - rounded) < 1e-6 && rounded >= 1 && rounded <= EVERGREEN_CHIP.maxLevel[rarity]) return `${CHIP_RARITY_LABEL[rarity]} ${rounded} · ${EVERGREEN_CHIP.format(v)}`;
  }
  const chip = chipFromValue(EVERGREEN_CHIP, v);
  if (!chip) return EVERGREEN_CHIP.format(v);
  if (chip.level === 0) return "None";
  return `${CHIP_RARITY_LABEL[chip.rarity]} ${chip.level} · ${EVERGREEN_CHIP.format(v)}`;
}

const label = (key: keyof typeof STAT_FIELDS) => STAT_FIELDS[key].label;

export const IMPORT_FIELDS: readonly ImportField[] = [
  numberField("farmingFortune", label("farmingFortune"), 0, 10000, { format: (v) => String(round(v, 1)) }),
  {
    key: "cropFortune",
    label: "Crop Fortune",
    // An object with nothing above 0 imports as {} (clears old crop fortune); a non-object is dropped.
    apply: (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? { cropFortune: cleanCropFortune(raw) ?? {} } : null),
    format: (p) => {
      const cf = p.cropFortune ?? {};
      const keys = Object.keys(cf) as FortuneCrop[];
      if (!keys.length) return "None";
      if (keys.length <= 2) return keys.map((k) => `${cropLabel(k)} ${cf[k]}`).join(", ");
      return `${keys.length} crops`;
    },
  },
  {
    key: "tools",
    label: "Tools",
    apply: (raw) => {
      const tools = cleanTools(raw);
      return tools ? { tools } : null;
    },
    format: (p) => {
      const tools = p.tools ?? [];
      return tools.length === 1 ? tools[0].name : `${tools.length} tools`;
    },
  },
  numberField("floraShard", label("floraShard"), 0, 10, { int: true, format: optionLabel(FLORA_OPTIONS, String) }),
  numberField("speedAttribute", label("speedAttribute"), 0, 10, { format: optionLabel(SPEED_ATTRIBUTE_OPTIONS, (v) => `Level ${round(v, 2)}`) }),
  numberField("cropGrowth", label("cropGrowth"), 0, 210),
  numberField("growthUpgradeTier", label("growthUpgradeTier"), 0, 9, { int: true, format: optionLabel(GROWTH_UPGRADE_OPTIONS, (v) => `Tier ${v}`) }),
  numberField("plantYieldUpgrade", label("plantYieldUpgrade"), 0, 0.2, { format: optionLabel(PLANT_YIELD_OPTIONS, (v) => `+${pct(v)}`) }),
  { ...numberField("evergreenChip", label("evergreenChip"), 0, 0.6), format: (p, ctx) => evergreenLabel(p.evergreenChip ?? 0, ctx) },
  {
    key: "mutationChanceBonus",
    label: label("mutationChanceBonus"),
    apply: (raw) => {
      if (!finite(raw)) return null;
      const o = BIOANALYSIS_OPTIONS.find((b) => Math.abs(b.value - raw) < 1e-6);
      return o === undefined ? null : { mutationChanceBonus: o.value };
    },
    format: (p) => optionLabel(BIOANALYSIS_OPTIONS, String)(p.mutationChanceBonus ?? 0),
  },
  numberField("overbloom", label("overbloom"), 0, 100000, { format: (v) => String(round(v, 1)) }),
  {
    key: "armorSet",
    label: "Armor",
    apply: (raw) => (typeof raw === "string" && (ARMOR_SETS as readonly string[]).includes(raw) ? { armorSet: raw as ArmorSet } : null),
    format: (p) => ARMOR_SET_LABEL[p.armorSet ?? "none"],
  },
];

/** One registry row with the value it would import. */
export interface ImportedField {
  field: ImportField;
  patch: Partial<PlayerStats>;
  display: string;
}

type StatsSource = Pick<GreenhouseStatsResponse, "stats"> & Partial<Pick<GreenhouseStatsResponse, "manual">>;

/**
 * The registry rows the response has a valid value for, in registry order, with the manual sources
 * at `choices` (default: as the server computed them, every source at max).
 */
export function importedFields(resp: StatsSource, choices?: ManualChoices): ImportedField[] {
  const out: ImportedField[] = [];
  const stats = applyManual(resp, choices);
  const ctx: FormatContext = { manual: Object.fromEntries((resp.manual ?? []).map((s) => [s.id, manualValue(s, choices)])) };
  for (const field of IMPORT_FIELDS) {
    if (!(field.key in stats)) continue;
    const patch = field.apply(stats[field.key]);
    if (patch) out.push({ field, patch, display: field.format(patch, ctx) });
  }
  return out;
}

/**
 * The PlayerStats patch for a response; `selectedKeys` limits it to those registry keys (default
 * all), `choices` sets the manual sources (default: max).
 */
export function statsPatchFromImport(resp: StatsSource, selectedKeys?: Iterable<string>, choices?: ManualChoices): Partial<PlayerStats> {
  const only = selectedKeys ? new Set(selectedKeys) : null;
  const patch: Partial<PlayerStats> = {};
  for (const { field, patch: p } of importedFields(resp, choices)) {
    if (!only || only.has(field.key)) Object.assign(patch, p);
  }
  return patch;
}
