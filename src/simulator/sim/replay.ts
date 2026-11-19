import { recomputeEffects } from "../effects/adapter";
import { forcedEffectsOf } from "../script/overrides";
import { cloneState } from "./clone";
import type { Env } from "./context";
import { run } from "./run";
import type { ProbeView, StopPoint } from "./stops";
import { finalizeSummary } from "./summary";
import type { SimulationState, TimedEvent } from "./state";

// Stepping inside a cycle: replay the cycle with a probe (sim/stops.ts) and copy the state at the
// stop that is wanted. Determinism makes that exactly the state the cycle passes through. The
// replay's own result is thrown away: the session moves time on with a plain run(), so nothing a
// replay does can change a result.

/** The state at one stop. */
export interface StopCapture {
  /** Position of the stop in the cycle, counting every stop of every kind (0 = the first). */
  ordinal: number;
  stop: StopPoint;
  /** A detached copy of the state right after the stop (the clock has not moved yet), ready to show. */
  state: SimulationState;
  /** Events of this cycle up to the stop. */
  events: TimedEvent[];
}

export interface StopReplay {
  /** Every stop of the cycle, in order. */
  stops: StopPoint[];
  /** For each stop, how many of the cycle's events had been emitted by then. */
  eventsAt: number[];
  /** The stop `pick` chose, if any. */
  capture: StopCapture | null;
}

/**
 * Replay the cycle that starts at `state` (a state between cycles, as run() returns them) and list
 * its stops. `pick(stop, ordinal)` is asked at every stop until it says yes; that stop's state is
 * copied. `state` itself is not changed.
 */
export function replayCycle(env: Env, state: SimulationState, pick: (stop: StopPoint, ordinal: number) => boolean = () => false): StopReplay {
  const stops: StopPoint[] = [];
  const eventsAt: number[] = [];
  let capture: StopCapture | null = null;
  run(env, state, 1, {
    retainEvents: "all",
    ignorePauses: true,
    probe: (stop, at) => {
      const ordinal = stops.length;
      stops.push(stop);
      eventsAt.push(at.events.length);
      if (!capture && pick(stop, ordinal)) capture = { ordinal, stop, state: midCycleState(at), events: at.events.slice() };
    },
  });
  return { stops, eventsAt, capture };
}

/**
 * A detached copy of a mid-cycle working state, made presentable: the scripts' variables encoded
 * as they are now, the summary's derived numbers recomputed and every plant's `held` effects
 * brought up to date with the plot as it stands (the engine refreshes them only where it reads
 * them). Changes the copy only.
 */
function midCycleState(at: ProbeView): SimulationState {
  const s = cloneState(at.state);
  if (s.scripts && at.scripts) at.scripts.encodeInto(s.scripts);
  finalizeSummary(s.summary, s.cycle, s.elapsedSeconds);
  const forced = forcedEffectsOf(s);
  for (const plot of s.plots) recomputeEffects(plot, forced);
  return s;
}
