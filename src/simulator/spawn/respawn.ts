import type { GameData, MutationId } from "../data/types";
import type { EffectSimulation } from "../../utilities/effectSimulation";
import { buildOccupancy } from "../sim/plants";
import type { PlantState, PlotState } from "../sim/state";
import { candidateMutations } from "./candidates";
import { locationOpenFor, ringCounts, type RingCounts } from "./eligibility";
import { effectiveWeight, isAllPositiveSpecial } from "./multiplicity";
import { applyMutationChanceBonus, spawnProbability, type SpawnPool } from "./pool";

/**
 * Chance per spawn roll that `mutationId` spawns at `plant`'s anchor once the
 * plant is gone, with everything else as it stands now. Same pool as
 * `phaseSpawn` (sim/tick.ts) and the Sanity Check: candidates from the kinds on
 * the plot, the slot's target, ring and ground checks, Bioanalysis, the floor,
 * spawn priority (`planPool`).
 * Godseed eligibility uses `effects` (the cycle's effect simulation; null =
 * not eligible). Read-only: draws no RNG, writes nothing.
 */
export function respawnChance(
  plot: PlotState,
  plant: PlantState,
  mutationId: MutationId,
  data: GameData,
  effects: EffectSimulation | null,
  mutationChanceBonus: number
): number {
  const { row, col } = plant;
  const occ = buildOccupancy(plot);
  for (let i = 0; i < occ.length; i++) if (occ[i] === plant) occ[i] = null;

  const kinds = new Set<string>();
  for (const q of plot.plants) if (q !== plant) kinds.add(q.kindId);
  const candidates = candidateMutations(kinds, data);
  const slot = plot.slots.find((s) => s.row === row && s.col === col);
  const target = slot ? data.mutations[slot.mutationId] : undefined;
  const poolMuts = target && !candidates.includes(target) ? [...candidates, target] : candidates;

  const ringBySize = new Map<number, RingCounts>();
  const pool: SpawnPool = { ids: [], weights: [] };
  for (const m of poolMuts) {
    if (!locationOpenFor(plot, occ, row, col, m)) continue;
    let ring = ringBySize.get(m.size);
    if (!ring) {
      ring = ringCounts(occ, row, col, m.size);
      ringBySize.set(m.size, ring);
    }
    const special = isAllPositiveSpecial(m) ? !!effects?.isSpecialEligible(m.id, [row, col], m.size) : undefined;
    const w = effectiveWeight(m, ring, special);
    if (w > 0) {
      pool.ids.push(m.id);
      pool.weights.push(w);
    }
  }
  // Priority (Godseed rolls first, Zombud shuts others out) as in `rollPool`.
  return spawnProbability(applyMutationChanceBonus(pool, mutationChanceBonus), mutationId);
}
