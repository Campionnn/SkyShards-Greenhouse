import type { ScenarioIssue } from "../flow/validate";
import type { SustainabilityReport } from "../analysis/sustainability";
import type { RetainEvents, RunSummary, Scenario, SimulationState, TickEventKind, TimedEvent } from "../sim/state";
import type { StopKind, StopPoint } from "../sim/stops";
import type { HistoryInfo, UndoableAction } from "./timeline";

export type { HistoryInfo, UndoableAction } from "./timeline";

// UI <-> session worker messages. The worker owns the SimulationState; the UI
// holds snapshots. Step and Run are both "run" (ticks = 1 or N).

export type WorkerRequest =
  | { type: "init"; reqId: number; scenario: Scenario }
  | { type: "run"; reqId: number; ticks: number; retainEvents: RetainEvents; keepLastCycles?: number; dropKinds?: TickEventKind[] }
  | { type: "stop" }
  /** Add (negative = remove) inventory items without restarting. */
  | { type: "addItems"; reqId: number; items: Record<string, number> }
  /** Go back one cycle ("cycle") or take back the last Step / Run / inventory change ("undo"). */
  | { type: "back"; reqId: number; to: "cycle" | "undo" }
  | { type: "reset"; reqId: number }
  /**
   * Step inside a cycle: to the next (or previous) stop point of one of `kinds` (sim/stops.ts).
   * Next past the cycle's last such stop finishes the cycle (a `result`, like a Step). Previous
   * before the first goes back to the cycle's start, and from there into the previous cycle.
   */
  | { type: "stepStop"; reqId: number; dir: "next" | "prev"; kinds: StopKind[]; dropKinds?: TickEventKind[] };

export interface SessionSnapshot {
  state: SimulationState;
  report: SustainabilityReport;
}

/** Where a step inside a cycle landed. */
export interface StopPosition {
  /** The cycle being stepped through (its clock has not moved yet). */
  cycle: number;
  stop: StopPoint;
  /** Position among every stop of the cycle. */
  ordinal: number;
  /** Position among the cycle's stops of the chosen kinds (1-based) and how many there are. */
  index: number;
  count: number;
}

export type WorkerResponse =
  | { type: "ready"; reqId: number; snapshot: SessionSnapshot; events: TimedEvent[]; warnings: ScenarioIssue[]; history: HistoryInfo }
  /** State changed without time moving (items added). */
  | { type: "updated"; reqId: number; snapshot: SessionSnapshot; history: HistoryInfo }
  /** Went back in time; `undone` is the undone action (undo only). */
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
      /** A step inside a cycle that finished it: the events since the stop shown before (grid marks). */
      marks?: TimedEvent[];
    }
  | { type: "error"; reqId: number; message: string; issues?: ScenarioIssue[] }
  /**
   * A step inside a cycle. `position` null: at a cycle's start (between cycles, the timeline's own
   * state). `events`: what happened since the position shown before (for the grid marks).
   */
  | { type: "stopped"; reqId: number; snapshot: SessionSnapshot; position: StopPosition | null; events: TimedEvent[]; history: HistoryInfo };
