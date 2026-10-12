/**
 * Guide worker protocol. The page sends the flow once, then one request per seed, so a pool of
 * workers can spread the seeds and the forecast can render while the rest is still simulating.
 */
import type { FlowsFile } from "../flow";
import type { GuideInput, RunTimeline } from "../types";

export type GuideRequest =
  | { type: "flow"; flow: FlowsFile }
  | { type: "seed"; reqId: number; input: GuideInput; seed: number; maxCycles?: number };

export type GuideResponse =
  | { type: "seedDone"; reqId: number; seed: number; timeline: RunTimeline }
  | { type: "error"; reqId: number; seed: number; message: string };

/** A stable key for a forecast input, so an identical check-in reuses a cached forecast. */
export function inputKey(input: GuideInput, seeds: number[]): string {
  const plots = Object.keys(input.plots)
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => [id, input.plots[id]]);
  const inventory = Object.entries(input.inventory)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const memory = Object.entries(input.memory?.builtOnce ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([plots, inventory, memory, input.settings.activity, input.settings.playerStats, seeds]);
}
