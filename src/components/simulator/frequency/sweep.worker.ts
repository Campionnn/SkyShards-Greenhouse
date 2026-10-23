/// <reference lib="webworker" />
/**
 * The frequency sweep's worker: simulates one (frequency, seed) run of the user's scenario and
 * posts progress and the run's summary.
 */
import { createEngine } from "../../../simulator/engine";
import type { SweepRequest, SweepResponse } from "./protocol";
import { runSweepCell } from "./sweep";

const engine = createEngine();
const post = (m: SweepResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (event: MessageEvent<SweepRequest>) => {
  const r = event.data;
  let lastPost = 0;
  try {
    const run = runSweepCell(engine, r.scenario, r.every, r.seed, r.cycles, (done, total) => {
      const now = performance.now();
      if (now - lastPost < 150 && done < total) return;
      lastPost = now;
      post({ type: "progress", reqId: r.reqId, done, total });
    });
    post({ type: "result", reqId: r.reqId, run });
  } catch (e) {
    post({
      type: "result",
      reqId: r.reqId,
      run: { every: r.every, seed: r.seed, ok: false, error: e instanceof Error ? e.message : String(e), summary: null },
    });
  }
};
