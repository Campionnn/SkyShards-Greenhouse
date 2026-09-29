import type { GameData, MutationDef } from "../data/types";
import { requiresZeroAdjacent } from "./multiplicity";

/**
 * Mutations that can appear in any pool on a plot, given which kinds stand on
 * it. Coarse on purpose: the exact ring is checked per location.
 *
 * Differences from solver/spawn.py candidate_mutations, both deliberate:
 * - Godseed IS a candidate here. The solver drops it (it only competes for
 *   its own slot there); the simulator rolls every empty cell, and Godseed
 *   eligibility is a per-location effect test anyway.
 * - Returned in data.json order, which is the fixed pool order.
 */
export function candidateMutations(placedKinds: ReadonlySet<string>, data: GameData): MutationDef[] {
  const out: MutationDef[] = [];
  for (const id of data.mutationIds) {
    const m = data.mutations[id];
    if (m.spawnWeight <= 0) continue; // Shellfruit, Jerryflower
    if (m.special === "all_positive_crop_effects") {
      out.push(m);
      continue;
    }
    if (m.special && !requiresZeroAdjacent(m)) continue;
    if (m.requirements.length === 0 && !requiresZeroAdjacent(m)) continue;
    if (m.requirements.every((r) => placedKinds.has(r.crop))) out.push(m);
  }
  return out;
}
