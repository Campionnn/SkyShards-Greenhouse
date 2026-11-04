import type { Scenario } from "../../../simulator";
import type { SweepRun } from "./sweep";

/** One (frequency, seed) run of the simulator's frequency sweep. */
export interface SweepRequest {
  reqId: number;
  scenario: Scenario;
  every: number;
  seed: number;
  cycles: number;
}

export type SweepResponse =
  | { type: "progress"; reqId: number; done: number; total: number }
  | { type: "result"; reqId: number; run: SweepRun };
