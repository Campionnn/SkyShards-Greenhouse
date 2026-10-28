/**
 * "How much of each mutation does the whole flow need?", measured from simulated runs.
 *
 * - **Total**: runs of the flow from an empty start (every plot on empty farmland, nothing owned,
 *   the player's own schedule and stats) to Done. Per item, the median the runs placed, plus what
 *   the goal keeps at the end. Computed once per flow version and settings (`baselineTotals`), and
 *   remembered.
 * - **Still to make**: the forecast's own runs from the player's current check-in. Per item, the
 *   median they still place plus the goal's count, minus what the player owns now.
 *
 * Owning something further down the chain means the runs never build what it is made from, so a
 * player who already owns everything made from Gloomgourd has Gloomgourd covered with none in stock.
 * The script's build-plan walk is not used for this: it rounds every farm up to whole builds at each
 * level, which roughly doubled the low tiers (Choconut ~340 against ~130-190 actually placed).
 */
import { ALOE_FRAGMENT, SUPPLY_ITEMS, type Catalog, type FlowsFile } from "./flow";
import type { RunTimeline } from "./types";

/** The script's stock marks (`D.high`): a farm works up to these before it hands the plot on. */
export function scriptMarks(flow: FlowsFile): Record<string, number> {
  const source = flow.plots.find((p) => p.script?.source)?.script?.source ?? flow.script?.source ?? "";
  const match = /^const D = (\{.*\});\s*$/m.exec(source);
  if (!match) return {};
  try {
    const d = JSON.parse(match[1]) as { high?: unknown };
    if (!d.high || typeof d.high !== "object") return {};
    return Object.fromEntries(Object.entries(d.high as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0));
  } catch {
    return {};
  }
}

/** One item's place in the whole flow. */
export interface FlowNeed {
  item: string;
  /** Typical total the flow uses from an empty start: placed as inputs plus the goal's count. */
  total: number;
  /** Still to make, from the forecast runs of the player's current check-in. */
  remaining: number;
  /** `total - remaining`: covered by stock, or by owning what it would have been made into. */
  covered: number;
  have: number;
}

export interface FlowNeeds {
  /** Empty until both the totals and a forecast are in (`ready`). */
  items: Record<string, FlowNeed>;
  ready: boolean;
  /** Runs the totals were measured on. */
  runs: number;
  /** The script's stock marks, for "this farm stays until you have N" (available at once). */
  high: Record<string, number>;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Mutations the totals cover: the catalog's items without Dead Plants, Fermento and Aloe fragments. */
function countedItems(catalog: Catalog): string[] {
  return catalog.items.filter((item) => !(SUPPLY_ITEMS as readonly string[]).includes(item) && item !== ALOE_FRAGMENT);
}

/** Runs that reached Done, or every run when none did. */
const finishedOrAll = (runs: RunTimeline[]) => (runs.some((r) => r.done) ? runs.filter((r) => r.done) : runs);

/** Per item: the median the runs placed plus the goal's count (the whole flow from an empty start). */
export function baselineTotals(runs: RunTimeline[], catalog: Catalog): Record<string, number> {
  const pool = finishedOrAll(runs);
  const goal = new Map(catalog.goal.map((g) => [g.item, g.count]));
  const out: Record<string, number> = {};
  for (const item of countedItems(catalog)) {
    const total = Math.round(median(pool.map((r) => r.placed?.[item] ?? 0))) + (goal.get(item) ?? 0);
    if (total > 0) out[item] = total;
  }
  return out;
}

/**
 * Totals and progress. `current` are the forecast runs from the player's check-in (null while they
 * are still calculating); `inventory` is the stock those runs started from.
 */
export function flowNeeds(
  totals: Record<string, number> | null,
  current: RunTimeline[] | null,
  catalog: Catalog,
  inventory: Readonly<Record<string, number>>,
  high: Record<string, number>,
  runs = 0
): FlowNeeds {
  if (!totals || !current?.length) return { items: {}, ready: false, runs, high };
  const have = (item: string) => {
    const own = Math.max(0, inventory[item] ?? 0);
    // Every 9 fragments are one All-in Aloe, as the goal counts them.
    return item === "all_in_aloe" ? own + Math.floor(Math.max(0, inventory[ALOE_FRAGMENT] ?? 0) / 9) : own;
  };
  const goal = new Map(catalog.goal.map((g) => [g.item, g.count]));
  const pool = finishedOrAll(current);
  const items: Record<string, FlowNeed> = {};
  for (const [item, total] of Object.entries(totals)) {
    const placed = Math.round(median(pool.map((r) => r.placed?.[item] ?? 0)));
    let stillUsed = placed + (goal.get(item) ?? 0);
    // The two sets of runs differ by chance: while the runs still place it, a few less than the
    // empty-start total is noise, not something already made into a later item (a clear drop).
    if (placed > 0 && total - stillUsed < Math.max(3, 0.1 * total)) stillUsed = Math.max(stillUsed, total);
    const remaining = Math.min(total, Math.max(0, stillUsed - have(item)));
    items[item] = { item, total, remaining, covered: total - remaining, have: have(item) };
  }
  return { items, ready: true, runs, high };
}

/** Overall progress: items fully covered, and covered/total summed over every item. */
export function needsTotals(needs: FlowNeeds): { items: number; done: number; covered: number; total: number } {
  const rows = Object.values(needs.items);
  return {
    items: rows.length,
    done: rows.filter((r) => r.remaining === 0).length,
    covered: rows.reduce((s, r) => s + r.covered, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
  };
}

/** A short stable fingerprint of a flows file, so remembered totals are dropped when the flow changes. */
export function flowFingerprint(flow: FlowsFile): string {
  const text = JSON.stringify(flow.plots);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${text.length}`;
}
