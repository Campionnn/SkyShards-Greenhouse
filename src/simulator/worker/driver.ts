import type { Engine } from "../engine";
import type { BatchResult, RetainEvents, RunSummary, SimulationState, TickEventKind, TimedEvent } from "../sim/state";

// Time-sliced execution of one long run. The driver calls run(state, k)
// repeatedly - legitimate because run(s, a) then run(result, b) equals
// run(s, a + b) - and yields to the event loop between slices so a Stop
// message can be processed. It is the only place allowed to read the clock.

const SLICE_BUDGET_MS = 16;
const PROGRESS_INTERVAL_MS = 100;

export interface DriveOptions {
  retainEvents: RetainEvents;
  shouldStop: () => boolean;
  onProgress?: (p: { cycle: number; done: number; total: number; summary: RunSummary }) => void;
  /** With retainEvents 'all': keep only events from the last N cycles (the UI's recent-events log). */
  keepLastCycles?: number;
  /** Event kinds too noisy to ship to the UI (e.g. every "advanced" growth step). */
  dropKinds?: readonly TickEventKind[];
  /** Yield between slices (a macrotask in the worker; tests may pass a no-op). */
  yieldToEventLoop?: () => Promise<void>;
  /**
   * Hand the state at every multiple of `every()` cycles to `save` (the
   * session's timeline, so the UI can go back). Slices are cut at those
   * cycles; that does not change the result because run() is splittable.
   */
  checkpoints?: { every: () => number; save: (state: SimulationState) => void };
}

export function macrotask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export async function drive(engine: Engine, state: SimulationState, ticks: number, opts: DriveOptions): Promise<BatchResult> {
  const yieldNow = opts.yieldToEventLoop ?? macrotask;
  let current = state;
  let events: TimedEvent[] = [];
  const eventCounts: Partial<Record<TickEventKind, number>> = {};
  let done = 0;
  let truncated = false;
  let chunk = 1;
  let lastProgress = 0;

  while (done < ticks) {
    if (opts.shouldStop()) {
      truncated = true;
      break;
    }
    let k = Math.min(chunk, ticks - done);
    if (opts.checkpoints) {
      const every = opts.checkpoints.every();
      k = Math.min(k, every - (current.cycle % every));
    }
    const t0 = performance.now();
    const r = engine.run(current, k, { retainEvents: opts.retainEvents });
    const elapsed = performance.now() - t0;

    current = r.state;
    if (opts.checkpoints && current.cycle % opts.checkpoints.every() === 0) opts.checkpoints.save(current);
    done += r.cyclesRun;
    for (const [kind, n] of Object.entries(r.eventCounts) as [TickEventKind, number][]) {
      eventCounts[kind] = (eventCounts[kind] ?? 0) + n;
    }
    const kept = opts.dropKinds?.length ? r.events.filter((e) => !opts.dropKinds!.includes(e.kind)) : r.events;
    if (opts.retainEvents === "all") {
      events = events.concat(kept);
      if (opts.keepLastCycles !== undefined) {
        const from = current.cycle - opts.keepLastCycles;
        if (events.length && events[0].cycle < from) events = events.filter((e) => e.cycle >= from);
      }
    } else if (opts.retainEvents === "summary" && r.events.length) {
      events = kept;
    }

    // Aim each slice at the frame budget.
    const perCycle = elapsed / Math.max(1, r.cyclesRun);
    chunk = Math.max(1, Math.min(1000, Math.floor(SLICE_BUDGET_MS / Math.max(perCycle, 0.01))));

    const now = performance.now();
    if (opts.onProgress && (now - lastProgress >= PROGRESS_INTERVAL_MS || done >= ticks)) {
      lastProgress = now;
      opts.onProgress({ cycle: current.cycle, done, total: ticks, summary: current.summary });
    }
    if (done < ticks) await yieldNow();
  }

  return { state: current, events, eventCounts, cyclesRun: done, truncated, summary: current.summary };
}
