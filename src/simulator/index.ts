// Public simulator API. The single-tick primitive is not exported: time moves only through run().

export { createEngine, type Engine } from "./engine";
export { CONFIG_META, DEFAULT_CONFIG, MUTATION_CREDIT_ORDERS, withConfigDefaults } from "./config";
export type { ConfigGroup, ConfigMeta, MinimumMutationsOverride, MutationCreditOrder, SimConfig } from "./config";
export { defaultGameData } from "./data/default";
export { GameDataError, isHarvestableCrop, kindDef, loadGameData } from "./data/load";
export type * from "./data/types";
export type * from "./flow/types";
export { DEFAULT_POLICIES, mergePolicies } from "./flow/policies";
export { describeCondition, describeConditions, describeTrigger, type StepNamer } from "./flow/triggers";
export { LayoutError, resolveLayout } from "./flow/layout";
export { MAX_PLOTS, ScenarioError, validateScenario, type ScenarioIssue } from "./flow/validate";
export { analyseSustainability, describeDebt, describeSpotFailure } from "./analysis/sustainability";
export type { ItemReport, ItemStatus, SpotReport, SustainabilityReport } from "./analysis/sustainability";
export { sanityCheck } from "./analysis/sanityCheck";
export type {
  SanityBlocker,
  SanityCheckResult,
  SanityEntry,
  SanityFootprint,
  SanityOccupant,
  SanityRequirement,
} from "./analysis/sanityCheck";
export { uptimeRatio } from "./sim/summary";
export { layoutFromDecoded, layoutFromShareCode } from "./share/layoutFromShare";
export { DEFAULT_PLAYER_STATS, defaultSettings, scenarioFromShareCodes, staticFlow } from "./scenario";
export { migrateScenario } from "./migrate";
export { ETHEREAL_VINE_BY_RARITY, HARVEST_BOUNTY, RARE_DROP_ITEMS } from "./economy/bounty";
export { defaultNpcPrice, npcPriceSource, WIKI_NPC_PRICES, type PriceSource } from "./economy/prices";
export { jellybeanMultiplier } from "./economy/yield";
export {
  ARMOR_SET_DROPS,
  ARMOR_SET_LABEL,
  ARMOR_SETS,
  armorRareCrops,
  expectedRareCount,
  GREENHOUSE_RARE_CROP_CHANCE,
  overbloomMultiplier,
  RARE_CROP_ITEMS,
  type ArmorSet,
} from "./economy/rareCrops";
export { UNMODELLED_RULES } from "./growth/gates";
export { decayDaysOf, isDry, minimumMutationsOf } from "./sim/plants";
export { combinedRemaining, decayStatus, isPooled, minimumMet, wouldDecayWithin } from "./sim/decay";
export type { DecayStatus, MutatesRemaining } from "./sim/decay";
export { ALOE_FRAGMENT, ALOE_OPTIMAL_STAGE, aloeHarvestItems, aloeRow } from "./growth/aloe";
export type * from "./sim/state";
