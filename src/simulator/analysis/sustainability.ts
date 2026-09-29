import type { GameData, ItemId } from "../data/types";
import type { DebtEvent, SimulationState } from "../sim/state";

export type ItemStatus =
  /** Needed more than it had at some point: the layout went into debt on it. */
  | "bottleneck"
  /** Consumed but never produced: it can only come from the starting inventory. */
  | "externally-seeded"
  /** Produced more than consumed, never short. */
  | "surplus"
  /** Consumed and produced, never short. */
  | "self-sustaining";

export interface ItemReport {
  item: ItemId;
  produced: number;
  consumed: number;
  stock: number;
  minStock: number;
  shortfall: number;
  firstStockoutCycle: number | null;
  status: ItemStatus;
  /** A mutation with no decay: placed once, it never needs replacing. */
  permanent: boolean;
}

export interface SustainabilityReport {
  /** The debt test: true iff no required spend ever came up short. */
  sustainable: boolean;
  /** The headline: the first time the layout needed something it did not have. */
  firstDebt: DebtEvent | null;
  debts: DebtEvent[];
  debtCount: number;
  /** Failed placement attempts - how long cells sat empty for want of stock. */
  unfilledCellCycles: number;
  items: ItemReport[];
}

/**
 * Sustainability is "would it ever go into debt?" - not "is the average net
 * positive". A report on this one run; it never suggests a fix.
 */
export function analyseSustainability(state: SimulationState, data: GameData): SustainabilityReport {
  const items: ItemReport[] = Object.entries(state.ledger)
    .map(([item, row]) => {
      const status: ItemStatus =
        row.shortfall > 0
          ? "bottleneck"
          : row.produced === 0 && row.consumed > 0
            ? "externally-seeded"
            : row.produced > row.consumed
              ? "surplus"
              : "self-sustaining";
      const m = data.mutations[item];
      return {
        item,
        produced: row.produced,
        consumed: row.consumed,
        stock: state.inventory[item] ?? 0,
        minStock: row.minStock,
        shortfall: row.shortfall,
        firstStockoutCycle: row.firstStockoutCycle,
        status,
        permanent: !!m && m.decayDays === 0,
      };
    })
    .sort((a, b) => a.item.localeCompare(b.item));

  return {
    sustainable: state.summary.debtEvents === 0,
    firstDebt: state.debts[0] ?? null,
    debts: state.debts,
    debtCount: state.summary.debtEvents,
    unfilledCellCycles: state.summary.unfilledCellCycles,
    items,
  };
}

/** "Ran out of Chloronite at cycle 147 on plot 2 (needed 1, had 0)". */
export function describeDebt(d: DebtEvent, name: (id: string) => string): string {
  return `Ran out of ${name(d.item)} at cycle ${d.cycle} on plot ${d.plotId} (needed ${d.needed}, had ${d.available})`;
}
