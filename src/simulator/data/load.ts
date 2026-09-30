import { gameDataSchema } from "./schema";
import type { CropDef, GameData, KindDef, MutationDef, Size } from "./types";

/**
 * Every `special` value in data.json and what handles it. An unknown special
 * fails the load: a silently ignored rule produces confidently wrong numbers.
 */
export const KNOWN_SPECIALS: Record<string, string> = {
  requires_zero_adjacent: "spawn/multiplicity (Lonelily: empty 8-way ring)",
  all_positive_crop_effects: "spawn/multiplicity (Godseed: effect superset)",
  explode_turtlellini_with_blastberry: "growth/gates (Shellfruit: Blastberry destruction)",
  grow_the_jerryseed: "never spawns (weight 0; the Jerryseed item is out of scope)",
};

/** Pairs that count as one unique crop (Greenhouse page footnote). */
const MERGED_UNIQUE_GROUPS: string[][] = [
  ["red_mushroom", "brown_mushroom"],
  ["sunflower", "moonflower"],
];

/** Drop items that are not crops but still have a known NPC price. */
export const NON_CROP_DROP_ITEMS = ["seeds"];

export class GameDataError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid game data:\n- ${issues.join("\n- ")}`);
    this.name = "GameDataError";
    this.issues = issues;
  }
}

/** Validate a data.json-shaped object and index it into GameData. */
export function loadGameData(json: unknown): GameData {
  const parsed = gameDataSchema.safeParse(json);
  if (!parsed.success) {
    throw new GameDataError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const raw = parsed.data;
  const issues: string[] = [];

  const crops: Record<string, CropDef> = {};
  for (const [id, c] of Object.entries(raw.crops)) {
    crops[id] = {
      kind: "crop",
      id,
      name: c.name,
      size: c.size as Size,
      ground: c.ground,
      growthStages: c.growth_stages,
      positiveBuffs: c.positive_buffs,
      negativeBuffs: c.negative_buffs,
      drops: c.drops,
      sellPrice: c.sell_price,
    };
  }

  const mutations: Record<string, MutationDef> = {};
  for (const [id, m] of Object.entries(raw.mutations)) {
    if (m.special !== undefined && !(m.special in KNOWN_SPECIALS)) {
      issues.push(`mutations.${id}.special: unknown special "${m.special}"`);
    }
    mutations[id] = {
      kind: "mutation",
      id,
      name: m.name,
      size: m.size as Size,
      ground: m.ground,
      requirements: m.requirements,
      rarity: m.rarity,
      growthStages: m.growth_stages,
      decayDays: m.decay,
      positiveBuffs: m.positive_buffs,
      negativeBuffs: m.negative_buffs,
      requiresWatering: m.requires_watering,
      drops: m.drops,
      spawnWeight: m.spawn_weight,
      special: m.special ?? null,
      harvestInfo: m.harvest_info,
      growingInfo: m.growing_info,
    };
  }

  const effects: GameData["effects"] = {};
  for (const [id, e] of Object.entries(raw.effects)) {
    effects[id] = { id, name: e.name, description: e.description };
  }

  // Cross-references: every id a record points at must exist.
  const allKinds: KindDef[] = [...Object.values(crops), ...Object.values(mutations)];
  for (const k of allKinds) {
    for (const e of [...k.positiveBuffs, ...k.negativeBuffs]) {
      if (!effects[e]) issues.push(`${k.id}: unknown effect "${e}"`);
    }
    for (const item of Object.keys(k.drops)) {
      if (!crops[item] && !NON_CROP_DROP_ITEMS.includes(item)) issues.push(`${k.id}: drop "${item}" has no price source`);
    }
    if (crops[k.id] && mutations[k.id]) issues.push(`${k.id}: id is both a crop and a mutation`);
  }
  for (const m of Object.values(mutations)) {
    for (const r of m.requirements) {
      if (!crops[r.crop] && !mutations[r.crop]) issues.push(`${m.id}: requirement "${r.crop}" does not exist`);
    }
  }
  if (issues.length) throw new GameDataError(issues);

  const effectIds = Object.keys(effects);
  const negativeEffects = [...new Set(allKinds.flatMap((k) => k.negativeBuffs))].sort();
  const improvedOf = Object.fromEntries(
    effectIds.filter((e) => effectIds.includes(`improved_${e}`)).map((e) => [e, `improved_${e}`])
  );
  const specialEffectSets = Object.fromEntries(
    Object.values(mutations)
      .filter((m) => m.special === "all_positive_crop_effects")
      .map((m) => [m.id, [...m.positiveBuffs]])
  );

  // Harvestable crops, with the merged pairs collapsed into one group each.
  const merged = new Set(MERGED_UNIQUE_GROUPS.flat());
  const uniqueCropGroups: string[][] = [
    ...Object.values(crops)
      .filter((c) => c.growthStages !== null && !merged.has(c.id))
      .map((c) => [c.id]),
    ...MERGED_UNIQUE_GROUPS.filter((g) => g.every((id) => crops[id])),
  ];

  return {
    crops,
    mutations,
    effects,
    cropIds: Object.keys(crops),
    mutationIds: Object.keys(mutations),
    negativeEffects,
    improvedOf,
    specialEffectSets,
    uniqueCropGroups,
  };
}

export function kindDef(data: GameData, id: string): KindDef | undefined {
  return data.crops[id] ?? data.mutations[id];
}

/** A base crop that grows and can be harvested (not fire / dead_plant / fermento). */
export function isHarvestableCrop(data: GameData, id: string): boolean {
  const c = data.crops[id];
  return !!c && c.growthStages !== null;
}
