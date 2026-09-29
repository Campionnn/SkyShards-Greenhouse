import { useCallback, useEffect, useRef, useState } from "react";
import type { RunSummary, Scenario, ScenarioIssue, TickEventKind, TimedEvent } from "../simulator";
import type { SessionSnapshot, WorkerRequest, WorkerResponse } from "../simulator/worker/protocol";

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
  /** Responses to requests older than the latest init belong to a previous scenario. */
  const epochRef = useRef(0);
  const [view, setView] = useState<SimulationView>(initialView);

  useEffect(() => {
    const worker = new Worker(new URL("../simulator/worker/engine.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.reqId < epochRef.current) return;
      switch (msg.type) {
        case "ready":
          setView({
            ...initialView,
            status: "ready",
            snapshot: msg.snapshot,
            // Setup lays every plot out; that shows on the grids, not as a hundred log lines.
            lastCycleEvents: [],
            log: [],
            warnings: msg.warnings,
          });
          break;
        case "updated":
          setView((v) => ({ ...v, snapshot: msg.snapshot, error: null }));
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
              lastCycleEvents: msg.events.filter((e) => e.cycle === cycle - 1),
              log: trimLog([...v.log, ...msg.events], cycle),
              progress: null,
              lastCall: { cyclesRun: msg.cyclesRun, truncated: msg.truncated },
              error: null,
            };
          });
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
      if (ticks < 1) return;
      setView((v) => (v.status === "ready" ? { ...v, status: "running", progress: { done: 0, total: ticks, summary: null } } : v));
      send({ type: "run", reqId: ++reqIdRef.current, ticks, retainEvents: "all", keepLastCycles: LOG_CYCLES, dropKinds: NOISY });
    },
    [send]
  );

  const step = useCallback(() => run(1), [run]);
  const stop = useCallback(() => send({ type: "stop" }), [send]);
  const reset = useCallback(() => {
    const reqId = ++reqIdRef.current;
    epochRef.current = reqId;
    setView((v) => ({ ...v, status: "loading" }));
    send({ type: "reset", reqId });
  }, [send]);

  /** Add (negative = remove) items in the live run's inventory; the run keeps its cycle and history. */
  const addItems = useCallback((items: Record<string, number>) => send({ type: "addItems", reqId: ++reqIdRef.current, items }), [send]);

  return { view, run, step, stop, reset, addItems };
}
