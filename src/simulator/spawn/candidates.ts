import type { GameData, MutationDef } from "../data/types";
import { requiresZeroAdjacent } from "./multiplicity";

/**
 * Coarse per-plot candidates from the kinds standing on it; rings are checked
 * per location. Unlike solver/spawn.py, Godseed is included (eligibility is a
 * per-location effect test). Returned in data.json order (the pool order).
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
