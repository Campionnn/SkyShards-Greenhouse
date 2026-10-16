import {
  defaultGameData,
  defaultNpcPrice,
  unitPrices,
  valueRun,
  type BazaarPricing,
  type BazaarQuote,
  type MarketValuation,
  type RunSummary,
  type SimulationState,
  type UnitPrices,
} from "../../simulator";
import { formatDuration, itemCategory, type ItemCategory } from "./format";

// Pure helpers for the inventory table (both profiles) and the normal-profile (Bazaar) panels.

const data = defaultGameData();

export type Quotes = Record<string, BazaarQuote>;

/** Value a summary at Bazaar prices, or null in ironman / before prices exist. */
export function priceRun(summary: RunSummary | null | undefined, quotes: Quotes | null, pricing: BazaarPricing): MarketValuation | null {
  if (!summary || !quotes) return null;
  return valueRun(data, summary, quotes, pricing);
}

/** Profit and profit per simulated day at Bazaar prices (the run bar), or null without prices. */
export function bazaarProfit(summary: RunSummary, quotes: Quotes | null, pricing: BazaarPricing): { profit: number; perDay: number } | null {
  const v = priceRun(summary, quotes, pricing);
  if (!v) return null;
  return { profit: v.profit, perDay: summary.elapsedSeconds > 0 ? v.profit / (summary.elapsedSeconds / 86400) : 0 };
}

/** What one unit of an item sells for under this pricing (Bazaar, or NPC when better). */
export function sellPriceOf(quotes: Quotes, pricing: BazaarPricing): (id: string) => number {
  return (id) => unitPrices(data, id, quotes, pricing).sell;
}

/** One item in the normal-profile Items table: every number about it in one place. */
export interface ItemRow {
  id: string;
  category: ItemCategory;
  /** In the inventory now (the starting inventory before the run starts). */
  held: number;
  /** Produced by the run (harvests, cleared Dead Plants, combined aloes). */
  made: number;
  /** Spent placing it (from stock or bought). */
  used: number;
  /** Sold on the Bazaar above the reserve (mutation items only). */
  sold: number;
  /** Bought on the Bazaar because a placement was short. */
  bought: number;
  prices: UnitPrices | null;
  /** Mutation items: kept instead of sold. Null for everything else (never sold). */
  reserve: number | null;
  /** The reserve is the user's, not the automatic one. */
  reserveSet: boolean;
  /** A manual price replaces part of the live book for this item. */
  overridden: boolean;
}

/** Ironman: NPC prices only (mutation items have none). Never null, so every value shows. */
function npcPrices(id: string): UnitPrices {
  const sell = data.mutations[id] ? 0 : defaultNpcPrice(data, id);
  return { sell, sellFrom: sell > 0 ? "npc" : "none", buy: null };
}

/**
 * Every item worth listing, each once: held, produced, placed, traded, or reserved by the layouts.
 * Normal profile: pass `bazaar` (prices are null until quotes exist). Ironman: omit it; rows use
 * NPC prices and have no trades or reserve.
 */
export function buildItemRows(args: {
  state: SimulationState;
  held: Record<string, number>;
  bazaar?: {
    quotes: Quotes | null;
    pricing: BazaarPricing;
    reserve: Record<string, number>;
    reserveOverrides: Record<string, number>;
    overridden: Record<string, unknown>;
  };
}): ItemRow[] {
  const { state, held, bazaar } = args;
  const market = state.summary.market;
  const ids = new Set<string>([...Object.keys(held), ...Object.keys(state.ledger), ...Object.keys(bazaar?.reserve ?? {})]);
  if (market) for (const rec of [market.bought, market.sold]) for (const id of Object.keys(rec)) ids.add(id);
  const rows: ItemRow[] = [];
  for (const id of ids) {
    const row = state.ledger[id];
    const isMut = !!data.mutations[id];
    const r: ItemRow = {
      id,
      category: itemCategory(id),
      held: held[id] ?? 0,
      made: row?.produced ?? 0,
      used: row?.consumed ?? 0,
      sold: market?.sold[id] ?? 0,
      bought: market?.bought[id] ?? 0,
      prices: bazaar ? (bazaar.quotes ? unitPrices(data, id, bazaar.quotes, bazaar.pricing) : null) : npcPrices(id),
      reserve: bazaar && isMut ? bazaar.reserve[id] ?? 0 : null,
      reserveSet: !!bazaar && id in bazaar.reserveOverrides,
      overridden: !!bazaar && id in bazaar.overridden,
    };
    // All-in Aloe Fragments only ever combine into All-in Aloe; skip them once none are held.
    if (id === "all_in_aloe_fragment" && r.held === 0) continue;
    // A held 0 that is negative (ironman mutation debt) still shows.
    if (r.held === 0 && r.made === 0 && r.used === 0 && r.sold === 0 && r.bought === 0 && !(r.reserve && r.reserve > 0)) continue;
    rows.push(r);
  }
  return rows;
}

/** Apply a delta (negative = remove) to an item map, never below 0; zero entries are dropped. */
export function applyItemDelta(base: Record<string, number>, delta: Record<string, number>): Record<string, number> {
  const out = { ...base };
  for (const [id, d] of Object.entries(delta)) {
    const next = Math.max(0, Math.floor((out[id] ?? 0) + d));
    if (next > 0) out[id] = next;
    else delete out[id];
  }
  return out;
}

/** "just now" / "3m ago" from a fetch time (ms). */
export function priceAge(fetchedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (s < 60) return "just now";
  return `${formatDuration(s)} ago`;
}
