/**
 * The simulator's "Watch from nothing" (docs/plans/leaderboard-v3.md §8): find a flow's starting
 * items (its kit, from a borrow run in a Web Worker, as the server does), then build the two
 * scenarios the Ironman board's main number strings together: the frozen builder making the kit
 * from an empty inventory, and the flow itself, strict, starting with exactly the kit. The page
 * runs them as a preview; the user's own flows are never replaced.
 */
import type { Scenario } from "../../simulator/sim/state";
import { builderScenario, kitEmpty, kitOf, type Kit } from "../builder/builder";
import { applyRules, type Submission } from "../rules";
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

/** The flow under strict ironman rules, starting with exactly `kit` (what the server runs after the builder). */
export function flowFromKit(scenario: Scenario, kit: Kit, every: number, seed = randomSeeds(1)[0]): Scenario {
  const ruled = applyRules(scenario, "strict", every, seed);
  return { ...ruled, startingInventory: { ...kit } };
}

/** Both parts of "from nothing" for a scenario; `builder` is null when the flow needs no starting items. */
export async function fromNothingParts(
  scenario: Scenario,
  submission: Submission,
  every: number,
  onProgress?: (fraction: number) => void
): Promise<{ kit: Kit; builder: Scenario | null; flow: Scenario }> {
  const kit = await probeKit(submission, every, 2000, onProgress);
  return { kit, builder: kitEmpty(kit) ? null : builderImport(kit, every), flow: flowFromKit(scenario, kit, every) };
}
