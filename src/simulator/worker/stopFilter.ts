import type { Engine } from "../engine";
import type { SimulationState } from "../sim/state";
import type { StopKind, StopPoint } from "../sim/stops";

// Which stop points Step goes to when stepping inside a cycle (sim/stops.ts), and the scan that
// finds them. Shared by the page (Run menu, Step by: Detail) and the session worker. Not part of
// the engine or the verify bundle: it only drives engine.run with a read-only probe.

export interface StopFilter {
  /** The kinds of stop to step to. */
  kinds: StopKind[];
  /**
   * Per kind, the ids switched off (phase ids, action ids, hook names). Everything not listed is
   * on, so anything the engine adds later is included. `debug.*` stands for every debug tool.
   */
  off?: Partial<Record<StopKind, string[]>>;
  /** Only these plots (empty or missing: every plot). Stops of no single plot always count. */
  plots?: number[];
  /** Skip a phase stop when the phase changed nothing (no plant, ground, stock, step or dice change). */
  skipIdle?: boolean;
}

const isPhase = (s: StopPoint) => s.kind === "tickPhase" || s.kind === "sessionPhase";

/** Does `f` pick `s` (leaving out `skipIdle`, which needs the scan)? */
export function stopMatches(f: StopFilter, s: StopPoint): boolean {
  if (!f.kinds.includes(s.kind)) return false;
  if (f.plots?.length && s.plotId !== null && !f.plots.includes(s.plotId)) return false;
  const off = f.off?.[s.kind];
  if (!off?.length) return true;
  return !(off.includes(s.id) || (s.id.startsWith("debug.") && off.includes("debug.*")));
}

/**
 * A cheap fingerprint of what a phase can change: every plant (identity, place, stage, water,
 * timers, counters, special state, held effects), ground, slots, flow position, stock, the game's
 * dice and the event count. Equal before and after a phase = the phase did nothing visible.
 */
function fingerprint(s: SimulationState, events: number): string {
  const parts: (string | number | null)[] = [events, s.rng.join(","), s.nextPlantId];
  for (const plot of s.plots) {
    parts.push(plot.id, plot.plants.length, JSON.stringify(plot.groundOverrides), plot.slots.length);
    for (const p of plot.plants) {
      parts.push(p.id, p.kindId, p.row, p.col, p.stage, p.water, p.decaySecondsRemaining, p.timesMutated, String(p.mutatesRemaining), p.held.join("+"), p.lockedEffects ? p.lockedEffects.length : -1);
      for (const k in p.gate) parts.push(k, JSON.stringify(p.gate[k as keyof typeof p.gate]));
    }
  }
  for (const r of s.flows) parts.push(r.stepIndex, r.pendingTransition ? 1 : 0, r.finished ? 1 : 0, r.history.length);
  for (const k in s.inventory) parts.push(k, s.inventory[k]);
  return parts.join("|");
}

export interface CycleScan {
  /** Every stop of the cycle, in order. */
  stops: StopPoint[];
  /** For each stop, how many of the cycle's events had been emitted by then. */
  eventsAt: number[];
  /** For each stop, whether Step goes there under the filter. */
  chosen: boolean[];
}

/** Replay the cycle starting at `base` and mark the stops `filter` picks. Never changes `base`. */
export function scanCycle(engine: Engine, base: SimulationState, filter: StopFilter): CycleScan {
  const stops: StopPoint[] = [];
  const eventsAt: number[] = [];
  const chosen: boolean[] = [];
  let before = filter.skipIdle ? fingerprint(base, 0) : "";
  engine.run(base, 1, {
    retainEvents: "all",
    ignorePauses: true,
    probe: (stop, at) => {
      stops.push(stop);
      eventsAt.push(at.events.length);
      let pick = stopMatches(filter, stop);
      if (filter.skipIdle) {
        const now = fingerprint(at.state, at.events.length);
        if (pick && isPhase(stop) && now === before) pick = false;
        before = now;
      }
      chosen.push(pick);
    },
  });
  return { stops, eventsAt, chosen };
}
