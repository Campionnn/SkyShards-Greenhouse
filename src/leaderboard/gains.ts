import type { ItemId } from "../simulator/data/types";

/**
 * A result's `gains` map (docs/plans/sowdust-xp-collection.md): what harvests earned besides
 * items, as counts (snapshots) or per day (results). `farming_xp` = Farming XP; `sowdust:<item>` =
 * Sowdust made by that crop item's drops. Bundled into the verifier (result.ts reads the keys).
 */

export const GAIN_XP = "farming_xp";
export const SOWDUST_PREFIX = "sowdust:";

type Gains = Readonly<Record<string, number>> | null | undefined;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Sowdust per day (or in total), every crop item summed; 0 without gains. */
export function sowdustPerDay(gains: Gains): number {
  let n = 0;
  for (const [k, v] of Object.entries(gains ?? {})) if (k.startsWith(SOWDUST_PREFIX) && finite(v) && v > 0) n += v;
  return n;
}

/** Farming XP per day (or in total); 0 without gains. */
export function xpPerDay(gains: Gains): number {
  const v = gains?.[GAIN_XP];
  return finite(v) && v > 0 ? v : 0;
}

/** Sowdust by the crop item that made it (positive only). */
export function sowdustByCrop(gains: Gains): Record<ItemId, number> {
  const out: Record<ItemId, number> = {};
  for (const [k, v] of Object.entries(gains ?? {})) if (k.startsWith(SOWDUST_PREFIX) && finite(v) && v > 0) out[k.slice(SOWDUST_PREFIX.length)] = v;
  return out;
}
