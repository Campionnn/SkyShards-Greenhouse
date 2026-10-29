/// <reference lib="webworker" />
/**
 * Local leaderboard test: simulates one seed of a submission under the rules, with the same code
 * the server's CLI runs (verify.ts: runIronman for the ironman run kind, runOnce for normal), and
 * posts progress and the results.
 */
import { createEngine } from "../../simulator/engine";
import { runIronman, runOnce } from "../verify";
import type { LocalTestRequest, LocalTestResponse } from "./protocol";

const engine = createEngine();
const post = (m: LocalTestResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (event: MessageEvent<LocalTestRequest>) => {
  const r = event.data;
  let lastPost = 0;
  const onProgress = (done: number, total: number) => {
    const now = performance.now();
    if (now - lastPost < 150 && done < total) return;
    lastPost = now;
    post({ type: "progress", reqId: r.reqId, done, total });
  };
  try {
    if (r.runKind === "ironman" && r.kitOnly) {
      const o = runOnce(engine, r.submission, "borrow", r.tier, r.every, r.seed, r.cycles, { wallMs: r.wallMs, onProgress });
      post({ type: "result", reqId: r.reqId, ok: o.ok, error: o.error, result: o.result, wallMs: o.wallMs });
    } else if (r.runKind === "ironman") {
      const o = runIronman(engine, r.submission, r.tier, r.every, r.seed, r.cycles, { wallMs: r.wallMs, check: r.check === true, onProgress });
      post({ type: "result", reqId: r.reqId, ok: o.ok, error: o.error, result: o.result, fromNothing: o.fromNothing, stitchCheck: o.stitchCheck, wallMs: o.wallMs });
    } else {
      const o = runOnce(engine, r.submission, "normal", r.tier, r.every, r.seed, r.cycles, { wallMs: r.wallMs, onProgress });
      post({ type: "result", reqId: r.reqId, ok: o.ok, error: o.error, result: o.result, wallMs: o.wallMs });
    }
  } catch (e) {
    post({ type: "result", reqId: r.reqId, ok: false, error: e instanceof Error ? e.message : String(e), result: null, wallMs: 0 });
  }
};
