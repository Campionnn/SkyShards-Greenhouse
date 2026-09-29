import type { PriceSource } from "../economy/prices";
import type { ItemId } from "../data/types";
import { ALOE_FRAGMENT, FRAGMENTS_PER_ALOE } from "../stage/aloe";
import { bump } from "./summary";
import type { LedgerRow, PlotId, SimulationState, TickEvent } from "./state";

const ALOE_ID = "all_in_aloe";

/** Debt events kept in state; the summary counts all of them. */
export const MAX_STORED_DEBTS = 500;

export function ledgerRow(state: SimulationState, item: ItemId): LedgerRow {
  let row = state.ledger[item];
  if (!row) {
    const stock = state.inventory[item] ?? 0;
    row = { produced: 0, consumed: 0, shortfall: 0, minStock: stock, firstStockoutCycle: null };
    state.ledger[item] = row;
  }
  return row;
}

/**
 * All-in Aloe Fragments have no other use: every 9 in the inventory turn into
 * one All-in Aloe straight away (recorded as fragments consumed, aloe produced).
 */
export function convertAloeFragments(state: SimulationState): number {
  const have = state.inventory[ALOE_FRAGMENT] ?? 0;
  const aloes = Math.floor(have / FRAGMENTS_PER_ALOE);
  if (aloes <= 0) return 0;
  const used = aloes * FRAGMENTS_PER_ALOE;
  state.inventory[ALOE_FRAGMENT] = have - used;
  ledgerRow(state, ALOE_FRAGMENT).consumed += used;
  credit(state, ALOE_ID, aloes);
  return aloes;
}

/** Items entering the shared inventory (harvests, cleared dead plants). */
export function credit(state: SimulationState, item: ItemId, qty: number): void {
  if (qty <= 0) return;
  const row = ledgerRow(state, item);
  state.inventory[item] = (state.inventory[item] ?? 0) + qty;
  row.produced += qty;
}

export interface SpendRequest {
  cycle: number;
  plotId: PlotId;
  row: number;
  col: number;
  action: string;
  /** Re-placing something that decayed or was destroyed (a recurring cost). */
  replacement: boolean;
}

/**
 * A REQUIRED spend (placing a mutation item / fire / fermento / dead plant).
 * Inventory never goes negative: a spend that cannot be covered is recorded
 * as debt - once per (plot, cell, item) episode - and the action fails.
 */
export function spend(
  state: SimulationState,
  item: ItemId,
  qty: number,
  req: SpendRequest,
  prices: PriceSource,
  emit: (plotId: PlotId, e: TickEvent) => void
): boolean {
  const row = ledgerRow(state, item);
  const available = state.inventory[item] ?? 0;
  const episode = `${req.plotId}:${req.row},${req.col}:${item}`;

  if (available >= qty) {
    state.inventory[item] = available - qty;
    row.consumed += qty;
    row.minStock = Math.min(row.minStock, state.inventory[item]);
    delete state.openDebts[episode];
    bump(state.summary.placedItems, item, qty);
    if (req.replacement) {
      state.summary.replacements += 1;
      state.summary.costs.replacements += qty * prices.price(item);
    }
    return true;
  }

  const shortfall = qty - available;
  state.summary.unfilledCellCycles += 1;
  row.minStock = Math.min(row.minStock, available);
  if (!state.openDebts[episode]) {
    state.openDebts[episode] = true;
    row.shortfall += shortfall;
    row.firstStockoutCycle ??= req.cycle;
    state.summary.debtEvents += 1;
    state.summary.costs.supplies += shortfall * prices.price(item);
    if (state.debts.length < MAX_STORED_DEBTS) {
      state.debts.push({
        cycle: req.cycle,
        plotId: req.plotId,
        item,
        needed: qty,
        available,
        shortfall,
        row: req.row,
        col: req.col,
        action: req.action,
      });
    }
    emit(req.plotId, { kind: "debt", item, row: req.row, col: req.col, needed: qty, available });
  }
  return false;
}

/**
 * The user adds (or, with a negative quantity, removes) items in the live
 * run's inventory. Pure: returns a new state. Not revenue and not "produced"
 * in the ledger (sustainability stays about what the layout makes itself);
 * tracked in summary.injected instead. Inventory never goes below 0.
 */
export function injectItems(input: SimulationState, items: Record<ItemId, number>): SimulationState {
  const state = structuredClone(input);
  for (const [item, raw] of Object.entries(items)) {
    const qty = Math.trunc(raw);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const row = ledgerRow(state, item);
    const have = state.inventory[item] ?? 0;
    const next = Math.max(0, have + qty);
    state.inventory[item] = next;
    bump(state.summary.injected, item, next - have);
    if (next < row.minStock) row.minStock = next;
  }
  convertAloeFragments(state);
  return state;
}

/** Forget a plot's open shortfall episodes (its layout changed, so the cells may no longer be needed). */
export function closePlotDebts(state: SimulationState, plotId: PlotId): void {
  const prefix = `${plotId}:`;
  for (const key of Object.keys(state.openDebts)) {
    if (key.startsWith(prefix)) delete state.openDebts[key];
  }
}
