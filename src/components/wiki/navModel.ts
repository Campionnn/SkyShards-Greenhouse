// Wiki navigation helpers (research/wiki-v2, the approved mockup's MockLib "Groups, search, suggestions"):
// the index groups, the grouped search, "did you mean" for an unknown slug, and the phone media hook. Item
// lookups (nameOf, groupKeyOf, recipeOf, …) are shared with the article: articleModel.ts. Pure except the
// hook; never touches src/wiki/* (the SEO contract).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getRawData, loadGreenhouseData, type GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { normalizeKey, RARITY_ORDER, type WikiEntry } from "../../wiki/slugs";
import { groupKeyOf, groupTitleOf } from "./articleModel";
import { useWikiLookups, type WikiData } from "./useWikiData";

/**
 * The page's data: data.json (synchronous once cached, so no spinner after the first load, W12) and the
 * wiki lookups, plus `retry` for the error state (a failed load leaves no cached promise, so it fetches again).
 */
export function useWikiPageData(): { wiki: WikiData | null; error: string | null; retry: () => void } {
  const [data, setData] = useState<GreenhouseDataJSON | null>(() => getRawData());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (data) return;
    let cancelled = false;
    loadGreenhouseData()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data");
      });
    return () => {
      cancelled = true;
    };
  }, [data, attempt]);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((a) => a + 1);
  }, []);
  return { wiki: useWikiLookups(data), error, retry };
}

export interface Group {
  /** Also the index anchor: /wiki#rare. */
  key: string;
  title: string;
  entries: WikiEntry[];
}

/** The element id of a group's section on the index (the URL hash stays the bare key: /wiki#rare). */
export const groupAnchorId = (key: string) => `wiki-group-${key}`;

/** Base crops, then the mutations by rarity (the index's order), then "Other" (an unknown rarity; empty today). */
export function groupsOf(entries: WikiEntry[]): Group[] {
  const keys: string[] = ["base-crops", ...RARITY_ORDER];
  const groups = keys.map((key) => ({ key, title: groupTitleOf(key), entries: entries.filter((e) => groupKeyOf(e) === key) }));
  // Any rarity the data adds later (or none) lands in "Other", so nothing ever drops out of the lists.
  groups.push({ key: "other", title: "Other", entries: entries.filter((e) => !keys.includes(groupKeyOf(e))) });
  return groups.filter((g) => g.entries.length);
}

/** Names containing the query (case, spaces and dashes ignored), grouped like the index; names starting with it first. */
export function searchGrouped(entries: WikiEntry[], query: string, limit = 12): Group[] {
  const q = normalizeKey(query);
  if (!q) return [];
  const starts = (e: WikiEntry) => normalizeKey(e.name).startsWith(q);
  const hits = entries.filter((e) => normalizeKey(e.name).includes(q));
  const ranked = [...hits.filter(starts), ...hits.filter((e) => !starts(e))].slice(0, limit);
  return groupsOf(entries)
    .map((g) => ({ ...g, entries: ranked.filter((e) => g.entries.includes(e)).sort((a, b) => Number(!starts(a)) - Number(!starts(b))) }))
    .filter((g) => g.entries.length);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * "Did you mean" for a slug that didn't resolve: close names only, so "chloronit" offers Chloronite and
 * "xyz" offers nothing (not four random items). Close = a typo (edit distance ≤ a quarter of the length, at
 * least 1, at most 3), or the text is part of the name ("aloe" → All-in Aloe, 3+ letters), or the name is
 * part of the text ("wheatseeds" → Wheat). Best first.
 */
export function suggestionsFor(entries: WikiEntry[], raw: string, n = 4): WikiEntry[] {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed escapes: match on the raw text.
  }
  const q = normalizeKey(decoded);
  if (q.length < 2) return [];
  const scored: { e: WikiEntry; s: number }[] = [];
  for (const e of entries) {
    const k = normalizeKey(e.name);
    const d = editDistance(q, k);
    const typo = d <= Math.min(3, Math.max(1, Math.floor(Math.max(q.length, k.length) / 4)));
    const part = (q.length >= 3 && k.includes(q)) || (k.length >= 4 && q.includes(k));
    if (typo || part) scored.push({ e, s: typo ? d : 2 + Math.abs(k.length - q.length) / 10 });
  }
  return scored
    .sort((a, b) => a.s - b.s || a.e.name.localeCompare(b.e.name))
    .slice(0, n)
    .map((x) => x.e);
}

/** The phone layout (under the md breakpoint): the find bar becomes sticky and full width. False on the server. */
export function usePhone(query = "(max-width: 767px)"): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  );
}
