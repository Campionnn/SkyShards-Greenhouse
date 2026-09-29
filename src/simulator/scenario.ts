import { DEFAULT_CONFIG } from "./config";
import { DEFAULT_POLICIES } from "./flow/policies";
import type { Flow } from "./flow/types";
import type { PlayerStats, Scenario, Settings } from "./sim/state";

/**
 * Defaults are the maximum values per the Hypixel SkyBlock Wiki
 * (hypixelskyblock.minecraft.wiki, Greenhouse / Farming Fortune / Chloronite pages).
 */
export const DEFAULT_PLAYER_STATS: PlayerStats = {
  /** Crop Growth stat range 0-210. */
  cropGrowth: 210,
  /** Greenhouse Speed attribute: +0.1-1% => a = 10 in the 0.001a term. */
  speedAttribute: 10,
  /** Growth Speed Upgrade tier 9 = +50%. */
  growthUpgradeTier: 9,
  /** Farming Fortune "Theoretical Maximum" summary (permanent + temporary, max Hypercharge). */
  farmingFortune: 3059.2,
  /** Plant Yield Greenhouse Upgrade: +2-20%. */
  plantYieldUpgrade: 0.2,
  /** Evergreen Chip: +2-60%, all crop-bundle drops (base crops and mutation bundles alike). */
  evergreenChip: 0.6,
  /** Bioanalysis Artifact: +15%, the top of the Talisman/Ring/Artifact line. */
  mutationChanceBonus: 0.15,
  /** No stated max; 2000 is where the Chloronite drop count caps at 4. */
  miningFortune: 2000,
  /** Overbloom page: 186 = permanent sources + Overpriced Drink + Feast V on a farming tool (no Crop Fever). Uncapped. */
  overbloom: 186,
  /** Helianthus Armor 4/4: combines the Tater, Cropie, Squash and Fermento tiered bonuses. */
  armorSet: "helianthus",
  startTimeOfDay: 0,
};

export function defaultSettings(): Settings {
  return {
    seed: 12345,
    playerStats: { ...DEFAULT_PLAYER_STATS },
    activity: { kind: "everyN", n: 1, offset: 0 },
    policies: structuredClone(DEFAULT_POLICIES),
    config: structuredClone(DEFAULT_CONFIG),
  };
}

/** A one-stage flow: a static layout. */
export function staticFlow(code: string, label = "Layout"): Flow {
  return { stages: [{ id: "stage-1", label, layout: { code }, exit: [] }], loop: false, startIndex: 0 };
}

/** One plot per share code, each holding its layout as a single stage. */
export function scenarioFromShareCodes(codes: string[], settings: Settings = defaultSettings()): Scenario {
  return {
    plots: codes.slice(0, 3).map((code, i) => ({ id: i + 1, flow: staticFlow(code, `Plot ${i + 1} layout`) })),
    startingInventory: {},
    settings,
  };
}
