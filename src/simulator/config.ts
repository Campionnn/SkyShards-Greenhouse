/**
 * All tunable and unpublished simulator values. Stored in the scenario
 * (scenario.settings.config) so a run is reproducible from its input.
 * CONFIG_META drives the Advanced panel, grouped by source quality:
 * verified, unpublished (reasoned defaults), model switches. `ref` values
 * are entries in SkyShards-API/docs/greenhouse/OPEN_QUESTIONS.md.
 */

export type WeightModel = "ceiling" | "support";
export type SpawnCells = "allEmpty" | "slotsOnly";
export type ChorusTeleport = "emptyOnly" | "anyCell";
/**
 * Which ring neighbours a spawn credits when more of a required kind stand
 * there than the requirement count (sim/decay.ts):
 * - ringOrder: ring index ascending (row-major from top-left), no RNG
 * - mostRemainingFirst: most mutations left to help first
 * - fewestRemainingFirst: fewest left first
 * - random: seeded shuffle; draws RNG only when selected
 */
export type MutationCreditOrder = "ringOrder" | "mostRemainingFirst" | "fewestRemainingFirst" | "random";
export const MUTATION_CREDIT_ORDERS: readonly MutationCreditOrder[] = ["ringOrder", "mostRemainingFirst", "fewestRemainingFirst", "random"];
/** Per-kind minimum mutations: a count, "infinite" (never decays) or "none" (timer only). */
export type MinimumMutationsOverride = number | "infinite" | "none";

export interface SimConfig {
  // ---- Verified ----
  /** Spawn pool denominator floor: max(blankFillTo, Σweights). */
  blankFillTo: number;
  /**
   * At or below this water a plant halts: no growth, no effects given or
   * relayed, not counted for requirements or unique crops. It still blocks
   * Lonelily and keeps decaying. Watering un-halts it.
   */
  haltWater: number;
  /**
   * Water lost per cycle (rolled in [min, max], x retain/drain factor) by a
   * crop that needs watering while not fully grown, grown that cycle or not.
   * Fully grown and halted plants lose none.
   */
  waterLossMin: number;
  waterLossMax: number;
  /** Cycle length (one growth stage) before speed bonuses, seconds (4 h). */
  cycleBaselineSeconds: number;
  /** Max unique crops counted by the Unique Crop Bonus (groups standing on all plots + Flora shard). */
  uniqueCropCap: number;
  /** Growth speed per unique crop counted (+2.5%, +25% at cap). */
  uniqueCropGrowthPerCrop: number;
  /** Harvest yield per unique crop counted (+2.5%, +25% at cap). */
  uniqueCropYieldPerCrop: number;
  /** Thunderling charge gained per growth stage (wiki). */
  thunderlingChargePerStage: number;
  /** Thunderling charge at which it stops growing until discharged (wiki). */
  thunderlingMaxCharge: number;
  /** Hours a decay timer is extended, repeatedly, while minimum mutations are unmet. */
  decayExtensionHours: number;

  // ---- Unpublished: reasoned defaults ----
  maxWater: number;
  /** Chance a stage is skipped while water < 0 (Q9). */
  negativeWaterSkipChance: number;
  /**
   * Natural spawn decay timer in cycles from the spawn tick; 0 = the kind's
   * own timer (Q16b). Minimum mutations still apply.
   */
  harvestWindowCycles: number;
  /** Per-kind decay timer overrides in days (Q7); 0 = never decays. Missing = data.json. */
  decayDaysOverrides: Record<string, number>;
  /** Per-kind minimum mutations overrides; missing = data.json. Edited in the per-kind table, not CONFIG_META. */
  minimumMutationsOverrides: Record<string, MinimumMutationsOverride>;
  /** Chance per tick a Devourer grows a root into a neighbouring cell (40%). */
  devourerRootChance: number;
  /** Chance per tick each root spreads another root. */
  rootSpreadChance: number;
  chorusTeleportTargets: ChorusTeleport;
  /** Water a Soggybud draws per tick from each neighbouring crop that has water. */
  soggybudWaterPerNeighbour: number;
  /** Soggybud stage = floor(water / this). */
  soggybudWaterPerStage: number;
  bountyRollsPerHarvest: number;
  /** NPC price overrides by item id; missing = wiki NPC sell price (economy/prices.ts). */
  rareDropValues: Record<string, number>;
  /** Wiki-reported bug: no Cropie/Squash from Greenhouse crops in Fermento or Helianthus Armor. */
  armorRareCropBug: boolean;
  /** Cap Overbloom-boosted Rare Crop chance at 100% instead of guaranteed + fractional extra. */
  capRareCropChance: boolean;
  fleshtrapInitialHunger: number;
  fleshtrapHungerPerStage: number;
  fleshtrapFeedHunger: number;
  /** Stage All-in Aloe is harvested at (any stage allowed; 14 is optimal). */
  aloeHarvestStage: number;
  magicJellybeanMultiplierCap: number;
  /** PlantBoy / Stoplight / Phantomleaf minigames always succeed. */
  perfectPlay: boolean;
  /** Per-harvest minigame failure chance when perfectPlay is off. PlantBoy/Stoplight retry next session; Phantomleaf is destroyed. */
  minigameFailChance: number;

  // ---- Model switches ----
  /** 'ceiling' = full weight once requirements hold; 'support' = wiki per-cell multiplier (Q4). */
  weightModel: WeightModel;
  supportPerCell: number;
  supportCap: number;
  /** Which empty cells roll for a spawn each cycle. */
  spawnCells: SpawnCells;
  /** See MutationCreditOrder. */
  mutationCreditOrder: MutationCreditOrder;
  /** A step change keeps a plant when the new layout has the same kind at the same anchor. */
  keepIdenticalOnStepChange: boolean;
  /**
   * A natural spawn (growing or fully grown) at an anchor where the layout
   * places the same mutation is kept as that input instead of being broken
   * and re-placed from inventory. Enables hybrid flows.
   */
  spawnsFillLayoutInputs: boolean;
  /** Plot iteration order; plots contend for shared inventory in this order. */
  plotOrder: number[];
}

export const DEFAULT_CONFIG: SimConfig = {
  blankFillTo: 100,
  haltWater: -100,
  waterLossMin: 18,
  waterLossMax: 22,
  cycleBaselineSeconds: 14400,
  uniqueCropCap: 10,
  uniqueCropGrowthPerCrop: 0.025,
  uniqueCropYieldPerCrop: 0.025,
  thunderlingChargePerStage: 2000,
  thunderlingMaxCharge: 16000,
  decayExtensionHours: 24,

  maxWater: 100,
  negativeWaterSkipChance: 0.5,
  harvestWindowCycles: 0,
  decayDaysOverrides: {},
  minimumMutationsOverrides: {},
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
  mutationCreditOrder: "ringOrder",
  keepIdenticalOnStepChange: true,
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
  { key: "haltWater", label: "Halt water level", group: "verified", ref: "Q3", input: { type: "number", max: -1 }, description: "At or below this water level a plant dries out and halts (it no longer dies): it stops growing, gives and relays no effects, and doesn't count for mutation requirements or unique crops. It still blocks Lonelily and keeps decaying. Watering un-halts it. Must stay below 0, so only crops that drink water (base crops, spawns that need watering) can reach it." },
  { key: "waterLossMin", label: "Water loss min", group: "verified", input: { type: "number", min: 0 }, description: "Minimum water a crop that needs watering loses per cycle while not fully grown (whether or not it grew that cycle), before retain/drain. Fully grown and dried-out plants lose none. The default was 2 (per stage grown) before the 0.27.2 rules; a scenario saved then keeps its value until you restore defaults." },
  { key: "waterLossMax", label: "Water loss max", group: "verified", input: { type: "number", min: 0 }, description: "Maximum water a crop that needs watering loses per cycle while not fully grown (whether or not it grew that cycle), before retain/drain. Fully grown and dried-out plants lose none. The default was 3 (per stage grown) before the 0.27.2 rules; a scenario saved then keeps its value until you restore defaults." },
  { key: "cycleBaselineSeconds", label: "Cycle baseline (s)", group: "verified", ref: "Q2", input: { type: "number", min: 1 }, description: "Cycle length (one growth stage) before speed bonuses (4 h)." },
  { key: "uniqueCropCap", label: "Unique crop bonus cap", group: "verified", input: { type: "number", min: 0, step: 1 }, description: "Most unique crops the Unique Crop Bonus counts (0.27.2 patch notes: 10). The unique crop groups standing on all plots, plus the Flora shard, count up to this many." },
  { key: "uniqueCropGrowthPerCrop", label: "Unique crop growth bonus", group: "verified", input: { type: "number", min: 0, step: 0.005 }, description: "Growth speed added per unique crop counted (0.27.2 patch notes: +2.5% each, +25% at 10)." },
  { key: "uniqueCropYieldPerCrop", label: "Unique crop yield bonus", group: "verified", input: { type: "number", min: 0, step: 0.005 }, description: "Harvest yield added per unique crop counted (0.27.2 patch notes: +2.5% each, +25% at 10)." },
  { key: "thunderlingChargePerStage", label: "Thunderling charge per stage", group: "verified", input: { type: "number", min: 0 }, description: "Charge a spawned Thunderling gains per growth stage (wiki: 2,000). It starts at 0." },
  { key: "thunderlingMaxCharge", label: "Thunderling max charge", group: "verified", input: { type: "number", min: 1 }, description: "At this charge a Thunderling stops growing (it still counts for requirements and shares effects) until the player discharges it. No more charge builds above it." },
  { key: "decayExtensionHours", label: "Decay extension (h)", group: "verified", input: { type: "number", min: 1 }, description: "0.27.2: when a plant's decay timer runs out but it hasn't yet helped create its minimum number of mutations, the timer is extended by this many hours (as often as needed). Plants of the same kind on a plot that have helped at least once and are fully grown share the count. Decay timers and minimums per kind are in the table below." },

  { key: "maxWater", label: "Max water", group: "unpublished", ref: "Q3", input: { type: "number", min: 0 }, description: "Water level after watering. Watering also un-halts a dried-out plant." },
  { key: "negativeWaterSkipChance", label: "Negative-water skip chance", group: "unpublished", ref: "Q9", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Chance a stage is skipped while water is below 0 (before it reaches the halt level)." },
  { key: "harvestWindowCycles", label: "Spawn decay timer (cycles)", group: "unpublished", ref: "Q16", input: { type: "number", min: 0 }, description: "A natural spawn's decay timer, in cycles from the tick it spawns (growth included). 0 = its own decay timer. Timer only: when it runs out, the minimum mutations still apply (it is extended until met)." },
  { key: "devourerRootChance", label: "Devourer root chance", group: "verified", ref: "Q6", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Chance per tick a Devourer grows a root into one of its 8 neighbouring cells, destroying what is there (40% staff-confirmed)." },
  { key: "rootSpreadChance", label: "Root spread chance", group: "unpublished", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Chance per tick each root spreads another root into a neighbouring cell." },
  { key: "soggybudWaterPerNeighbour", label: "Soggybud water per neighbour", group: "unpublished", input: { type: "number", min: 0 }, description: "Water a Soggybud takes each tick from each neighbouring crop that has water (never from another Soggybud)." },
  { key: "soggybudWaterPerStage", label: "Soggybud water per stage", group: "unpublished", input: { type: "number", min: 1 }, description: "Soggybud's growth stage is floor(water / this)." },
  { key: "chorusTeleportTargets", label: "Chorus teleport targets", group: "unpublished", ref: "Q11", input: { type: "select", options: ["emptyOnly", "anyCell"] }, description: "Either way it can land on AIR, which becomes End Stone. anyCell also lets it land on (and destroy) a plant." },
  { key: "bountyRollsPerHarvest", label: "Harvest Bounty rolls", group: "unpublished", input: { type: "number", min: 0 }, description: "Bounty rolls per harvest of a plant holding Bonus Drops." },
  { key: "fleshtrapInitialHunger", label: "Fleshtrap initial hunger", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger a Fleshtrap spawns with." },
  { key: "fleshtrapHungerPerStage", label: "Fleshtrap hunger per stage", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger used per stage grown." },
  { key: "fleshtrapFeedHunger", label: "Fleshtrap feed amount", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger added per feeding (enchanted cooked meat = 6)." },
  { key: "aloeHarvestStage", label: "All-in Aloe harvest stage", group: "unpublished", input: { type: "number", min: 1, max: 27 }, description: "Stage the player harvests All-in Aloe at. It resets to stage 1 with a rising chance on each new stage; 14 maximises expected drops." },
  { key: "magicJellybeanMultiplierCap", label: "Jellybean multiplier cap", group: "unpublished", input: { type: "number", min: 1 }, description: "Magic Jellybean drop multiplier (its own items and its crop bundle): +1 per 12 stages from 12, up to this cap. The player harvests at stage 120; one broken earlier (from stage 12) drops at its current multiplier." },
  { key: "perfectPlay", label: "Perfect minigames", group: "unpublished", input: { type: "boolean" }, description: "PlantBoy / Stoplight / Phantomleaf minigames always succeed." },
  { key: "minigameFailChance", label: "Minigame fail chance", group: "unpublished", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Used when perfect minigames is off. A failed PlantBoy Advance or Stoplight Petal stays fully grown and is retried at the next session (a step change or blocked layout cell still breaks it); a failed Phantomleaf is destroyed." },

  { key: "weightModel", label: "Spawn weight model", group: "model", ref: "Q4", input: { type: "select", options: ["ceiling", "support"] }, description: "ceiling: full weight once requirements hold (repo). support: weight x 25% per matching adjacent cell (wiki)." },
  { key: "supportPerCell", label: "Support per cell", group: "model", ref: "Q4", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Support model only." },
  { key: "supportCap", label: "Support cap", group: "model", ref: "Q4", input: { type: "number", min: 0, step: 0.05 }, description: "Support model only." },
  { key: "armorRareCropBug", label: "Armor Rare Crop bug", group: "model", input: { type: "boolean" }, description: "Wiki-reported bug: in the Greenhouse, Cropie and Squash do not drop while wearing Fermento or Helianthus Armor (only Fermento and Helianthus roll). Off = the set bonus as written." },
  { key: "capRareCropChance", label: "Cap Rare Crop chance at 100%", group: "model", input: { type: "boolean" }, description: "Overbloom can push a Rare Crop chance past 100%. Off: 175% = 1 guaranteed + a 75% roll for a 2nd. On: at most one item per roll." },
  { key: "spawnCells", label: "Spawn cells", group: "model", input: { type: "select", options: ["allEmpty", "slotsOnly"] }, description: "allEmpty: every empty cell rolls. slotsOnly: only target slots roll." },
  { key: "mutationCreditOrder", label: "Mutation credit order", group: "model", input: { type: "select", options: [...MUTATION_CREDIT_ORDERS] }, description: "When a mutation spawns, it credits as many ring neighbours of each required kind as the requirement count (each counts toward their minimum mutations). Which ones, when more stand there, is unknown in game. ringOrder: row by row from the top-left (extra neighbours never age). mostRemainingFirst: the ones with the most left to help (spreads the use evenly). fewestRemainingFirst: the ones with the fewest left (uses the same ones up). random: a seeded random pick." },
  { key: "keepIdenticalOnStepChange", label: "Keep identical plants on step change", group: "model", input: { type: "boolean" }, description: "Same kind at the same anchor survives a step change untouched." },
  { key: "spawnsFillLayoutInputs", label: "Spawns fill layout inputs (hybrid)", group: "model", input: { type: "boolean" }, description: "A natural spawn (growing or fully grown) standing where a layout places the same mutation is kept and used as that input, instead of being broken and re-placed from inventory. This is what makes hybrid flows work: grow Magic Jellybeans in one step, then use them as inputs in the next while they finish growing." },
];

export function withConfigDefaults(partial?: Partial<SimConfig>): SimConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
