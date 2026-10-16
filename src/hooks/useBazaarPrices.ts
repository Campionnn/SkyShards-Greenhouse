import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withOverrides, type BazaarOverride, type BazaarPricing, type BazaarQuote } from "../simulator";
import { fetchBazaar } from "../services/bazaarService";
import { BAZAAR_PRICES_VERSION, LocalStorageManager, type StoredBazaarPrices } from "../utilities/localStorageManager";

export interface BazaarPricesView {
  /** The last successful fetch (possibly from an earlier visit), or null before any. */
  prices: StoredBazaarPrices | null;
  /** What everything is priced with: the live quotes with the user's overrides on top. */
  quotes: Record<string, BazaarQuote> | null;
  loading: boolean;
  /** The last fetch failed (older prices, if any, stay in use). */
  error: string | null;
  refresh: () => void;
  pricing: BazaarPricing;
  setPricing: (pricing: BazaarPricing) => void;
  /** Manual prices per item, kept until cleared (they survive refreshes). */
  overrides: Record<string, BazaarOverride>;
  setOverrides: (overrides: Record<string, BazaarOverride>) => void;
}

/**
 * Bazaar prices for normal profiles. Fetched when `enabled` turns on (once per mount), and on
 * `refresh`; cached in localStorage so a failed fetch falls back to the last prices. Manual
 * overrides sit on top of the live book. Prices never restart a simulation: the page re-prices
 * the run's counts.
 */
export function useBazaarPrices(enabled: boolean): BazaarPricesView {
  const [prices, setPrices] = useState<StoredBazaarPrices | null>(() => LocalStorageManager.loadBazaarPrices());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricing, setPricingState] = useState<BazaarPricing>(() => LocalStorageManager.loadBazaarPricing());
  const [overrides, setOverridesState] = useState<Record<string, BazaarOverride>>(() => LocalStorageManager.loadBazaarOverrides());
  const abortRef = useRef<AbortController | null>(null);
  const fetchedRef = useRef(false);

  const refresh = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    fetchBazaar(ctrl.signal)
      .then((snap) => {
        if (ctrl.signal.aborted) return;
        const stored: StoredBazaarPrices = { version: BAZAAR_PRICES_VERSION, fetchedAt: Date.now(), lastUpdated: snap.lastUpdated, quotes: snap.quotes };
        LocalStorageManager.saveBazaarPrices(stored);
        setPrices(stored);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
  }, []);

  // Fetch once when enabled. The cleanup aborts an in-flight fetch and allows a retry, so a
  // remount (React StrictMode mounts effects twice in development) fetches again instead of
  // leaving the page stuck on "Fetching prices".
  useEffect(() => {
    if (!enabled || fetchedRef.current) return;
    fetchedRef.current = true;
    refresh();
    return () => {
      if (abortRef.current && !abortRef.current.signal.aborted) {
        abortRef.current.abort();
        fetchedRef.current = false;
        setLoading(false);
      }
    };
  }, [enabled, refresh]);

  const setPricing = useCallback((next: BazaarPricing) => {
    LocalStorageManager.saveBazaarPricing(next);
    setPricingState(next);
  }, []);

  const setOverrides = useCallback((next: Record<string, BazaarOverride>) => {
    LocalStorageManager.saveBazaarOverrides(next);
    setOverridesState(next);
  }, []);

  const quotes = useMemo(() => withOverrides(prices?.quotes ?? null, overrides), [prices, overrides]);

  return { prices, quotes, loading, error, refresh, pricing, setPricing, overrides, setOverrides };
}
