// Fetches Hypixel Bazaar prices (no API key needed; the endpoint allows any origin and is cached
// by Hypixel for ~60 s). Only greenhouse items are kept (see simulator/economy/bazaar.ts).

import { parseBazaar, type BazaarSnapshot } from "../simulator/economy/bazaar";

export const BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";

/** Fetch and parse the Bazaar. Throws on a network error, a bad status or an unexpected body. */
export async function fetchBazaar(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<BazaarSnapshot> {
  const res = await fetchImpl(BAZAAR_URL, { signal });
  if (!res.ok) throw new Error(`The Bazaar API answered ${res.status}`);
  return parseBazaar(await res.json());
}
