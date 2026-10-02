import { DEFAULT_CONFIG } from "./config";
import { DEFAULT_POLICIES } from "./flow/policies";
import type { Flow } from "./flow/types";
import type { PlayerStats, Scenario, Settings } from "./sim/state";

/** Wiki maximums (Greenhouse / Farming Fortune / Chloronite pages). */
export const DEFAULT_PLAYER_STATS: PlayerStats = {
  /** Crop Growth stat range 0-210. */
  cropGrowth: 210,
  /** Greenhouse Speed attribute +0.1-1%: a = 10 in the 0.001a term. */
  speedAttribute: 10,
  /** Growth Speed Upgrade tier 9 = +50%. */
  growthUpgradeTier: 9,
  /** Farming Fortune "Theoretical Maximum" summary (permanent + temporary, max Hypercharge). */
  farmingFortune: 3059.2,
  /** Plant Yield Greenhouse Upgrade: +2-20%. */
  plantYieldUpgrade: 0.2,
  /** Evergreen Chip: +2-60% to all crop-bundle drops. */
  evergreenChip: 0.6,
  /** Bioanalysis Artifact: +15%. */
  mutationChanceBonus: 0.15,
  /** No stated max; Chloronite drop count caps at 4 at 2000. */
  miningFortune: 2000,
  /** Permanent sources + Overpriced Drink + Feast V tool (no Crop Fever). Uncapped. */
  overbloom: 186,
  /** Helianthus 4/4: combines the Tater, Cropie, Squash and Fermento bonuses. */
  armorSet: "helianthus",
  startTimeOfDay: 0,
  /** Flora attribute shard, max 10. */
  floraShard: 10,
};

export function defaultSettings(): Settings {
  return {
    seed: 12345,
    playerStats: { ...DEFAULT_PLAYER_STATS },
    activity: { kind: "everyN", n: 1, offset: 0 },
    playerActions: true,
    policies: structuredClone(DEFAULT_POLICIES),
    config: structuredClone(DEFAULT_CONFIG),
  };
}

/** A one-step flow: a static layout. */
export function staticFlow(code: string, label = "Layout"): Flow {
  return { steps: [{ id: "step-1", label, layout: { code }, exit: [] }], loop: false, startIndex: 0 };
}

/** One plot per share code, each holding its layout as a single step. */
export function scenarioFromShareCodes(codes: string[], settings: Settings = defaultSettings()): Scenario {
  return {
    plots: codes.slice(0, 3).map((code, i) => ({ id: i + 1, flow: staticFlow(code, `Plot ${i + 1} layout`) })),
    startingInventory: {},
    settings,
  };
}
