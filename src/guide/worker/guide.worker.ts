/**
 * Guide forecast worker: one seed per request. The flow arrives once and is kept, because cloning
 * the whole flows file per seed would dominate the run time.
 */
import { createGuideEnv } from "../project";
import { runOne } from "../forecast";
import type { FlowsFile } from "../flow";
import type { GuideRequest, GuideResponse } from "./protocol";

const guideEnv = createGuideEnv();
let flow: FlowsFile | null = null;

const post = (message: GuideResponse) => (self as unknown as { postMessage: (m: GuideResponse) => void }).postMessage(message);

self.addEventListener("message", (event: MessageEvent<GuideRequest>) => {
  const request = event.data;
  if (request.type === "flow") {
    flow = request.flow;
    return;
  }
  if (!flow) {
    post({ type: "error", reqId: request.reqId, seed: request.seed, message: "The forecast worker has no flow loaded." });
    return;
  }
  try {
    post({ type: "seedDone", reqId: request.reqId, seed: request.seed, timeline: runOne(flow, request.input, request.seed, guideEnv, request.maxCycles) });
  } catch (error) {
    post({ type: "error", reqId: request.reqId, seed: request.seed, message: error instanceof Error ? error.message : String(error) });
  }
});
