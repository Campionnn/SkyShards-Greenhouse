/// <reference lib="webworker" />
/**
 * The flow page's "Test with your stats": simulates seeds of a leaderboard flow under the rules with
 * the viewer's own stats (statsTest.ts), one request after another, posting progress and outcomes.
 */
import { createEngine } from "../../simulator/engine";
import { runStatsSeed, type StatsTestOutcome, type StatsTestRequest } from "../statsTest";

export type StatsTestResponse = { type: "progress"; reqId: number; done: number; total: number } | { type: "result"; reqId: number; outcome: StatsTestOutcome };

const engine = createEngine();
const post = (m: StatsTestResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (event: MessageEvent<StatsTestRequest>) => {
  const { reqId, ...r } = event.data;
  let lastPost = 0;
  try {
    const outcome = runStatsSeed(engine, r, (done, total) => {
      const now = performance.now();
      if (now - lastPost < 200 && done < total) return;
      lastPost = now;
      post({ type: "progress", reqId, done, total });
    });
    post({ type: "result", reqId, outcome });
  } catch (e) {
    post({ type: "result", reqId, outcome: { every: r.every, seed: r.seed, ok: false, error: e instanceof Error ? e.message : String(e), result: null, wallMs: 0 } });
  }
};
