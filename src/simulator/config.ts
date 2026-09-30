/**
 * Every tunable or unpublished value the simulator uses, in one place.
 *
 * The config is part of the scenario (scenario.settings.config), so a run is
 * reproducible from its input alone. CONFIG_META drives the Advanced panel:
 * everything is user-editable, grouped by how well it is sourced. References
 * point at SkyShards-API/docs/greenhouse/OPEN_QUESTIONS.md.
 */

export type WeightModel = "ceiling" | "support";
export type SpawnCells = "allEmpty" | "slotsOnly";
export type ChorusTeleport = "emptyOnly" | "anyCell";

export interface SimConfig {
  // ---- Verified ----
  /** Spawn pool denominator floor: max(blankFillTo, Σweights). */
  blankFillTo: number;
  /** Water level at which a plant dies (Dead Plant page). */
  deathWater: number;
  waterLossMin: number;
  waterLossMax: number;
  /** Growth stage baseline, 4 h. */
  stageBaselineSeconds: number;
  /** Base-crop decay timer (added 2026-08-20). */
  baseCropDecayHours: number;

  // ---- Unpublished: reasoned defaults ----
  maxWater: number;
  /** Chance a stage is skipped while water < 0 (Q9). */
  negativeWaterSkipChance: number;
  /** Whole life of a natural spawn, in cycles from the tick it spawns. 0 = use its own decay timer (Q16b). */
  harvestWindowCycles: number;
  /** Per-mutation decay overrides in DAYS (Q7). Empty = data.json values. */
  decayDaysOverrides: Record<string, number>;
  /** Do placed fire / fermento / dead_plant decay? (they have no growth stages) */
  nullStageKindsDecay: boolean;
  /** Chance per tick that a Devourer grows a root into a neighbouring cell (40%, staff-confirmed). */
  devourerRootChance: number;
  /** Chance per tick that each root spreads another root. */
  rootSpreadChance: number;
  chorusTeleportTargets: ChorusTeleport;
  /** Water a Soggybud draws from each neighbouring crop that has water, per tick. */
  soggybudWaterPerNeighbour: number;
  /** Soggybud stage = floor(water / this). */
  soggybudWaterPerStage: number;
  bountyRollsPerHarvest: number;
  /** NPC price overrides by item id. Missing = the wiki NPC sell price (economy/prices.ts). */
  rareDropValues: Record<string, number>;
  /** Model the wiki-reported bug: no Cropie/Squash from Greenhouse crops in Fermento or Helianthus Armor. */
  armorRareCropBug: boolean;
  /** Cap Overbloom-boosted Rare Crop chances at 100% (one item per roll) instead of guaranteed + fractional extra. */
  capRareCropChance: boolean;
  fleshtrapInitialHunger: number;
  fleshtrapHungerPerStage: number;
  fleshtrapFeedHunger: number;
  /** Stage the player harvests All-in Aloe at (it can be harvested at any stage; 14 is optimal). */
  aloeHarvestStage: number;
  magicJellybeanMultiplierCap: number;
  /** Assume the PlantBoy / Stoplight / Phantomleaf minigames succeed. */
  perfectPlay: boolean;
  /** Failure chance per minigame harvest when perfectPlay is off. */
  minigameFailChance: number;

  // ---- Model switches ----
  /** 'ceiling' = repo model (weight reached once requirements hold); 'support' = wiki multiplier (Q4). */
  weightModel: WeightModel;
  supportPerCell: number;
  supportCap: number;
  /** Which empty cells roll for a spawn each cycle. */
  spawnCells: SpawnCells;
  /** Stage change keeps a plant when the new layout has the same kind at the same anchor. */
  keepIdenticalOnStageChange: boolean;
  /**
   * Hybrid rotations: a natural spawn standing where a layout places the same
   * mutation (same anchor) is kept and used as that input - growing or fully
   * grown - instead of being broken and re-placed from inventory.
   */
  spawnsFillLayoutInputs: boolean;
  /** Fixed plot iteration order; plots contend for the shared inventory in this order. */
  plotOrder: number[];
}

export const DEFAULT_CONFIG: SimConfig = {
  blankFillTo: 100,
  deathWater: -100,
  waterLossMin: 2,
  waterLossMax: 3,
  stageBaselineSeconds: 14400,
  baseCropDecayHours: 72,

  maxWater: 100,
  negativeWaterSkipChance: 0.5,
  harvestWindowCycles: 0,
  decayDaysOverrides: {},
  nullStageKindsDecay: false,
  devourerRootChance: 0.4,
  rootSpreadChance: 0.4,
  chorusTeleportTargets: "emptyOnly",
  soggybudWaterPerNeighbour: 2,
  soggybudWaterPerStage: 10,
  bountyRollsPerHarvest: 1,
  rareDropValues: {},
  armorRareCropBug: false,
  capRareCropChance: false,
  fleshtrapInitialHunger: 0,
  fleshtrapHungerPerStage: 1,
  fleshtrapFeedHunger: 6,
  aloeHarvestStage: 14,
  magicJellybeanMultiplierCap: 10,
  perfectPlay: true,
  minigameFailChance: 0,

  weightModel: "ceiling",
  supportPerCell: 0.25,
  supportCap: 1,
  spawnCells: "allEmpty",
  keepIdenticalOnStageChange: true,
  spawnsFillLayoutInputs: true,
  plotOrder: [1, 2, 3],
};

export type ConfigGroup = "verified" | "unpublished" | "model";

type ScalarKey = {
  [K in keyof SimConfig]: SimConfig[K] extends number | boolean | string ? K : never;
}[keyof SimConfig];

export interface ConfigMeta {
  key: ScalarKey;
  label: string;
  group: ConfigGroup;
  description: string;
  /** OPEN_QUESTIONS.md entry, if any. */
  ref?: string;
  input: { type: "number"; min?: number; max?: number; step?: number } | { type: "boolean" } | { type: "select"; options: string[] };
}

export const CONFIG_META: ConfigMeta[] = [
  { key: "blankFillTo", label: "Spawn pool floor", group: "verified", input: { type: "number", min: 1 }, description: "Pool denominator is max(floor, sum of weights); the remainder is the blank." },
  { key: "deathWater", label: "Death water level", group: "verified", ref: "Q3", input: { type: "number", max: 0 }, description: "A plant dies at or below this water level." },
  { key: "waterLossMin", label: "Water loss min", group: "verified", input: { type: "number", min: 0 }, description: "Minimum water lost per growth stage, before retain/drain." },
  { key: "waterLossMax", label: "Water loss max", group: "verified", input: { type: "number", min: 0 }, description: "Maximum water lost per growth stage, before retain/drain." },
  { key: "stageBaselineSeconds", label: "Stage baseline (s)", group: "verified", ref: "Q2", input: { type: "number", min: 1 }, description: "Growth stage length before speed bonuses (4 h)." },
  { key: "baseCropDecayHours", label: "Base crop decay (h)", group: "verified", input: { type: "number", min: 0 }, description: "Base crops decay this long after planting. 0 = never." },

  { key: "maxWater", label: "Max water", group: "unpublished", ref: "Q3", input: { type: "number", min: 0 }, description: "Water level after watering." },
  { key: "negativeWaterSkipChance", label: "Negative-water skip chance", group: "unpublished", ref: "Q9", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Chance a stage is skipped while water is below 0." },
  { key: "harvestWindowCycles", label: "Spawn lifetime (cycles)", group: "unpublished", ref: "Q16", input: { type: "number", min: 0 }, description: "How long a natural spawn lives, in cycles from the tick it spawns (growth included). 0 = its own decay timer." },
  { key: "nullStageKindsDecay", label: "Fire/fermento/dead plant decay", group: "unpublished", input: { type: "boolean" }, description: "Placed fire, fermento and dead plants decay on the base-crop timer." },
  { key: "devourerRootChance", label: "Devourer root chance", group: "verified", ref: "Q6", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Chance per tick a Devourer grows a root into one of its 8 neighbouring cells, destroying what is there (40% staff-confirmed)." },
  { key: "rootSpreadChance", label: "Root spread chance", group: "unpublished", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Chance per tick each root spreads another root into a neighbouring cell." },
  { key: "soggybudWaterPerNeighbour", label: "Soggybud water per neighbour", group: "unpublished", input: { type: "number", min: 0 }, description: "Water a Soggybud takes each tick from each neighbouring crop that has water (never from another Soggybud)." },
  { key: "soggybudWaterPerStage", label: "Soggybud water per stage", group: "unpublished", input: { type: "number", min: 1 }, description: "Soggybud's growth stage is floor(water / this)." },
  { key: "chorusTeleportTargets", label: "Chorus teleport targets", group: "unpublished", ref: "Q11", input: { type: "select", options: ["emptyOnly", "anyCell"] }, description: "anyCell lets it land on (and destroy) a plant." },
  { key: "bountyRollsPerHarvest", label: "Harvest Bounty rolls", group: "unpublished", input: { type: "number", min: 0 }, description: "Bounty rolls per harvest of a plant holding Bonus Drops." },
  { key: "fleshtrapInitialHunger", label: "Fleshtrap initial hunger", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger a Fleshtrap spawns with." },
  { key: "fleshtrapHungerPerStage", label: "Fleshtrap hunger per stage", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger used per stage grown." },
  { key: "fleshtrapFeedHunger", label: "Fleshtrap feed amount", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger added per feeding (enchanted cooked meat = 6)." },
  { key: "aloeHarvestStage", label: "All-in Aloe harvest stage", group: "unpublished", input: { type: "number", min: 1, max: 27 }, description: "Stage the player harvests All-in Aloe at. It resets to stage 1 with a rising chance on each new stage; 14 maximises expected drops." },
  { key: "magicJellybeanMultiplierCap", label: "Jellybean multiplier cap", group: "unpublished", input: { type: "number", min: 1 }, description: "Magic Jellybean item multiplier: +1 per 12 stages from 12, up to this cap." },
  { key: "perfectPlay", label: "Perfect minigames", group: "unpublished", input: { type: "boolean" }, description: "PlantBoy / Stoplight / Phantomleaf minigames always succeed." },
  { key: "minigameFailChance", label: "Minigame fail chance", group: "unpublished", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Used when perfect minigames is off." },

  { key: "weightModel", label: "Spawn weight model", group: "model", ref: "Q4", input: { type: "select", options: ["ceiling", "support"] }, description: "ceiling: full weight once requirements hold (repo). support: weight x 25% per matching adjacent cell (wiki)." },
  { key: "supportPerCell", label: "Support per cell", group: "model", ref: "Q4", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Support model only." },
  { key: "supportCap", label: "Support cap", group: "model", ref: "Q4", input: { type: "number", min: 0, step: 0.05 }, description: "Support model only." },
  { key: "armorRareCropBug", label: "Armor Rare Crop bug", group: "model", input: { type: "boolean" }, description: "Wiki-reported bug: in the Greenhouse, Cropie and Squash do not drop while wearing Fermento or Helianthus Armor (only Fermento and Helianthus roll). Off = the set bonus as written." },
  { key: "capRareCropChance", label: "Cap Rare Crop chance at 100%", group: "model", input: { type: "boolean" }, description: "Overbloom can push a Rare Crop chance past 100%. Off: 175% = 1 guaranteed + a 75% roll for a 2nd. On: at most one item per roll." },
  { key: "spawnCells", label: "Spawn cells", group: "model", input: { type: "select", options: ["allEmpty", "slotsOnly"] }, description: "allEmpty: every empty cell rolls. slotsOnly: only target slots roll." },
  { key: "keepIdenticalOnStageChange", label: "Keep identical plants on stage change", group: "model", input: { type: "boolean" }, description: "Same kind at the same anchor survives a stage change untouched." },
  { key: "spawnsFillLayoutInputs", label: "Spawns fill layout inputs (hybrid)", group: "model", input: { type: "boolean" }, description: "A natural spawn (growing or fully grown) standing where a layout places the same mutation is kept and used as that input, instead of being broken and re-placed from inventory. This is what makes hybrid rotations work: grow Magic Jellybeans in one stage, then use them as inputs in the next while they finish growing." },
];

export function withConfigDefaults(partial?: Partial<SimConfig>): SimConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
