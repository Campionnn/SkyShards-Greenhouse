/**
 * Friendly player-stat inputs shared by the simulator (Player tab), the leaderboard ("Your stats")
 * and the Guide (How you play): one definition per stat, so every surface offers the same choices.
 *
 * - `kind: "number"`: a plain number (Farming Fortune, Crop Growth, ...).
 * - `kind: "select"`: a fixed list of game values (Bioanalysis accessory, upgrade tiers, attribute levels).
 * - `kind: "chip"`: a Garden Chip picked as rarity + level (Evergreen); the stored value is the fraction.
 *
 * Values stay in the engine's units (`PlayerStats`), so nothing persisted changes.
 */
import type { PlayerStats } from "../../simulator/sim/state";

/** PlayerStats keys holding a number. */
export type NumericStatKey = { [K in keyof PlayerStats]-?: PlayerStats[K] extends number ? K : never }[keyof PlayerStats];

export interface StatOption {
  value: number;
  label: string;
}

export type ChipRarity = "rare" | "epic" | "legendary";

export interface ChipSpec {
  /** Effect per chip level by rarity (Garden Chips wiki page). */
  perLevel: Record<ChipRarity, number>;
  /** Max level by rarity: Rare 10, Epic 15, Legendary 20. */
  maxLevel: Record<ChipRarity, number>;
  /** "+60%" for a value. */
  format: (value: number) => string;
}

interface BaseDef {
  key: NumericStatKey;
  label: string;
  hint?: string;
}

export type StatFieldDef =
  | (BaseDef & { kind: "number"; min: number; max: number; step?: number })
  | (BaseDef & { kind: "select"; options: StatOption[] })
  | (BaseDef & { kind: "chip"; chip: ChipSpec });

const pct = (v: number, digits = 1) => `+${Number((v * 100).toFixed(digits))}%`;

export const CHIP_RARITIES: ChipRarity[] = ["rare", "epic", "legendary"];
export const CHIP_RARITY_LABEL: Record<ChipRarity, string> = { rare: "Rare", epic: "Epic", legendary: "Legendary" };

/** Evergreen Chip: +2% / +2.5% / +3% base crops per level in the Greenhouse (max 20% / 37.5% / 60%). */
export const EVERGREEN_CHIP: ChipSpec = {
  perLevel: { rare: 0.02, epic: 0.025, legendary: 0.03 },
  maxLevel: { rare: 10, epic: 15, legendary: 20 },
  format: (v) => pct(v),
};

/** The fraction a chip gives at a rarity and level (level 0 = no chip). */
export function chipValue(spec: ChipSpec, rarity: ChipRarity, level: number): number {
  const l = Math.max(0, Math.min(spec.maxLevel[rarity], Math.round(level)));
  return Number((spec.perLevel[rarity] * l).toFixed(6));
}

/**
 * The rarity and level behind a stored value: the highest rarity whose levels hit it exactly, else
 * null (a custom value from an old save or a typed number; the picker then shows it as "Custom").
 */
export function chipFromValue(spec: ChipSpec, value: number): { rarity: ChipRarity; level: number } | null {
  if (!(value > 0)) return { rarity: "legendary", level: 0 };
  for (const rarity of [...CHIP_RARITIES].reverse()) {
    const level = value / spec.perLevel[rarity];
    const rounded = Math.round(level);
    if (Math.abs(level - rounded) < 1e-6 && rounded >= 1 && rounded <= spec.maxLevel[rarity]) return { rarity, level: rounded };
  }
  return null;
}

export const BIOANALYSIS_OPTIONS: StatOption[] = [
  { value: 0, label: "None" },
  { value: 0.05, label: "Talisman · +5%" },
  { value: 0.1, label: "Ring · +10%" },
  { value: 0.15, label: "Artifact · +15%" },
];

/** Greenhouse Growth Speed upgrade: +5% per tier, tier 9 jumps to +50%. */
export const GROWTH_UPGRADE_OPTIONS: StatOption[] = Array.from({ length: 10 }, (_, t) => ({
  value: t,
  label: t === 0 ? "None" : `Tier ${t} · +${t === 9 ? 50 : 5 * t}%`,
}));

/** Plant Yield Greenhouse upgrade: +2% per tier, 10 tiers. */
export const PLANT_YIELD_OPTIONS: StatOption[] = Array.from({ length: 11 }, (_, t) => ({
  value: Number((t * 0.02).toFixed(2)),
  label: t === 0 ? "None" : `Tier ${t} · +${2 * t}%`,
}));

const levels = (describe: (n: number) => string): StatOption[] =>
  Array.from({ length: 11 }, (_, n) => ({ value: n, label: n === 0 ? "None" : `Level ${n} · ${describe(n)}` }));

/** Flora (Unique Bonus) attribute: counts as 1–10 unique crops. */
export const FLORA_OPTIONS = levels((n) => `+${n} unique`);
/** Greenhouse Speed attribute: +0.1–1% growth speed. */
export const SPEED_ATTRIBUTE_OPTIONS = levels((n) => `+${Number((n * 0.1).toFixed(1))}%`);

export const STAT_FIELDS: Record<NumericStatKey, StatFieldDef> = {
  cropGrowth: { key: "cropGrowth", kind: "number", label: "Crop Growth", min: 0, max: 210, step: 5, hint: "0 to 210." },
  speedAttribute: { key: "speedAttribute", kind: "select", label: "Greenhouse Speed attribute", options: SPEED_ATTRIBUTE_OPTIONS, hint: "Timestalk Clone Shard." },
  growthUpgradeTier: { key: "growthUpgradeTier", kind: "select", label: "Growth Speed upgrade", options: GROWTH_UPGRADE_OPTIONS, hint: "Greenhouse upgrade; tier 9 jumps to +50%." },
  floraShard: { key: "floraShard", kind: "select", label: "Flora attribute", options: FLORA_OPTIONS, hint: "Adds to the unique crops standing (10 max in total)." },
  mutationChanceBonus: { key: "mutationChanceBonus", kind: "select", label: "Bioanalysis", options: BIOANALYSIS_OPTIONS, hint: "Multiplies the chance for a crop to mutate." },
  miningFortune: { key: "miningFortune", kind: "number", label: "Mining Fortune", min: 0, max: 3000, step: 50, hint: "Chloronite item count (caps at 4 from 2000)." },
  farmingFortune: { key: "farmingFortune", kind: "number", label: "Farming Fortune", min: 0, max: 4000, step: 10, hint: "Wiki theoretical maximum: 3059.2." },
  plantYieldUpgrade: { key: "plantYieldUpgrade", kind: "select", label: "Plant Yield upgrade", options: PLANT_YIELD_OPTIONS, hint: "Greenhouse upgrade, +2% per tier." },
  evergreenChip: { key: "evergreenChip", kind: "chip", label: "Evergreen Chip", chip: EVERGREEN_CHIP, hint: "More base crops from Greenhouse harvests: +2% / +2.5% / +3% per level (Rare / Epic / Legendary)." },
  overbloom: { key: "overbloom", kind: "number", label: "Overbloom", min: 0, max: 1000, step: 1, hint: "Rare Crop chance × (1 + Overbloom/100)." },
  startTimeOfDay: { key: "startTimeOfDay", kind: "number", label: "Start time of day", min: 0, max: 24, step: 0.5 },
};

/** The option closest to a value (a stored number that isn't exactly an option still shows sensibly). */
export function nearestOption(options: StatOption[], value: number): StatOption {
  return options.reduce((best, o) => (Math.abs(o.value - value) < Math.abs(best.value - value) ? o : best), options[0]);
}
