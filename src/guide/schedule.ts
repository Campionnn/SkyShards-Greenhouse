/**
 * Translating "how often do you check your greenhouse?" into the scenario's schedule.
 *
 * The player answers in real hours. The simulator schedules in growth cycles (`everyN`), and a
 * cycle's real length depends on the player's speed stats and the Unique Crop Bonus:
 * `cycleSeconds` in the engine. Dividing by the 4-hour baseline instead would make "every 4 hours"
 * mean "every 1.75 hours" for a player with default stats.
 */
import { UNIQUE_CROP_CAP } from "../simulator/config";
import { cycleSeconds, effectiveUniqueCrops } from "../simulator/growth/clock";
import { defaultSettings } from "../simulator/scenario";
import type { PlayerStats, Settings } from "../simulator/sim/state";

/**
 * The stats a new Guide player starts with: a mid-game player working towards the Rose Dragon, not
 * the Simulator's maxed-out defaults. Only the stats the "How you play" dialog shows are set here;
 * the rest (speed attribute, overbloom, armor) stay the Simulator's.
 */
export const GUIDE_DEFAULT_STATS = {
  floraShard: 0,
  cropGrowth: 100,
  growthUpgradeTier: 4,
  plantYieldUpgrade: 0.1,
  mutationChanceBonus: 0,
  miningFortune: 1000,
  farmingFortune: 1500,
  evergreenChip: 0.2,
} satisfies Partial<PlayerStats>;

/** Simulator settings with the Guide's default player stats. */
export function guideDefaultSettings(): Settings {
  const base = defaultSettings();
  return { ...base, playerStats: { ...base.playerStats, ...GUIDE_DEFAULT_STATS } };
}

/**
 * Unique crop groups assumed standing for the conversion. The Rose Dragon farms keep most base crop
 * groups planted, so this is near the cap; Flora tops it up. The forecast then runs the real clock.
 */
export const TYPICAL_UNIQUE_CROPS_STANDING = 8;

/** Real hours one growth cycle takes for these stats (typical standing crops plus Flora). */
export function hoursPerCycle(stats: PlayerStats): number {
  const unique = Math.min(UNIQUE_CROP_CAP, effectiveUniqueCrops(TYPICAL_UNIQUE_CROPS_STANDING, stats.floraShard));
  return cycleSeconds(stats, unique) / 3600;
}

/** "Every 12 hours" -> the scenario's `everyN` cycle gap for these stats, never below one cycle. */
export function hoursToCycles(hours: number, stats: PlayerStats): number {
  if (!Number.isFinite(hours) || hours <= 0) return 1;
  return Math.max(1, Math.round(hours / hoursPerCycle(stats)));
}

/** The schedule the simulator runs: every N hours (converted) or the player's daily windows. */
export function activityFor(checkEvery: number | null, settings: Settings): Settings["activity"] {
  if (checkEvery === null) return settings.activity.kind === "windows" ? settings.activity : { kind: "windows", windows: [{ from: 18, to: 23 }] };
  return { kind: "everyN", n: hoursToCycles(checkEvery, settings.playerStats), offset: 0 };
}

/** Default check-in interval for a new player, in hours. */
export const DEFAULT_CHECK_EVERY = 8;
