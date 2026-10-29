import type { RunResult } from "../result";
import type { RunKind, Submission } from "../rules";
import type { TierId } from "../tiers";
import type { StitchCheck } from "../verify";

/** The submit dialog's local test with random seeds: one seed of one run kind per request. */
export interface LocalTestRequest {
  reqId: number;
  submission: Submission;
  /** ironman: the borrow run, the builder and the "from nothing" timeline (verify.ts runIronman); normal: one normal run. */
  runKind: RunKind;
  tier: TierId;
  every: number;
  seed: number;
  /** The author's length; the run goes on through the end window (rules.ts endCycles). */
  cycles: number;
  /** Wall-clock cap (the server's backstop). */
  wallMs: number;
  /** Ironman: a sampled stitch-check run (the server checks seed 0 at its lowest and highest frequency). */
  check?: boolean;
  /** Ironman: only the borrow run (its `startItems` give the kit; "Apply leaderboard rules → from nothing"). */
  kitOnly?: boolean;
}

export type LocalTestResponse =
  | { type: "progress"; reqId: number; done: number; total: number }
  | {
      type: "result";
      reqId: number;
      ok: boolean;
      error: string | null;
      /** Ironman: the borrow run ("with the starting items"); normal: the normal run. */
      result: RunResult | null;
      /** Ironman only: the "from nothing" timeline. */
      fromNothing?: RunResult | null;
      stitchCheck?: StitchCheck;
      wallMs: number;
    };
