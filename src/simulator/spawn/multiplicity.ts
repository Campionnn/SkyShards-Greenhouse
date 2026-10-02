import type { SimConfig } from "../config";
import type { MutationDef } from "../data/types";
import type { RingCounts } from "./eligibility";

/**
 * Mutations whose weight scales with extra matching cells in the ceiling
 * model. Ashwreath only (solver/spawn.py SCALING_QUIRKS): fire is not a real
 * crop, so only adjacent nether wart moves the weight, one wart at a time.
 */
export const SCALING_QUIRKS: Record<string, { scalingCrop: string; fullWeightCount: number }> = {
  ashwreath: { scalingCrop: "nether_wart", fullWeightCount: 4 },
};

/** Not a crop for the support multiplier ("Since Fire isn't a crop..."). */
const NON_SUPPORTING = new Set(["fire"]);

export const requiresZeroAdjacent = (m: MutationDef) => m.special === "requires_zero_adjacent";
export const isAllPositiveSpecial = (m: MutationDef) => m.special === "all_positive_crop_effects";

function scalingRequirement(m: MutationDef): [string, number] | null {
  const q = SCALING_QUIRKS[m.id];
  if (!q) return null;
  const req = m.requirements.find((r) => r.crop === q.scalingCrop);
  return req ? [req.crop, req.count] : null;
}

export function fullWeightMultiplicity(m: MutationDef): number {
  const q = SCALING_QUIRKS[m.id];
  const scaling = scalingRequirement(m);
  if (!q || !scaling) return 1;
  return q.fullWeightCount - scaling[1] + 1;
}

/**
 * k = how strongly this location offers the mutation; k = 1 is "minimally
 * eligible", 0 is ineligible. Check order mirrors solver/spawn.py:220-257.
 * `ring` is the 8-way ring around the footprint (spawn/eligibility.ts
 * `ringCounts`): requirement counts in CELLS, with dried-out plants left
 * out, plus whether anything at all stands there.
 */
export function multiplicity(m: MutationDef, ring: RingCounts, specialEligible?: boolean): number {
  const { counts } = ring;
  // 1. Zero-adjacent rule (Lonelily). It reads plain occupancy, not the
  //    requirement counts: a dried-out neighbour is still physically there.
  if (requiresZeroAdjacent(m)) {
    return ring.ringOccupied ? 0 : 1;
  }
  // 2. All-positive-effects rule (Godseed), decided by the effect simulation
  if (isAllPositiveSpecial(m)) return specialEligible ? 1 : 0;
  // 3. No requirements and no rule above: an unmodelled special never spawns
  if (m.requirements.length === 0) return 0;
  // 4. Every requirement met at least once
  for (const r of m.requirements) {
    if ((counts[r.crop] ?? 0) < r.count) return 0;
  }
  // 5. Scaling quirk
  const scaling = scalingRequirement(m);
  if (!scaling) return 1;
  const [crop, baseCount] = scaling;
  const k = (counts[crop] ?? 0) - baseCount + 1;
  return Math.max(1, Math.min(k, fullWeightMultiplicity(m)));
}

/** The weight this location offers, under the configured weight model. */
export function effectiveWeight(
  m: MutationDef,
  ring: RingCounts,
  config: Pick<SimConfig, "weightModel" | "supportPerCell" | "supportCap">,
  specialEligible?: boolean
): number {
  const { counts } = ring;
  const k = multiplicity(m, ring, specialEligible);
  if (k <= 0 || m.spawnWeight <= 0) return 0;

  if (config.weightModel === "support") {
    // Wiki/staff model: each matching adjacent requirement cell adds support, capped.
    // Mutations without crop requirements (Lonelily, Godseed) are fully supported.
    if (m.requirements.length === 0) return m.spawnWeight;
    let matching = 0;
    for (const r of m.requirements) {
      if (!NON_SUPPORTING.has(r.crop)) matching += counts[r.crop] ?? 0;
    }
    return m.spawnWeight * Math.min(config.supportCap, config.supportPerCell * matching);
  }

  // Ceiling model: the listed weight is reached the moment requirements hold.
  const q = SCALING_QUIRKS[m.id];
  const scaling = scalingRequirement(m);
  if (q && scaling) {
    return Math.min(m.spawnWeight, (m.spawnWeight * (scaling[1] + k - 1)) / q.fullWeightCount);
  }
  return m.spawnWeight;
}
