/// <reference lib="webworker" />
import { createEngine } from "../engine";
import { ScenarioError } from "../flow/validate";
import type { Scenario, SimulationState } from "../sim/state";
import { drive } from "./driver";
import type { SessionSnapshot, WorkerRequest, WorkerResponse } from "./protocol";
import { createTimeline, type Timeline } from "./timeline";

// Session worker: owns the simulation state for one scenario; the timeline keeps history for going back.

const engine = createEngine();
let scenario: Scenario | null = null;
let timeline: Timeline | null = null;
let stopRequested = false;
let busy = false;

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
const snapshot = (s: SimulationState): SessionSnapshot => ({ state: s, report: engine.analyse(s) });

function initialise(reqId: number, next: Scenario) {
  // Stop an in-flight run of the previous session at its next slice.
  if (busy) stopRequested = true;
  const warnings = engine.validate(next).filter((i) => i.level === "warning");
  const init = engine.initState(next);
  scenario = next;
  timeline = createTimeline(engine, init.state);
  post({ type: "ready", reqId, snapshot: snapshot(init.state), events: init.events, warnings, history: timeline.info() });
}

function fail(reqId: number, err: unknown) {
  post({
    type: "error",
    reqId,
    message: err instanceof Error ? err.message : String(err),
    issues: err instanceof ScenarioError ? err.issues : undefined,
  });
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "stop") {
    stopRequested = true;
    return;
  }
  try {
    if (msg.type === "init") {
      initialise(msg.reqId, msg.scenario);
      return;
    }
    if (msg.type === "reset") {
      if (!scenario) throw new Error("No scenario loaded");
      initialise(msg.reqId, scenario);
      return;
    }
    if (!timeline) throw new Error("No scenario loaded");
    const tl = timeline;
    if (msg.type === "addItems") {
      if (busy) throw new Error("Stop the run before changing the inventory");
      const next = engine.addItems(tl.current(), msg.items);
      tl.itemsChanged(next, msg.items);
      post({ type: "updated", reqId: msg.reqId, snapshot: snapshot(next), history: tl.info() });
      return;
    }
    if (msg.type === "back") {
      if (busy) throw new Error("Stop the run before going back");
      let state: SimulationState | null;
      let undone = null;
      if (msg.to === "cycle") state = tl.stepBack();
      else {
        const r = tl.undo();
        state = r?.state ?? null;
        undone = r?.action ?? null;
      }
      if (!state) throw new Error(msg.to === "cycle" ? "Already at the start" : "Nothing to undo");
      post({ type: "rewound", reqId: msg.reqId, snapshot: snapshot(state), history: tl.info(), undone });
      return;
    }
    if (msg.type === "run") {
      if (busy) throw new Error("A run is already in progress");
      busy = true;
      stopRequested = false;
      tl.beginRun();
      let result;
      try {
        result = await drive(engine, tl.current(), msg.ticks, {
          retainEvents: msg.retainEvents,
          keepLastCycles: msg.keepLastCycles,
          dropKinds: msg.dropKinds,
          shouldStop: () => stopRequested,
          onProgress: (p) => post({ type: "progress", reqId: msg.reqId, ...p }),
          checkpoints: { every: tl.checkpointEvery, save: tl.checkpoint },
        });
      } finally {
        busy = false;
      }
      // Discard if a new scenario arrived during the run.
      if (timeline !== tl) return;
      tl.endRun(result.state, result.cyclesRun);
      post({
        type: "result",
        reqId: msg.reqId,
        snapshot: snapshot(result.state),
        events: result.events,
        eventCounts: result.eventCounts,
        cyclesRun: result.cyclesRun,
        truncated: result.truncated,
        history: tl.info(),
      });
    }
  } catch (err) {
    busy = false;
    fail("reqId" in msg ? msg.reqId : -1, err);
  }
};
