/**
 * "Import from Hypixel" for the Guide's inventory: the counts SkyShards-API found in the player's
 * sacks, ender chest, backpacks and inventory become the Guide's totals. Pure functions; the dialog
 * shows `inventoryChanges` with a checkbox each and applies the ticked ones with `applyImportedItems`.
 *
 * Only items the Guide tracks (`catalog.items`: supplies, what the farms place or grow, the goal)
 * are touched. An item the import didn't find is owned 0 times: Hypixel reports every storage, so
 * absence means none (when the Inventory API is off the server sends no counts at all, and the
 * dialog never gets here).
 */
import type { Catalog } from "./flow";
import { setItem, type GuideState } from "./checkin";

export interface InventoryChange {
  item: string;
  /** What the Guide has now. */
  have: number;
  /** What the import found. */
  found: number;
  /** Where it was found: source -> count (sacks, enderChest, backpacks, inventory). */
  sources: Record<string, number>;
}

const whole = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Every tracked item whose imported count differs from the Guide's, in catalog order. */
export function inventoryChanges(
  catalog: Catalog,
  inventory: Readonly<Record<string, number>>,
  found: Readonly<Record<string, number>>,
  sources: Readonly<Record<string, Record<string, number>>> = {},
): InventoryChange[] {
  const out: InventoryChange[] = [];
  for (const item of catalog.items) {
    const have = whole(inventory[item]);
    const next = whole(found[item]);
    if (have !== next) out.push({ item, have, found: next, sources: { ...(sources[item] ?? {}) } });
  }
  return out;
}

/** Tracked items the import found, with their counts (for "found N items"). */
export function trackedFound(catalog: Catalog, found: Readonly<Record<string, number>>): number {
  return catalog.items.filter((item) => whole(found[item]) > 0).length;
}

/** Set the ticked items to their imported totals. */
export function applyImportedItems(state: GuideState, changes: readonly InventoryChange[], only?: ReadonlySet<string>): GuideState {
  let next = state;
  for (const c of changes) if (!only || only.has(c.item)) next = setItem(next, c.item, c.found);
  return next;
}
