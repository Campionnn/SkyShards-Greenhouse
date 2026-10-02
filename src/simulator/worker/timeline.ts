import type { Engine } from "../engine";
import type { ItemId } from "../data/types";
import type { SimulationState } from "../sim/state";

// Session history for going back. Going back replays forward with run() from
// the nearest saved state at or before the target; determinism (RNG in state)
// makes that exact. Saved states:
//  - the setup state, always kept;
//  - periodic checkpoints at multiples of `every`, thinned (doubling `every`)
//    beyond MAX_PERIODIC so memory stays bounded;
//  - the state after each inventory change (never thinned; replay can't recreate it);
//  - a small cache of recent per-cycle states for fast repeated Back.
// History is linear: going back discards everything after the target.

export type UndoableAction =
  /** A Step (cycles = 1) or a Run of `cycles` cycles that started at `fromCycle`. */
  | { kind: "run"; fromCycle: number; cycles: number }
  /** Items added (negative = removed) in the live inventory at `cycle`. */
  | { kind: "items"; cycle: number; items: Record<ItemId, number> };

export interface HistoryInfo {
  /** Past the setup state. */
  canStepBack: boolean;
  /** What Undo would take back. */
  lastAction: UndoableAction | null;
}

export const FIRST_CHECKPOINT_EVERY = 50;
export const MAX_PERIODIC_CHECKPOINTS = 60;
/** Per-cycle states kept around the current position. */
export const RECENT_STATES = 48;
/** Cycles before a replay target that are stored per cycle. */
const DENSE_REPLAY = 32;

interface Checkpoint {
  /** Monotonic save order. */
  seq: number;
  cycle: number;
  state: SimulationState;
  periodic: boolean;
}

interface ActionEntry {
  action: UndoableAction;
  /** Position just before the action: cycle and last checkpoint seq. */
  cycle: number;
  seq: number;
}

export interface Timeline {
  current(): SimulationState;
  info(): HistoryInfo;
  /** Cycle interval at which the driver hands over checkpoints. */
  checkpointEvery(): number;
  checkpoint(state: SimulationState): void;
  /** Call before a Step / Run. */
  beginRun(): void;
  /** Call with the final state after a Step / Run, including when stopped early. */
  endRun(state: SimulationState, cyclesRun: number): void;
  /** Inventory changed without time moving. */
  itemsChanged(next: SimulationState, items: Record<ItemId, number>): void;
  /** Go back exactly one cycle; null at the setup state. */
  stepBack(): SimulationState | null;
  /** Take back the last Step / Run / inventory change; null if none. */
  undo(): { state: SimulationState; action: UndoableAction } | null;
}

export interface TimelineOptions {
  firstCheckpointEvery?: number;
  maxPeriodicCheckpoints?: number;
  recentStates?: number;
}

export function createTimeline(engine: Engine, initial: SimulationState, opts: TimelineOptions = {}): Timeline {
  const MAX_PERIODIC = opts.maxPeriodicCheckpoints ?? MAX_PERIODIC_CHECKPOINTS;
  const RECENT = opts.recentStates ?? RECENT_STATES;
  let seq = 0;
  let every = opts.firstCheckpointEvery ?? FIRST_CHECKPOINT_EVERY;
  let checkpoints: Checkpoint[] = [{ seq, cycle: initial.cycle, state: initial, periodic: false }];
  const actions: ActionEntry[] = [];
  const recent = new Map<number, SimulationState>();
  let current = initial;
  let pending: { cycle: number; seq: number } | null = null;

  const lastSeq = () => checkpoints[checkpoints.length - 1].seq;

  function remember(state: SimulationState) {
    recent.set(state.cycle, state);
    while (recent.size > RECENT) {
      // Evict the cycle farthest from the current one.
      let far: number | null = null;
      for (const c of recent.keys()) {
        if (far === null || Math.abs(c - current.cycle) > Math.abs(far - current.cycle)) far = c;
      }
      recent.delete(far!);
    }
  }

  function forgetRecent(pred: (cycle: number) => boolean) {
    for (const c of [...recent.keys()]) if (pred(c)) recent.delete(c);
  }

  function thin() {
    while (checkpoints.filter((c) => c.periodic).length > MAX_PERIODIC) {
      every *= 2;
      checkpoints = checkpoints.filter((c) => !c.periodic || c.cycle % every === 0);
    }
  }

  /** State at `cycle`; every saved state must be at or before it. */
  function reconstruct(cycle: number): SimulationState {
    let start = checkpoints[checkpoints.length - 1].state;
    for (const [c, s] of recent) {
      if (c <= cycle && c > start.cycle) start = s;
    }
    let s = start;
    const gap = cycle - s.cycle;
    if (gap > DENSE_REPLAY) s = engine.run(s, gap - DENSE_REPLAY, { retainEvents: "none" }).state;
    while (s.cycle < cycle) {
      s = engine.run(s, 1, { retainEvents: "none" }).state;
      recent.set(s.cycle, s);
    }
    return s;
  }

  /** Drops undo entries at or after the current position; shortens a partly stepped-back run. */
  function dropStaleActions() {
    while (actions.length) {
      const top = actions[actions.length - 1];
      const stillPast = top.cycle < current.cycle || (top.cycle === current.cycle && top.seq < lastSeq());
      if (stillPast) {
        if (top.action.kind === "run") top.action = { ...top.action, cycles: Math.min(top.action.cycles, current.cycle - top.cycle) };
        break;
      }
      actions.pop();
    }
  }

  function moveTo(state: SimulationState) {
    current = state;
    remember(state);
  }

  return {
    current: () => current,
    info: () => ({
      canStepBack: current.cycle > initial.cycle,
      lastAction: actions.length ? actions[actions.length - 1].action : null,
    }),
    checkpointEvery: () => every,
    checkpoint(state) {
      if (state.cycle <= checkpoints[checkpoints.length - 1].cycle || state.cycle % every !== 0) return;
      checkpoints.push({ seq: ++seq, cycle: state.cycle, state, periodic: true });
      thin();
    },
    beginRun() {
      pending = { cycle: current.cycle, seq: lastSeq() };
      remember(current);
    },
    endRun(state, cyclesRun) {
      const from = pending;
      pending = null;
      if (from && cyclesRun > 0) actions.push({ action: { kind: "run", fromCycle: from.cycle, cycles: cyclesRun }, ...from });
      moveTo(state);
    },
    itemsChanged(next, items) {
      actions.push({ action: { kind: "items", cycle: current.cycle, items }, cycle: current.cycle, seq: lastSeq() });
      // Cached states at this cycle predate the change.
      forgetRecent((c) => c >= next.cycle);
      checkpoints.push({ seq: ++seq, cycle: next.cycle, state: next, periodic: false });
      moveTo(next);
    },
    stepBack() {
      if (current.cycle <= initial.cycle) return null;
      const target = current.cycle - 1;
      checkpoints = checkpoints.filter((c) => c.cycle <= target);
      forgetRecent((c) => c > target);
      moveTo(reconstruct(target));
      dropStaleActions();
      return current;
    },
    undo() {
      const entry = actions.pop();
      if (!entry) return null;
      checkpoints = checkpoints.filter((c) => c.seq <= entry.seq);
      // For an items entry, the cached state at its cycle already includes the change.
      forgetRecent((c) => (entry.action.kind === "items" ? c >= entry.cycle : c > entry.cycle));
      moveTo(reconstruct(entry.cycle));
      return { state: current, action: entry.action };
    },
  };
}
