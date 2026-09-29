/// <reference lib="webworker" />
import { createEngine } from "../engine";
import { ScenarioError } from "../flow/validate";
import type { Scenario, SimulationState } from "../sim/state";
import { drive } from "./driver";
import type { SessionSnapshot, WorkerRequest, WorkerResponse } from "./protocol";

// The session worker: it owns the simulation state for one scenario. Every
// Step and Run arrives as the same "run" message.

const engine = createEngine();
let scenario: Scenario | null = null;
let state: SimulationState | null = null;
let stopRequested = false;
let busy = false;

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
const snapshot = (s: SimulationState): SessionSnapshot => ({ state: s, report: engine.analyse(s) });

function initialise(reqId: number, next: Scenario) {
  const warnings = engine.validate(next).filter((i) => i.level === "warning");
  const init = engine.initState(next);
  scenario = next;
  state = init.state;
  post({ type: "ready", reqId, snapshot: snapshot(state), events: init.events, warnings });
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
    if (msg.type === "addItems") {
      if (!state) throw new Error("No scenario loaded");
      if (busy) throw new Error("Stop the run before changing the inventory");
      state = engine.addItems(state, msg.items);
      post({ type: "updated", reqId: msg.reqId, snapshot: snapshot(state) });
      return;
    }
    if (msg.type === "run") {
      if (!state) throw new Error("No scenario loaded");
      if (busy) throw new Error("A run is already in progress");
      busy = true;
      stopRequested = false;
      const result = await drive(engine, state, msg.ticks, {
        retainEvents: msg.retainEvents,
        keepLastCycles: msg.keepLastCycles,
        dropKinds: msg.dropKinds,
        shouldStop: () => stopRequested,
        onProgress: (p) => post({ type: "progress", reqId: msg.reqId, ...p }),
      });
      state = result.state;
      busy = false;
      post({
        type: "result",
        reqId: msg.reqId,
        snapshot: snapshot(state),
        events: result.events,
        eventCounts: result.eventCounts,
        cyclesRun: result.cyclesRun,
        truncated: result.truncated,
      });
    }
  } catch (err) {
    busy = false;
    fail("reqId" in msg ? msg.reqId : -1, err);
  }
};
