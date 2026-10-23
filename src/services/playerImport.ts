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
  format: (patch: Partial<PlayerStats>) => string;
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

const BIOANALYSIS: Record<number, string> = { 0: "None", 0.05: "Talisman", 0.1: "Ring", 0.15: "Artifact" };

const cropLabel = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

export const IMPORT_FIELDS: readonly ImportField[] = [
  numberField("farmingFortune", "Farming Fortune", 0, 10000, { format: (v) => String(round(v, 1)) }),
  {
    key: "cropFortune",
    label: "Crop Fortune",
    apply: (raw) => {
      const cf = cleanCropFortune(raw);
      return cf ? { cropFortune: cf } : null;
    },
    format: (p) => {
      const cf = p.cropFortune ?? {};
      const keys = Object.keys(cf) as FortuneCrop[];
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
  numberField("floraShard", "Flora shard", 0, 10, { int: true }),
  numberField("speedAttribute", "Speed attribute", 0, 10),
  numberField("cropGrowth", "Crop Growth", 0, 210),
  numberField("growthUpgradeTier", "Growth upgrade", 0, 9, { int: true, format: (v) => `Tier ${v}` }),
  numberField("plantYieldUpgrade", "Plant Yield", 0, 0.2, { format: pct }),
  numberField("evergreenChip", "Evergreen Chip", 0, 0.6, { format: pct }),
  {
    key: "mutationChanceBonus",
    label: "Bioanalysis",
    apply: (raw) => {
      if (!finite(raw)) return null;
      const v = [0, 0.05, 0.1, 0.15].find((b) => Math.abs(b - raw) < 1e-6);
      return v === undefined ? null : { mutationChanceBonus: v };
    },
    format: (p) => BIOANALYSIS[p.mutationChanceBonus ?? 0] ?? String(p.mutationChanceBonus),
  },
  numberField("overbloom", "Overbloom", 0, 100000),
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

/** The registry rows the response has a valid value for, in registry order. */
export function importedFields(resp: Pick<GreenhouseStatsResponse, "stats">): ImportedField[] {
  const out: ImportedField[] = [];
  const stats = resp.stats ?? {};
  for (const field of IMPORT_FIELDS) {
    if (!(field.key in stats)) continue;
    const patch = field.apply(stats[field.key]);
    if (patch) out.push({ field, patch, display: field.format(patch) });
  }
  return out;
}

/** The PlayerStats patch for a response; `selectedKeys` limits it to those registry keys (default all). */
export function statsPatchFromImport(resp: Pick<GreenhouseStatsResponse, "stats">, selectedKeys?: Iterable<string>): Partial<PlayerStats> {
  const only = selectedKeys ? new Set(selectedKeys) : null;
  const patch: Partial<PlayerStats> = {};
  for (const { field, patch: p } of importedFields(resp)) {
    if (!only || only.has(field.key)) Object.assign(patch, p);
  }
  return patch;
}
