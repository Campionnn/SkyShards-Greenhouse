// Wiki URLs: every crop and mutation has one canonical address, /wiki/<slug>,
// where the slug is the data id with "_" turned into "-" (all_in_aloe -> all-in-aloe).
// Lookups are lenient: case, spaces, "_" and "-" are ignored, and the display
// name works as well as the id, so /All-in_Aloe, /all_in_aloe and /wiki/allinaloe
// all resolve to the same item.
//
// Pure (no DOM, no React): vite.config.ts imports it to generate static pages.

import type { GreenhouseDataJSON } from "../services/greenhouseDataService";

export const SITE_URL = "https://greenhouse.skyshards.com";
export const WIKI_BASE_PATH = "/wiki";

export type WikiItemType = "crop" | "mutation";

export interface WikiEntry {
  id: string;
  slug: string;
  name: string;
  type: WikiItemType;
  /** Mutation rarity; null for base crops. */
  rarity: string | null;
}

export interface WikiIndex {
  entries: WikiEntry[];
  byId: Map<string, WikiEntry>;
  /** normalizeKey(id) and normalizeKey(name) -> entry. */
  byKey: Map<string, WikiEntry>;
}

export const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;

/** Top-level paths a crop slug must never shadow: app routes and files in dist/. */
export const RESERVED_TOP_LEVEL_PATHS = new Set([
  "wiki",
  "designer",
  "simulator",
  "calculator",
  "about",
  "contact",
  "privacy-policy",
  "assets",
  "favicon",
  "fonts",
  "greenhouse",
  "screenshots",
  "index",
  "404",
  "ads",
  "robots",
  "sitemap",
  "cname",
]);

/** Lowercase with everything but letters and digits removed. */
export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function toSlug(id: string): string {
  return id.toLowerCase().replace(/_/g, "-");
}

export function wikiPath(id: string): string {
  return `${WIKI_BASE_PATH}/${toSlug(id)}`;
}

export function wikiUrl(id: string, origin: string = SITE_URL): string {
  return `${origin}${wikiPath(id)}`;
}

/** Sort key: base crops first, then mutations by rarity, then by name. */
export function compareEntries(a: WikiEntry, b: WikiEntry): number {
  return rarityRank(a.rarity) - rarityRank(b.rarity) || a.name.localeCompare(b.name);
}

export function rarityRank(rarity: string | null): number {
  if (rarity === null) return -1;
  const index = (RARITY_ORDER as readonly string[]).indexOf(rarity.toLowerCase());
  return index === -1 ? RARITY_ORDER.length : index;
}

export function buildWikiIndex(data: GreenhouseDataJSON): WikiIndex {
  const entries: WikiEntry[] = [];
  for (const [id, crop] of Object.entries(data.crops)) {
    entries.push({ id, slug: toSlug(id), name: crop.name, type: "crop", rarity: null });
  }
  for (const [id, mutation] of Object.entries(data.mutations)) {
    entries.push({ id, slug: toSlug(id), name: mutation.name, type: "mutation", rarity: mutation.rarity });
  }
  entries.sort(compareEntries);

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const byKey = new Map<string, WikiEntry>();
  // Ids first so an id always wins over another item's display name.
  for (const entry of entries) byKey.set(normalizeKey(entry.id), entry);
  for (const entry of entries) {
    const key = normalizeKey(entry.name);
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return { entries, byId, byKey };
}

/** Resolves a raw URL segment (possibly percent-encoded) to an item, or null. */
export function resolveSlug(index: WikiIndex, raw: string): WikiEntry | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed escapes: match on the raw text.
  }
  const key = normalizeKey(decoded);
  if (!key) return null;
  return index.byKey.get(key) ?? null;
}

// Items whose Hypixel wiki title differs from the display name; null = no useful article.
// Checked against the wiki API: every other crop and mutation name is an exact page title.
const HYPIXEL_WIKI_TITLE_OVERRIDES: Record<string, string | null> = {
  red_mushroom: "Mushroom",
  brown_mushroom: "Mushroom",
  fire: null, // "Fire" redirects to a generic vanilla blocks page
};

/** Article on the Hypixel SkyBlock wiki (e.g. .../w/All-in_Aloe), or null when there is none. */
export function hypixelWikiUrl(id: string, name: string): string | null {
  const title = id in HYPIXEL_WIKI_TITLE_OVERRIDES ? HYPIXEL_WIKI_TITLE_OVERRIDES[id] : name;
  if (!title) return null;
  return `https://hypixelskyblock.minecraft.wiki/w/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}
