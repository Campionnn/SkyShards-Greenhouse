import type { PriceSource } from "../economy/prices";
import type { ItemId } from "../data/types";
import { ALOE_FRAGMENT, FRAGMENTS_PER_ALOE } from "../growth/aloe";
import { cloneState } from "./clone";
import { canBuy, countProduced } from "./market";
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

/** Convert every 9 All-in Aloe Fragments in inventory into one All-in Aloe. Returns aloes made. */
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

/** Add produced items to the shared inventory. */
export function credit(state: SimulationState, item: ItemId, qty: number): void {
  if (qty <= 0) return;
  const row = ledgerRow(state, item);
  state.inventory[item] = (state.inventory[item] ?? 0) + qty;
  row.produced += qty;
  countProduced(state, item, qty);
  closeLoanIfRepaid(state, item, row);
}

/** `config.bootstrapDebt`: an open loan closes for good once the item's stock is back at 0 or above. */
function closeLoanIfRepaid(state: SimulationState, item: ItemId, row: LedgerRow): void {
  if (!row.loanOpen || (state.inventory[item] ?? 0) < 0) return;
  delete row.loanOpen;
  row.repaidCycle = state.cycle;
}

export interface SpendRequest {
  cycle: number;
  plotId: PlotId;
  row: number;
  col: number;
  action: string;
  /** Re-placing something that decayed or was destroyed. */
  replacement: boolean;
  /**
   * `config.allowMutationDebt` for a mutation item: an uncovered spend still
   * succeeds, taking the stock below 0 (booked in `summary.borrowed`).
   */
  allowDebt?: boolean;
  /**
   * `config.bootstrapDebt` setup: borrow what the stock doesn't cover and open a loan on the
   * item (`LedgerRow.loanOpen`). Any spend of an item with an open loan may also borrow.
   */
  openLoan?: boolean;
}

/**
 * Required spend. Without `req.allowDebt` inventory never goes negative: an
 * uncovered spend fails and records debt once per (plot, cell, item) episode.
 * With it, the spend always succeeds and the uncovered units are borrowed.
 * Normal profile (sim/market.ts): a Bazaar item short of stock buys the shortfall
 * first (`summary.market.bought`, a `bought` event), so it never goes short or borrows.
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
  let available = state.inventory[item] ?? 0;
  const episode = `${req.plotId}:${req.row},${req.col}:${item}`;

  if (available < qty && canBuy(state, item)) {
    const buy = qty - Math.max(0, available);
    available = Math.max(0, available) + buy;
    state.inventory[item] = available;
    bump(state.summary.market!.bought, item, buy);
    emit(req.plotId, { kind: "bought", item, row: req.row, col: req.col, qty: buy });
  }

  if (available >= qty || req.allowDebt || req.openLoan || row.loanOpen) {
    const borrowed = Math.min(qty, qty - available);
    if (borrowed > 0) {
      bump((state.summary.borrowed ??= {}), item, borrowed);
      emit(req.plotId, { kind: "borrowed", item, row: req.row, col: req.col, qty: borrowed, stock: available - qty });
      if (req.openLoan) row.loanOpen = true;
    }
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
 * Undo one placement spend: the player picked a placed item back up before any tick ran
 * (`PlantState.gate.pickup`). The unit returns to the stock and is no longer counted as consumed
 * or placed, so the ledger reads as if it was never spent (anything bought or borrowed for it stays booked).
 */
export function refundPlacement(state: SimulationState, item: ItemId, replacement: boolean, prices: PriceSource): void {
  const row = ledgerRow(state, item);
  state.inventory[item] = (state.inventory[item] ?? 0) + 1;
  row.consumed -= 1;
  const placed = state.summary.placedItems;
  if ((placed[item] ?? 0) > 1) placed[item] -= 1;
  else delete placed[item];
  if (replacement) {
    state.summary.replacements -= 1;
    state.summary.costs.replacements -= prices.price(item);
  }
  closeLoanIfRepaid(state, item, row);
}

/**
 * Manually add (or remove, if negative) inventory items. Pure. Tracked in
 * summary.injected, not as revenue or ledger production. Removing stops at 0
 * (a stock already below 0 from mutation debt is never pushed further down).
 */
export function injectItems(input: SimulationState, items: Record<ItemId, number>): SimulationState {
  const state = cloneState(input);
  for (const [item, raw] of Object.entries(items)) {
    const qty = Math.trunc(raw);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const row = ledgerRow(state, item);
    const have = state.inventory[item] ?? 0;
    const next = Math.max(Math.min(0, have), have + qty);
    state.inventory[item] = next;
    bump(state.summary.injected, item, next - have);
    if (next < row.minStock) row.minStock = next;
    closeLoanIfRepaid(state, item, row);
  }
  convertAloeFragments(state);
  return state;
}

/** Close a plot's open debt episodes (called on layout change). */
export function closePlotDebts(state: SimulationState, plotId: PlotId): void {
  const prefix = `${plotId}:`;
  for (const key of Object.keys(state.openDebts)) {
    if (key.startsWith(prefix)) delete state.openDebts[key];
  }
}
