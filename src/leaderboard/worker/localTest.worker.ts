/// <reference lib="webworker" />
/**
 * Local leaderboard test: simulates one seed of a submission under the rules (verify.ts runOnce,
 * the same code the server's CLI runs) and posts progress and the RunResult.
 */
import { createEngine } from "../../simulator/engine";
import { runOnce } from "../verify";
import type { LocalTestRequest, LocalTestResponse } from "./protocol";

const engine = createEngine();
const post = (m: LocalTestResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (event: MessageEvent<LocalTestRequest>) => {
  const r = event.data;
  let lastPost = 0;
  try {
    const o = runOnce(engine, r.submission, r.runKind, r.tier, r.every, r.seed, r.cycles, {
      wallMs: r.wallMs,
      onProgress: (done, total) => {
        const now = performance.now();
        if (now - lastPost < 150 && done < total) return;
        lastPost = now;
        post({ type: "progress", reqId: r.reqId, done, total });
      },
    });
    post({ type: "result", reqId: r.reqId, ok: o.ok, error: o.error, result: o.result, wallMs: o.wallMs });
  } catch (e) {
    post({ type: "result", reqId: r.reqId, ok: false, error: e instanceof Error ? e.message : String(e), result: null, wallMs: 0 });
  }
};
