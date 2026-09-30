import type { ScenarioIssue } from "../flow/validate";
import type { SustainabilityReport } from "../analysis/sustainability";
import type { RetainEvents, RunSummary, Scenario, SimulationState, TickEventKind, TimedEvent } from "../sim/state";
import type { HistoryInfo, UndoableAction } from "./timeline";

export type { HistoryInfo, UndoableAction } from "./timeline";

// Messages between the UI and the session worker. The worker OWNS the
// SimulationState; the UI only ever holds snapshots of it. Step and Run are
// the same message: run with ticks = 1 or N.

export type WorkerRequest =
  | { type: "init"; reqId: number; scenario: Scenario }
  | { type: "run"; reqId: number; ticks: number; retainEvents: RetainEvents; keepLastCycles?: number; dropKinds?: TickEventKind[] }
  | { type: "stop" }
  /** Add (negative = remove) items in the live run's inventory without restarting. */
  | { type: "addItems"; reqId: number; items: Record<string, number> }
  /** Go back one cycle ("cycle") or take back the last Step / Run / inventory change ("undo"). */
  | { type: "back"; reqId: number; to: "cycle" | "undo" }
  | { type: "reset"; reqId: number };

export interface SessionSnapshot {
  state: SimulationState;
  report: SustainabilityReport;
}

export type WorkerResponse =
  | { type: "ready"; reqId: number; snapshot: SessionSnapshot; events: TimedEvent[]; warnings: ScenarioIssue[]; history: HistoryInfo }
  /** The live state changed without time moving (items added). */
  | { type: "updated"; reqId: number; snapshot: SessionSnapshot; history: HistoryInfo }
  /** The session went back in time; `undone` is the action that was taken back (undo only). */
  | { type: "rewound"; reqId: number; snapshot: SessionSnapshot; history: HistoryInfo; undone: UndoableAction | null }
  | { type: "progress"; reqId: number; cycle: number; done: number; total: number; summary: RunSummary }
  | {
      type: "result";
      reqId: number;
      snapshot: SessionSnapshot;
      events: TimedEvent[];
      eventCounts: Partial<Record<TickEventKind, number>>;
      cyclesRun: number;
      truncated: boolean;
      history: HistoryInfo;
    }
  | { type: "error"; reqId: number; message: string; issues?: ScenarioIssue[] };
