/**
 * "Apply leaderboard rules → from nothing (builder first)" (docs/plans/leaderboard-v3.md §8): find
 * a flow's starting items (its kit, from a borrow run in a Web Worker, as the server does) and
 * build the simulator scenario of the frozen builder that makes them, so an author can watch it.
 */
import type { Scenario } from "../../simulator/sim/state";
import { builderScenario, kitOf, type Kit } from "../builder/builder";
import type { Submission } from "../rules";
import { WALL_MS_BACKSTOP } from "../verify";
import { LocalTestPool, randomSeeds } from "./pool";

/** The builder scenario for a kit, online every `every` cycles, a fresh random seed. */
export function builderImport(kit: Kit, every: number, seed = randomSeeds(1)[0]): Scenario {
  return builderScenario(kit, { tier: "max", every, seed });
}

/** A flow's kit: ceil(startItems) of one borrow run (max stats, `every`, a random seed), in a worker. */
export async function probeKit(submission: Submission, every: number, cycles: number, onProgress?: (fraction: number) => void): Promise<Kit> {
  const pool = new LocalTestPool(1);
  const [o] = await pool.run({ submission, runKind: "ironman", tier: "max", every, cycles, wallMs: WALL_MS_BACKSTOP, kitOnly: true }, randomSeeds(1), { onProgress: (_i, f) => onProgress?.(f) });
  if (!o.ok || !o.result) throw new Error(o.error || "the borrow run failed");
  return kitOf(o.result.startItems);
}
