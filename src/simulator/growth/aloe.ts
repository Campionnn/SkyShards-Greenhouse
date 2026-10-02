/**
 * All-in Aloe (wiki All-in_Aloe/Table). Harvestable at any stage; the stage
 * sets the fragment multiplier (9 fragments = 1 All-in Aloe), the crop bundle
 * is fixed. Each new stage rolls its reset chance (back to stage 1). Stage 14
 * maximises expected drops (9.37). Never decays.
 */

export const ALOE_FRAGMENT = "all_in_aloe_fragment";
export const FRAGMENTS_PER_ALOE = 9;

/** Index = growth stage (0..27). Stage 0 (just spawned) behaves like stage 1. */
export const ALOE_TABLE: ReadonlyArray<{ multiplier: number; resetChance: number }> = [
  { multiplier: 0, resetChance: 0 }, // 0
  { multiplier: 0, resetChance: 0 }, // 1
  { multiplier: 0, resetChance: 0 },
  { multiplier: 0, resetChance: 0 },
  { multiplier: 1, resetChance: 0.03 }, // 4
  { multiplier: 2, resetChance: 0.06 },
  { multiplier: 3, resetChance: 0.09 },
  { multiplier: 4, resetChance: 0.12 },
  { multiplier: 6, resetChance: 0.15 },
  { multiplier: 9, resetChance: 0.18 },
  { multiplier: 13, resetChance: 0.21 }, // 10
  { multiplier: 20, resetChance: 0.24 },
  { multiplier: 28, resetChance: 0.27 },
  { multiplier: 41, resetChance: 0.3 },
  { multiplier: 60, resetChance: 0.33 }, // 14
  { multiplier: 86, resetChance: 0.36 },
  { multiplier: 125, resetChance: 0.39 },
  { multiplier: 182, resetChance: 0.42 },
  { multiplier: 263, resetChance: 0.45 },
  { multiplier: 382, resetChance: 0.48 },
  { multiplier: 554, resetChance: 0.51 }, // 20
  { multiplier: 803, resetChance: 0.54 },
  { multiplier: 1164, resetChance: 0.57 },
  { multiplier: 1688, resetChance: 0.6 },
  { multiplier: 2448, resetChance: 0.63 },
  { multiplier: 3549, resetChance: 0.66 },
  { multiplier: 5146, resetChance: 0.69 },
  { multiplier: 7462, resetChance: 0.72 }, // 27
];

export const ALOE_OPTIMAL_STAGE = 14;

export function aloeRow(stage: number) {
  return ALOE_TABLE[Math.max(0, Math.min(ALOE_TABLE.length - 1, Math.floor(stage)))];
}

/** Harvest at `stage`, with every 9 fragments converted to one All-in Aloe. */
export function aloeHarvestItems(stage: number): { aloes: number; fragments: number } {
  const total = aloeRow(stage).multiplier;
  return { aloes: Math.floor(total / FRAGMENTS_PER_ALOE), fragments: total % FRAGMENTS_PER_ALOE };
}
