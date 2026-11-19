/// <reference lib="webworker" />
import { createEngine } from "../engine";
import { ScenarioError } from "../flow/validate";
import type { Scenario, SimulationState, TickEventKind, TimedEvent } from "../sim/state";
import type { StopKind, StopPoint } from "../sim/stops";
import { drive } from "./driver";
import type { SessionSnapshot, StopPosition, WorkerRequest, WorkerResponse } from "./protocol";
import { createTimeline, type Timeline } from "./timeline";

// Session worker: owns the simulation state for one scenario; the timeline keeps history for going back.

const engine = createEngine();
let scenario: Scenario | null = null;
let timeline: Timeline | null = null;
let stopRequested = false;
let busy = false;
/**
 * Stepping inside a cycle: the stop shown now, in the cycle that starts at `timeline.current()`
 * (null: at the cycle's start). The timeline only ever holds states between cycles; a stop's state
 * is a replay of that cycle (engine.replayCycle), so stepping never changes a result.
 */
let at: { cycle: number; ordinal: number } | null = null;

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
const snapshot = (s: SimulationState): SessionSnapshot => ({ state: s, report: engine.analyse(s) });

function initialise(reqId: number, next: Scenario) {
  // Stop an in-flight run of the previous session at its next slice.
  if (busy) stopRequested = true;
  at = null;
  const warnings = engine.validate(next).filter((i) => i.level === "warning");
  const init = engine.initState(next);
  scenario = next;
  timeline = createTimeline(engine, init.state);
  post({ type: "ready", reqId, snapshot: snapshot(init.state), events: init.events, warnings, history: timeline.info() });
}

/** Events emitted between the chosen-kind stop before `ordinal` (or the cycle's start) and `ordinal`. */
function stepEvents(stops: StopPoint[], eventsAt: number[], events: TimedEvent[], ordinal: number, kinds: readonly StopKind[], drop?: readonly TickEventKind[]): TimedEvent[] {
  let from = 0;
  for (let i = ordinal - 1; i >= 0; i--) {
    if (kinds.includes(stops[i].kind)) {
      from = eventsAt[i];
      break;
    }
  }
  const out = events.slice(from);
  return drop?.length ? out.filter((e) => !drop.includes(e.kind)) : out;
}

/** Show the stop at `ordinal` of the cycle starting at `base` (the timeline's current state). */
function showStop(reqId: number, tl: Timeline, base: SimulationState, ordinal: number, kinds: readonly StopKind[], drop?: readonly TickEventKind[]) {
  const r = engine.replayCycle(base, (_s, i) => i === ordinal);
  const cap = r.capture!;
  at = { cycle: base.cycle, ordinal };
  const matching = r.stops.map((s, i) => [s, i] as const).filter(([s]) => kinds.includes(s.kind));
  const position: StopPosition = {
    cycle: base.cycle,
    stop: cap.stop,
    ordinal,
    index: matching.filter(([, i]) => i <= ordinal).length,
    count: matching.length,
  };
  post({ type: "stopped", reqId, snapshot: snapshot(cap.state), position, events: stepEvents(r.stops, r.eventsAt, cap.events, ordinal, kinds, drop), history: tl.info() });
}

/** Step to the next / previous stop of one of `kinds` (see the protocol's `stop` request). */
function stepStop(reqId: number, tl: Timeline, dir: "next" | "prev", kinds: StopKind[], drop?: TickEventKind[]) {
  let base = tl.current();
  const here = at && at.cycle === base.cycle ? at.ordinal : -1;
  if (dir === "next") {
    const r = engine.replayCycle(base, (s, i) => i > here && kinds.includes(s.kind));
    if (r.capture) {
      showStop(reqId, tl, base, r.capture.ordinal, kinds, drop);
      return;
    }
    // Past the cycle's last such stop: finish the cycle, exactly like a Step.
    tl.beginRun();
    const done = engine.run(base, 1, { retainEvents: "all" });
    tl.endRun(done.state, done.cyclesRun);
    at = null;
    const events = drop?.length ? done.events.filter((e) => !drop.includes(e.kind)) : done.events;
    // The grid marks show what happened since the stop shown before; the log gets the whole cycle.
    const since = here >= 0 ? stepEvents(r.stops, r.eventsAt, done.events, r.stops.length, kinds, drop) : events;
    post({ type: "result", reqId, snapshot: snapshot(done.state), events, eventCounts: done.eventCounts, cyclesRun: done.cyclesRun, truncated: done.truncated, history: tl.info(), marks: since });
    return;
  }
  // Previous: the chosen-kind stop before this one in the same cycle, else the cycle's start, else
  // (already at a start) the last such stop of the cycle before.
  if (here >= 0) {
    const { stops } = engine.replayCycle(base);
    let prev = -1;
    for (let i = here - 1; i >= 0; i--) if (kinds.includes(stops[i].kind)) {
      prev = i;
      break;
    }
    if (prev >= 0) {
      showStop(reqId, tl, base, prev, kinds, drop);
      return;
    }
    at = null;
    post({ type: "stopped", reqId, snapshot: snapshot(base), position: null, events: [], history: tl.info() });
    return;
  }
  const back = tl.stepBack();
  if (!back) throw new Error("Already at the start");
  base = back;
  const { stops } = engine.replayCycle(base);
  let last = -1;
  for (let i = stops.length - 1; i >= 0; i--) if (kinds.includes(stops[i].kind)) {
    last = i;
    break;
  }
  if (last >= 0) showStop(reqId, tl, base, last, kinds, drop);
  else {
    at = null;
    post({ type: "stopped", reqId, snapshot: snapshot(base), position: null, events: [], history: tl.info() });
  }
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
    if (msg.type === "stepStop") {
      if (busy) throw new Error("A run is in progress");
      stepStop(msg.reqId, tl, msg.dir, msg.kinds, msg.dropKinds);
      return;
    }
    // Everything else works on the states between cycles: a mid-cycle position is left. Back from
    // a mid-cycle position goes to the cycle's start; Step and Run run from there (finishing it).
    const midCycle = at !== null && at.cycle === tl.current().cycle;
    at = null;
    if (msg.type === "back" && msg.to === "cycle" && midCycle) {
      if (busy) throw new Error("Stop the run before going back");
      post({ type: "rewound", reqId: msg.reqId, snapshot: snapshot(tl.current()), history: tl.info(), undone: null });
      return;
    }
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
