import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSummary, Scenario, ScenarioIssue, StopKind, TickEventKind, TimedEvent } from "../simulator";
import type { HistoryInfo, SessionSnapshot, StopPosition, UndoableAction, WorkerRequest, WorkerResponse } from "../simulator/worker/protocol";

/** Cycles of history the recent-events log keeps. */
export const LOG_CYCLES = 20;

/** Per-plant growth chatter that would drown the log and the grid marks. */
const NOISY: TickEventKind[] = ["advanced", "playerSession", "fullyGrown", "growthBlocked", "growthSkipped"];

export type SimulationStatus = "loading" | "ready" | "running" | "error";

export interface SimulationView {
  status: SimulationStatus;
  snapshot: SessionSnapshot | null;
  /** The cumulative summary before the last call, for "this step" deltas. */
  previousSummary: RunSummary | null;
  /** Events of the last simulated cycle (grid highlights; cleared by the next step). */
  lastCycleEvents: TimedEvent[];
  /** Recent events, oldest first, bounded to LOG_CYCLES cycles. */
  log: TimedEvent[];
  progress: { done: number; total: number; summary: RunSummary | null } | null;
  lastCall: { cyclesRun: number; truncated: boolean } | null;
  error: string | null;
  issues: ScenarioIssue[];
  warnings: ScenarioIssue[];
  /** What going back can do from here. */
  history: HistoryInfo;
  /** The last Back / Undo, for the status line (cleared by the next Step / Run). */
  rewound: { undone: UndoableAction | null } | null;
  /**
   * The in-flight request is a quick one (a single Step, Back or Undo). The page keeps showing the
   * settled view for those (see `settledView`) so holding → doesn't flash the run controls, the
   * progress bar and the status line on every cycle.
   */
  quiet: boolean;
  /**
   * Stepping inside a cycle: the stop point shown now (the snapshot is mid-cycle), or null between
   * cycles. Back from here goes to the cycle's start; Step / Run finish the cycle first.
   */
  stop: StopPosition | null;
}

/** The view as the page draws it: a quick Step / Back / Undo in flight still looks ready. */
export function settledView(view: SimulationView): SimulationView {
  return view.status === "running" && view.quiet ? { ...view, status: "ready", progress: null } : view;
}

const initialView: SimulationView = {
  status: "loading",
  snapshot: null,
  previousSummary: null,
  lastCycleEvents: [],
  log: [],
  progress: null,
  lastCall: null,
  error: null,
  issues: [],
  warnings: [],
  history: { canStepBack: false, lastAction: null },
  rewound: null,
  quiet: false,
  stop: null,
};

function trimLog(events: TimedEvent[], currentCycle: number): TimedEvent[] {
  const from = currentCycle - LOG_CYCLES;
  return events.length && events[0].cycle < from ? events.filter((e) => e.cycle >= from) : events;
}

/**
 * Client for the simulator's session worker. The worker owns the state;
 * this hook holds the latest snapshot. Step and Run are the same request
 * (run 1 vs run N), so both always agree.
 */
export function useSimulation(scenario: Scenario | null) {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  /** reqId of the latest init/reset; older responses belong to a previous scenario and are dropped. */
  const epochRef = useRef(0);
  const [view, setView] = useState<SimulationView>(initialView);
  /** A run / back request is in flight. The page may draw a quick one as ready, so guard here too. */
  const busyRef = useRef(false);

  useEffect(() => {
    const worker = new Worker(new URL("../simulator/worker/engine.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.reqId < epochRef.current) return;
      if (msg.type === "ready" || msg.type === "result" || msg.type === "rewound" || msg.type === "error" || msg.type === "stopped") busyRef.current = false;
      switch (msg.type) {
        case "ready":
          setView({
            ...initialView,
            status: "ready",
            snapshot: msg.snapshot,
            // Setup lays out every plot; that shows on the grids, not as log lines.
            lastCycleEvents: [],
            log: [],
            warnings: msg.warnings,
            history: msg.history,
          });
          break;
        case "updated":
          setView((v) => ({ ...v, snapshot: msg.snapshot, history: msg.history, error: null, stop: null }));
          break;
        case "rewound":
          setView((v) => {
            const cycle = msg.snapshot.state.cycle;
            return {
              ...v,
              status: "ready",
              snapshot: msg.snapshot,
              history: msg.history,
              // The deltas and grid marks described the step that was undone.
              previousSummary: null,
              lastCycleEvents: [],
              log: v.log.filter((e) => e.cycle < cycle),
              lastCall: null,
              rewound: { undone: msg.undone },
              error: null,
              stop: null,
            };
          });
          break;
        case "progress":
          setView((v) => ({ ...v, progress: { done: msg.done, total: msg.total, summary: msg.summary } }));
          break;
        case "result":
          setView((v) => {
            const cycle = msg.snapshot.state.cycle;
            return {
              ...v,
              status: "ready",
              previousSummary: v.snapshot?.state.summary ?? null,
              snapshot: msg.snapshot,
              // A step inside the cycle finished it: the marks show what happened since the stop before.
              lastCycleEvents: msg.marks ?? msg.events.filter((e) => e.cycle === cycle - 1),
              log: trimLog([...v.log, ...msg.events], cycle),
              progress: null,
              lastCall: { cyclesRun: msg.cyclesRun, truncated: msg.truncated },
              history: msg.history,
              rewound: null,
              error: null,
              stop: null,
            };
          });
          break;
        case "stopped":
          setView((v) => ({
            ...v,
            status: "ready",
            previousSummary: v.snapshot?.state.summary ?? null,
            snapshot: msg.snapshot,
            // What happened since the stop shown before; the log gets the cycle once it is finished.
            lastCycleEvents: msg.events,
            progress: null,
            lastCall: null,
            history: msg.history,
            rewound: null,
            error: null,
            stop: msg.position,
          }));
          break;
        case "error":
          setView((v) => ({
            ...v,
            status: v.snapshot && !msg.issues ? "ready" : "error",
            error: msg.message,
            issues: msg.issues ?? [],
            progress: null,
          }));
          break;
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const send = useCallback((msg: WorkerRequest) => workerRef.current?.postMessage(msg), []);

  // A changed scenario starts a fresh session.
  useEffect(() => {
    if (!scenario || !workerRef.current) return;
    const reqId = ++reqIdRef.current;
    epochRef.current = reqId;
    setView((v) => ({ ...v, status: "loading", error: null, issues: [] }));
    send({ type: "init", reqId, scenario });
  }, [scenario, send]);

  const run = useCallback(
    (ticks: number) => {
      if (ticks < 1 || busyRef.current) return;
      busyRef.current = true;
      setView((v) => (v.status === "ready" ? { ...v, status: "running", quiet: ticks === 1, progress: { done: 0, total: ticks, summary: null } } : v));
      send({ type: "run", reqId: ++reqIdRef.current, ticks, retainEvents: "all", keepLastCycles: LOG_CYCLES, dropKinds: NOISY });
    },
    [send]
  );

  const step = useCallback(() => run(1), [run]);

  /**
   * Step to the next / previous stop point of one of `kinds` inside the cycle (a phase, an action,
   * a script hook). Past the cycle's last one, next finishes the cycle like a Step.
   */
  const stepStop = useCallback(
    (dir: "next" | "prev", kinds: StopKind[]) => {
      if (busyRef.current || kinds.length === 0) return;
      busyRef.current = true;
      setView((v) => (v.status === "ready" ? { ...v, status: "running", quiet: true, progress: null } : v));
      send({ type: "stepStop", reqId: ++reqIdRef.current, dir, kinds, dropKinds: NOISY });
    },
    [send]
  );
  const stop = useCallback(() => send({ type: "stop" }), [send]);
  const reset = useCallback(() => {
    const reqId = ++reqIdRef.current;
    epochRef.current = reqId;
    setView((v) => ({ ...v, status: "loading" }));
    send({ type: "reset", reqId });
  }, [send]);

  /** Adds (negative = removes) items in the live run's inventory, keeping its cycle and history. */
  const addItems = useCallback((items: Record<string, number>) => send({ type: "addItems", reqId: ++reqIdRef.current, items }), [send]);

  /** Goes back exactly one cycle. */
  const stepBack = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setView((v) => (v.status === "ready" ? { ...v, status: "running", quiet: true, progress: null } : v));
    send({ type: "back", reqId: ++reqIdRef.current, to: "cycle" });
  }, [send]);

  /** Take back the last Step / Run / inventory change. */
  const undo = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setView((v) => (v.status === "ready" ? { ...v, status: "running", quiet: true, progress: null } : v));
    send({ type: "back", reqId: ++reqIdRef.current, to: "undo" });
  }, [send]);

  return { view, run, step, stepBack, stepStop, undo, stop, reset, addItems };
}
