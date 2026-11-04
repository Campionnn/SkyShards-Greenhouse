import { useEffect, useState } from "react";
import type { FlowDetail, FlowSeedResult } from "../../../leaderboard/api";
import { cellKindOfRow } from "../../../leaderboard/view";
import { getAdminKey } from "../../../services/adminService";
import { getFlowSeeds, type SeedsQuery } from "../../../services/flowsService";

/**
 * The per-seed rows of one cell (null while loading, [] when there are none or the fetch failed).
 * Read from `detail.seeds` when the detail came with them (older APIs, SSR tests), else fetched
 * once per cell from `/flows/{id}/seeds` (the page loads the detail without them, ~2 MB lighter).
 * `query` null = no cell shown, nothing to load.
 */
export function useCellSeeds(detail: FlowDetail, query: SeedsQuery | null): FlowSeedResult[] | null {
  const inline = detail.seeds;
  const key = query ? `${detail.id}|${query.cellKind}|${query.tier}|${query.every}` : null;
  const [fetched, setFetched] = useState<{ key: string; rows: FlowSeedResult[] } | null>(null);
  useEffect(() => {
    if (!query || !key || inline) return;
    let live = true;
    getFlowSeeds(detail.id, query, { adminKey: getAdminKey() })
      .then((rows) => live && setFetched({ key, rows }))
      .catch(() => live && setFetched({ key, rows: [] }));
    return () => {
      live = false;
    };
    // `query` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id, key, inline]);
  if (!query) return [];
  if (inline) return inline.filter((s) => cellKindOfRow(s) === query.cellKind && s.tier === query.tier && s.every === query.every);
  return fetched?.key === key ? fetched.rows : null;
}
