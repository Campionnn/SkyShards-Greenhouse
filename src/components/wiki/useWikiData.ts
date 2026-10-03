import { useEffect, useMemo, useState } from "react";
import { getRawData, loadGreenhouseData } from "../../services/greenhouseDataService";
import type { GreenhouseDataJSON } from "../../services/greenhouseDataService";
import { buildWikiIndex } from "../../wiki/slugs";
import type { WikiIndex } from "../../wiki/slugs";
import { buildUsedInMap } from "../../wiki/recipes";

export interface WikiData {
  data: GreenhouseDataJSON;
  index: WikiIndex;
  usedIn: Map<string, string[]>;
}

/** Derived lookups for an already-loaded data file. */
export function useWikiLookups(data: GreenhouseDataJSON | null): WikiData | null {
  return useMemo(
    () => (data ? { data, index: buildWikiIndex(data), usedIn: buildUsedInMap(data) } : null),
    [data],
  );
}

/** Loads data.json (cached after the first call) and the wiki lookups built from it. */
export function useWikiData(): { wiki: WikiData | null; error: string | null } {
  const [data, setData] = useState<GreenhouseDataJSON | null>(() => getRawData());
  const [error, setError] = useState<string | null>(null);

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
  }, [data]);

  return { wiki: useWikiLookups(data), error };
}
