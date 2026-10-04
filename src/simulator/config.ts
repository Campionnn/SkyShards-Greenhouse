/**
 * All tunable and unpublished simulator values. Stored in the scenario
 * (scenario.settings.config) so a run is reproducible from its input.
 * CONFIG_META drives the Advanced panel, grouped by source quality:
 * verified, unpublished (reasoned defaults), model switches. `ref` values
 * are entries in SkyShards-API/docs/greenhouse/OPEN_QUESTIONS.md.
 */

// ---- Fixed values (no longer settings) ----

/** Spawn pool denominator floor: max(SPAWN_POOL_FLOOR, Σweights); the remainder is the blank. */
export const SPAWN_POOL_FLOOR = 100;
/**
 * At or below this water a plant halts: no growth, no effects given or
 * relayed, not counted for requirements or unique crops. It still blocks
 * Lonelily and keeps decaying. Watering un-halts it. Must stay below 0.
 */
export const HALT_WATER = -100;
/** Water level after watering. */
export const MAX_WATER = 100;
/** Cycle length (one growth stage) before speed bonuses, seconds (4 h). */
export const CYCLE_BASELINE_SECONDS = 14400;
/** Max unique crops counted by the Unique Crop Bonus (groups standing on all plots + Flora shard). */
export const UNIQUE_CROP_CAP = 10;
/** Growth speed per unique crop counted (+2.5%, +25% at cap). */
export const UNIQUE_CROP_GROWTH_PER_CROP = 0.025;
/** Harvest yield per unique crop counted (+2.5%, +25% at cap). */
export const UNIQUE_CROP_YIELD_PER_CROP = 0.025;
/** Thunderling charge gained per growth stage (wiki). */
export const THUNDERLING_CHARGE_PER_STAGE = 2000;
/** Thunderling charge at which it stops growing until discharged (wiki). */
export const THUNDERLING_MAX_CHARGE = 16000;
/** Hours a decay timer is extended, repeatedly, while minimum mutations are unmet. */
export const DECAY_EXTENSION_HOURS = 24;
/** Chance per tick a growing Devourer grows a root into a neighbouring cell (staff-confirmed 40%). */
export const DEVOURER_ROOT_CHANCE = 0.4;
/** Chance per tick each root spreads another root. */
export const ROOT_SPREAD_CHANCE = 0.4;
/** Harvest Bounty rolls per harvest of a plant holding Bonus Drops. */
export const HARVEST_BOUNTY_ROLLS = 1;
/** Hunger a Fleshtrap spawns with. */
export const FLESHTRAP_INITIAL_HUNGER = 0;
/** Magic Jellybean drop multiplier cap (+1 per 12 stages from 12). */
export const JELLYBEAN_MULTIPLIER_CAP = 10;

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

export interface SimConfig {
  // ---- Verified ----
  /**
   * Water lost per cycle (rolled in [min, max], x retain/drain factor) by a
   * crop that needs watering while not fully grown, grown that cycle or not.
   * Fully grown and halted plants lose none.
   */
  waterLossMin: number;
  waterLossMax: number;

  // ---- Unpublished: reasoned defaults ----
  /** Chance a stage is skipped while water < 0 (Q9). */
  negativeWaterSkipChance: number;
  chorusTeleportTargets: ChorusTeleport;
  /**
   * Chorus Overflow (emptyOnly only): growing chorus teleport simultaneously,
   * each to a distinct cell empty at tick start; when there are more growing
   * chorus than such cells, each extra one overwrites a random occupied cell
   * (another chorus: the higher stage wins). Off: they jump one at a time and
   * can reuse a cell another chorus just left.
   */
  chorusOverflow: boolean;
  /** Water a Soggybud draws per tick from each neighbouring crop that has water. */
  soggybudWaterPerNeighbour: number;
  /** Soggybud stage = floor(water / this). */
  soggybudWaterPerStage: number;
  /** Cap Overbloom-boosted Rare Crop chance at 100% instead of guaranteed + fractional extra. */
  capRareCropChance: boolean;
  fleshtrapHungerPerStage: number;
  fleshtrapFeedHunger: number;
  /**
   * Auto: each session the player harvests All-in Aloe at the stage that makes
   * the most aloe per cycle for the time until they are next online and the
   * cell's respawn chance (growth/aloe.ts `aloeHarvestStageFor`). Off: `aloeHarvestStage`.
   */
  aloeAutoHarvest: boolean;
  /** Fixed stage All-in Aloe is harvested at when `aloeAutoHarvest` is off (any stage allowed). */
  aloeHarvestStage: number;

  // ---- Model switches ----
  /** Wiki-reported bug: no Cropie/Squash from Greenhouse crops in Fermento or Helianthus Armor. */
  armorRareCropBug: boolean;
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
  waterLossMin: 18,
  waterLossMax: 22,

  negativeWaterSkipChance: 0.5,
  chorusTeleportTargets: "emptyOnly",
  chorusOverflow: true,
  soggybudWaterPerNeighbour: 2,
  soggybudWaterPerStage: 10,
  capRareCropChance: false,
  fleshtrapHungerPerStage: 1,
  fleshtrapFeedHunger: 6,
  aloeAutoHarvest: true,
  aloeHarvestStage: 14,

  armorRareCropBug: true,
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
  { key: "waterLossMin", label: "Water loss min", group: "verified", input: { type: "number", min: 0 }, description: "Minimum water a crop that needs watering loses per cycle while not fully grown (whether or not it grew that cycle), before retain/drain. Fully grown and dried-out plants lose none. The default was 2 (per stage grown) before the 0.27.2 rules; a scenario saved then keeps its value until you restore defaults." },
  { key: "waterLossMax", label: "Water loss max", group: "verified", input: { type: "number", min: 0 }, description: "Maximum water a crop that needs watering loses per cycle while not fully grown (whether or not it grew that cycle), before retain/drain. Fully grown and dried-out plants lose none. The default was 3 (per stage grown) before the 0.27.2 rules; a scenario saved then keeps its value until you restore defaults." },

  { key: "negativeWaterSkipChance", label: "Negative-water skip chance", group: "unpublished", ref: "Q9", input: { type: "number", min: 0, max: 1, step: 0.05 }, description: "Chance a stage is skipped while water is below 0 (before it reaches the halt level)." },
  { key: "soggybudWaterPerNeighbour", label: "Soggybud water per neighbour", group: "unpublished", input: { type: "number", min: 0 }, description: "Water a Soggybud takes each tick from each neighbouring crop that has water (never from another Soggybud)." },
  { key: "soggybudWaterPerStage", label: "Soggybud water per stage", group: "unpublished", input: { type: "number", min: 1 }, description: "Soggybud's growth stage is floor(water / this)." },
  { key: "chorusTeleportTargets", label: "Chorus teleport targets", group: "unpublished", ref: "Q11", input: { type: "select", options: ["emptyOnly", "anyCell"] }, description: "Either way it can land on AIR, which becomes End Stone. anyCell also lets it land on (and destroy) a plant." },
  { key: "chorusOverflow", label: "Chorus Overflow", group: "unpublished", input: { type: "boolean" }, description: "Observed in game (emptyOnly only): all growing Chorus Fruit teleport at the same time, each to a different cell that was empty at the start of the tick (cells being left that tick don't count). When there are more growing Chorus Fruit than empty cells, each extra one lands on a random occupied cell and destroys what's there: an input, a base crop or another Chorus Fruit (the higher stage wins). Off: they teleport one at a time and can reuse a cell another one just left, so they never overflow unless the plot is full." },
  { key: "fleshtrapHungerPerStage", label: "Fleshtrap hunger per stage", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger used per stage grown." },
  { key: "fleshtrapFeedHunger", label: "Fleshtrap feed amount", group: "unpublished", input: { type: "number", min: 0 }, description: "Hunger added per feeding (enchanted cooked meat = 6)." },
  { key: "aloeAutoHarvest", label: "All-in Aloe: auto harvest stage", group: "unpublished", input: { type: "boolean" }, description: "Each session the player harvests All-in Aloe at the stage that makes the most aloe per cycle, given how many cycles until they are next online and the chance a new aloe spawns in the emptied cell. Checking every cycle gives 14 (the wiki optimum). A longer time offline lowers it (about 12 for 4 cycles, 10 for 8), because an aloe left growing may reset before the player is back. A slow respawn raises it. Off: always harvest at the fixed stage below." },
  { key: "aloeHarvestStage", label: "All-in Aloe fixed harvest stage", group: "unpublished", input: { type: "number", min: 1, max: 27 }, description: "Stage the player harvests All-in Aloe at when auto is off. Growing out of a stage rolls that stage's chance to reset to stage 1 (3% at stage 4, +3% per stage); 14 maximises expected drops when checking every cycle." },

  { key: "armorRareCropBug", label: "Armor Rare Crop bug", group: "model", input: { type: "boolean" }, description: "Wiki-reported bug: in the Greenhouse, Cropie and Squash do not drop while wearing Fermento or Helianthus Armor (only Fermento and Helianthus roll). Off = the set bonus as written." },
  { key: "capRareCropChance", label: "Cap Rare Crop chance at 100%", group: "model", input: { type: "boolean" }, description: "Overbloom can push a Rare Crop chance past 100%. Off: 175% = 1 guaranteed + a 75% roll for a 2nd. On: at most one item per roll." },
  { key: "mutationCreditOrder", label: "Mutation credit order", group: "model", input: { type: "select", options: [...MUTATION_CREDIT_ORDERS] }, description: "When a mutation spawns, it credits as many ring neighbours of each required kind as the requirement count (each counts toward their minimum mutations). Which ones, when more stand there, is unknown in game. ringOrder: row by row from the top-left (extra neighbours never age). mostRemainingFirst: the ones with the most left to help (spreads the use evenly). fewestRemainingFirst: the ones with the fewest left (uses the same ones up). random: a seeded random pick." },
  { key: "keepIdenticalOnStepChange", label: "Keep identical plants on step change", group: "model", input: { type: "boolean" }, description: "Same kind at the same anchor survives a step change untouched." },
  { key: "spawnsFillLayoutInputs", label: "Spawns fill layout inputs (hybrid)", group: "model", input: { type: "boolean" }, description: "A natural spawn (growing or fully grown) standing where a layout places the same mutation is kept and used as that input, instead of being broken and re-placed from inventory. This is what makes hybrid flows work: grow Magic Jellybeans in one step, then use them as inputs in the next while they finish growing." },
];

export function withConfigDefaults(partial?: Partial<SimConfig>): SimConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}
