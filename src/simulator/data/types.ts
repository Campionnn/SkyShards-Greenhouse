/** Crop or mutation id (`wheat`, `chorus_fruit`, ...). */
export type KindId = string;
/** Anything that can sit in the inventory: crops, mutation items, seeds, rare drops. */
export type ItemId = string;
export type EffectId = string;
export type MutationId = string;
export type Size = 1 | 2 | 3;

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface CropDef {
  kind: "crop";
  id: KindId;
  name: string;
  size: Size;
  ground: string;
  /** null for fire / dead_plant / fermento: they never grow and cannot be harvested. */
  growthStages: number | null;
  positiveBuffs: EffectId[];
  negativeBuffs: EffectId[];
  drops: Record<ItemId, number>;
  sellPrice: number;
}

export interface MutationDef {
  kind: "mutation";
  id: MutationId;
  name: string;
  size: Size;
  ground: string;
  requirements: { crop: KindId; count: number }[];
  rarity: Rarity;
  /** 0 = fully grown the cycle after it spawns. */
  growthStages: number;
  /** DAYS (not hours - the backend docstring is wrong). 0 = never decays. */
  decayDays: number;
  positiveBuffs: EffectId[];
  negativeBuffs: EffectId[];
  requiresWatering: boolean;
  /** The base-crop bundle only; the mutation item itself is added at harvest. */
  drops: Record<ItemId, number>;
  /** 0 = never spawns from the weighted roll. */
  spawnWeight: number;
  special: string | null;
  harvestInfo?: string;
  growingInfo?: string;
}

export type KindDef = CropDef | MutationDef;

export interface EffectDef {
  id: EffectId;
  name: string;
  description: string;
}

/** Validated, indexed game data. Immutable; derived tables are computed at load, never hardcoded. */
export interface GameData {
  crops: Record<KindId, CropDef>;
  mutations: Record<MutationId, MutationDef>;
  effects: Record<EffectId, EffectDef>;
  /** data.json order - the fixed iteration order used wherever order is observable. */
  cropIds: KindId[];
  mutationIds: MutationId[];
  negativeEffects: EffectId[];
  /** base -> improved twin (harvest_boost -> improved_harvest_boost). */
  improvedOf: Record<EffectId, EffectId>;
  /** Mutations whose eligibility is "holds all of these effects" (godseed). */
  specialEffectSets: Record<MutationId, EffectId[]>;
  /** The 12 unique-crop groups (sun/moonflower and the two mushrooms merged). */
  uniqueCropGroups: KindId[][];
}
