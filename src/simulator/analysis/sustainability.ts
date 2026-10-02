import type { GameData, ItemId, MutationId } from "../data/types";
import type { DebtEvent, PlotId, SimulationState, UptimeCounts } from "../sim/state";
import { uptimeRatio, zeroUptime } from "../sim/summary";

export type ItemStatus =
  /** Went into debt at some point. */
  | "bottleneck"
  /** Consumed, never produced: comes only from the starting inventory. */
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
  /** Never decays (no timer or infinite minimum), per data.json; overrides ignored. */
  permanent: boolean;
}

/** One watched target cell in one step of one plot's flow. */
export interface SpotReport extends UptimeCounts {
  plotId: PlotId;
  stepId: string;
  /** Position in the plot's flow (-1 if the step no longer exists). */
  stepIndex: number;
  stepLabel: string;
  mutationId: MutationId;
  row: number;
  col: number;
  /** (growing + ready) / watched. */
  uptime: number;
  firstRequirementsCycle: number | null;
  longestRequirementsStreak: number;
}

export interface SustainabilityReport {
  /**
   * True iff no watched cell ever sat empty without its requirements.
   * Blocked and halted cycles lower uptime but don't fail this.
   */
  sustainable: boolean;
  /** Watched cell-cycles across every plot and step. */
  totals: UptimeCounts;
  /** Ratio of totals; 1 when nothing watched yet. */
  uptime: number;
  /** Watched spots, lowest uptime first. */
  spots: SpotReport[];
  /** Earliest cycle a watched spot lacked its requirements. */
  firstFailure: SpotReport | null;
  /** First item shortage (a common cause of lost uptime). */
  firstDebt: DebtEvent | null;
  debts: DebtEvent[];
  debtCount: number;
  /** Failed placement attempts (cells left empty for lack of stock). */
  unfilledCellCycles: number;
  items: ItemReport[];
}

/** Whether watched target cells (`FlowStep.watch`) always stay able to grow their mutation. Measures only. */
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
        permanent: !!m && (m.decayDays === 0 || m.minimumMutations === "infinite"),
      };
    })
    .sort((a, b) => a.item.localeCompare(b.item));

  const spots: SpotReport[] = [];
  for (const [plotKey, byStep] of Object.entries(state.uptime ?? {})) {
    const def = state.scenario.plots.find((p) => String(p.id) === plotKey);
    for (const [stepId, byCell] of Object.entries(byStep)) {
      const stepIndex = def?.flow.steps.findIndex((s) => s.id === stepId) ?? -1;
      const step = def?.flow.steps[stepIndex];
      for (const s of Object.values(byCell)) {
        spots.push({
          plotId: Number(plotKey),
          stepId,
          stepIndex,
          stepLabel: step?.label || stepId,
          mutationId: s.mutationId,
          row: s.row,
          col: s.col,
          watched: s.watched,
          growing: s.growing,
          ready: s.ready,
          requirements: s.requirements,
          blocked: s.blocked,
          // Optional in older saved states.
          halted: s.halted ?? 0,
          uptime: uptimeRatio(s),
          firstRequirementsCycle: s.firstRequirementsCycle,
          longestRequirementsStreak: s.longestRequirementsStreak,
        });
      }
    }
  }
  spots.sort((a, b) => a.uptime - b.uptime || a.plotId - b.plotId || a.stepId.localeCompare(b.stepId) || a.row - b.row || a.col - b.col);

  const failures = spots.filter((s) => s.firstRequirementsCycle !== null);
  const firstFailure = failures.reduce<SpotReport | null>(
    (best, s) => (best === null || s.firstRequirementsCycle! < best.firstRequirementsCycle! ? s : best),
    null
  );
  const totals = { ...zeroUptime(), ...state.summary.uptime };

  return {
    sustainable: totals.requirements === 0,
    totals,
    uptime: uptimeRatio(totals),
    spots,
    firstFailure,
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

/** "Chloronite at (4,5) on plot 2, step Growing, first lacked its requirements at cycle 31". */
export function describeSpotFailure(s: SpotReport, name: (id: string) => string): string {
  return `${name(s.mutationId)} at (${s.row},${s.col}) on plot ${s.plotId}, step ${s.stepLabel}, first lacked its requirements at cycle ${s.firstRequirementsCycle}`;
}
