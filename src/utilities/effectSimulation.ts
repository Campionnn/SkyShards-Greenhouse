/**
 * Crop effect propagation; a port of the API's solver/effects.py.
 *
 * Game rules (measured in game; evidence in the API docstring):
 * 1. Direct: every plant gives its listed buffs (positive and negative) to its
 *    four cardinal neighbours, simultaneously. No plant holds its own buffs.
 * 2. Relays: every plant that holds effect_spread (it neighbours something
 *    listing it, e.g. a wild rose) gives everything it holds except
 *    effect_spread to its neighbours, until nothing changes, so connected
 *    relays share everything in every direction (since the Oct 13 2026 fix).
 *    A lone rose relays nothing; its neighbours do.
 * - Effects are a set. Immunity cancels negatives for its holder, which still
 *   relays them. improved_x hides x.
 * - A multi-cell plant is one entity with one effect set.
 * - A mutation slot (solver or designer target) marks where a mutation can
 *   spawn: it receives (that is what gets scored) but never gives or relays.
 *   A mutation placed as an input or locked onto the grid is a real plant.
 * - Godseed ("all_positive_crop_effects") has no crop requirements: a spot is
 *   eligible when its empty cells receive every positive effect it lists.
 * Unlike the API simulator, empty tiles record what they receive (for godseed
 * candidate spots); they never relay.
 */

import greenhouseData from "../../public/greenhouse/data.json";

type BuffEntry = { positive_buffs: string[]; negative_buffs: string[]; size?: number; special?: string };

const CROPS = greenhouseData.crops as Record<string, BuffEntry>;
const MUTATIONS = greenhouseData.mutations as Record<string, BuffEntry>;
const EFFECTS = greenhouseData.effects as Record<string, { name: string; description: string }>;

export const RELAY_EFFECT = "effect_spread";
export const SPECIAL_ALL_POSITIVE = "all_positive_crop_effects";
export const EFFECT_IDS: string[] = Object.keys(EFFECTS);

export const NEGATIVE_EFFECTS: Set<string> = new Set(
  [...Object.values(CROPS), ...Object.values(MUTATIONS)].flatMap((e) => e.negative_buffs || [])
);

/** base effect -> its improved twin (xp_boost -> improved_xp_boost, ...) */
export const IMPROVED_OF: Record<string, string> = Object.fromEntries(
  EFFECT_IDS.filter((e) => EFFECT_IDS.includes(`improved_${e}`)).map((e) => [e, `improved_${e}`])
);

/** Mutations whose eligibility is "holds all of these effects" (godseed). */
export const SPECIAL_EFFECT_SETS: Record<string, string[]> = Object.fromEntries(
  Object.entries(MUTATIONS)
    .filter(([, m]) => m.special === SPECIAL_ALL_POSITIVE)
    .map(([id, m]) => [id, [...(m.positive_buffs || [])]])
);

export interface PlantBuffs {
  intrinsic: Set<string>; // what it gives (positive + negative, effect_spread included)
  spreads: boolean;       // lists effect_spread: makes its NEIGHBOURS relays
}

const buffCache = new Map<string, PlantBuffs | undefined>();

/**
 * Inert scenery: mutation ingredients with no growth, drops or buffs (see
 * NON_SUPPORTING in simulator/spawn/multiplicity.ts). They never hold or spread
 * any effect, including ones received, so Fire next to a Wild Rose never relays.
 */
const EFFECT_INERT_KINDS: ReadonlySet<string> = new Set(["fire"]);

export function isEffectInert(id: string): boolean {
  return EFFECT_INERT_KINDS.has(id);
}

export function getPlantBuffs(id: string): PlantBuffs | undefined {
  if (buffCache.has(id)) return buffCache.get(id);
  const entry = CROPS[id] || MUTATIONS[id];
  let out: PlantBuffs | undefined;
  if (entry) {
    const listed = EFFECT_INERT_KINDS.has(id)
      ? []
      : [...(entry.positive_buffs || []), ...(entry.negative_buffs || [])];
    out = {
      intrinsic: new Set(listed),
      spreads: listed.includes(RELAY_EFFECT),
    };
  }
  buffCache.set(id, out);
  return out;
}

/** Effects a plant gives its cardinal neighbours (its listed buffs). Slots give nothing. */
export function effectsGivenBy(id: string, isSlot = false): string[] {
  const b = getPlantBuffs(id);
  if (!b || isSlot) return [];
  return sortEffects([...b.intrinsic]);
}

export function isNegativeEffect(id: string): boolean {
  return NEGATIVE_EFFECTS.has(id);
}

export function getEffectName(id: string): string {
  return EFFECTS[id]?.name || id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getEffectDescriptionText(id: string): string {
  return EFFECTS[id]?.description || "";
}

/** Stable display order: positives (data.json order) then negatives. */
export function sortEffects(effects: Iterable<string>): string[] {
  const order = new Map(EFFECT_IDS.map((e, i) => [e, i]));
  return [...new Set(effects)].sort((a, b) => {
    const na = NEGATIVE_EFFECTS.has(a) ? 1 : 0;
    const nb = NEGATIVE_EFFECTS.has(b) ? 1 : 0;
    if (na !== nb) return na - nb;
    return (order.get(a) ?? 99) - (order.get(b) ?? 99);
  });
}

/** The set that matters in game: immunity strips negatives, improved hides base. */
export function effectiveEffects(raw: Iterable<string>): Set<string> {
  const eff = new Set(raw);
  if (eff.has("immunity")) {
    for (const n of NEGATIVE_EFFECTS) eff.delete(n);
  }
  for (const [base, improved] of Object.entries(IMPROVED_OF)) {
    if (eff.has(improved)) eff.delete(base);
  }
  return eff;
}

export interface SimPlacement {
  id: string;
  position: [number, number];
  size: number;
  /** A mutation slot: receives effects but never gives any. */
  isSlot?: boolean;
}

interface SimPlant {
  id: string;
  position: [number, number];
  cells: string[];
  buffs: PlantBuffs;
  has: Set<string>;
  isSlot: boolean;
  /** Inert scenery (Fire): holds nothing it is given, so never relays. */
  isInert: boolean;
}

export interface EffectSimulation {
  /** Raw held set of the plant covering the cell (whole entity), or what an empty cell received. */
  heldAt(row: number, col: number): Set<string>;
  /** heldAt after immunity / improved-override rules. */
  effectiveAt(row: number, col: number): Set<string>;
  /** Union of what the given cells hold / received (a candidate multi-cell spot). */
  heldOver(position: [number, number], size: number): Set<string>;
  /** Godseed rule: does the spot hold every effect in the mutation's required set? */
  isSpecialEligible(mutationId: string, position: [number, number], size: number): boolean;
  /** Which required effects a spot is missing (empty list = eligible). */
  missingSpecialEffects(mutationId: string, position: [number, number], size: number): string[];
}

const CARDINAL: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function simulateEffects(
  placements: SimPlacement[],
  gridSize = 10
): EffectSimulation {
  const cellToPlant = new Map<string, SimPlant>();
  const received = new Map<string, Set<string>>();
  const plants: SimPlant[] = [];

  for (const p of placements) {
    const buffs = getPlantBuffs(p.id) || { intrinsic: new Set<string>(), spreads: false };
    const cells: string[] = [];
    for (let dr = 0; dr < p.size; dr++) {
      for (let dc = 0; dc < p.size; dc++) {
        const r = p.position[0] + dr;
        const c = p.position[1] + dc;
        if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) continue;
        cells.push(`${r},${c}`);
      }
    }
    const plant: SimPlant = {
      id: p.id,
      position: p.position,
      cells,
      buffs,
      has: new Set(),
      isSlot: !!p.isSlot,
      isInert: isEffectInert(p.id),
    };
    plants.push(plant);
    for (const cell of cells) cellToPlant.set(cell, plant);
  }

  /** Neighbouring tiles of a whole plant: other plants, and empty tile keys. */
  const neighbours = (plant: SimPlant): { plants: SimPlant[]; empty: string[] } => {
    const out = { plants: [] as SimPlant[], empty: [] as string[] };
    for (const cell of plant.cells) {
      const [r, c] = cell.split(",").map(Number);
      for (const [dr, dc] of CARDINAL) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= gridSize || nc >= gridSize) continue;
        const key = `${nr},${nc}`;
        const q = cellToPlant.get(key);
        if (q) {
          if (q !== plant && !out.plants.includes(q)) out.plants.push(q);
        } else if (!out.empty.includes(key)) {
          out.empty.push(key);
        }
      }
    }
    return out;
  };

  const give = (plant: SimPlant, payload: Set<string>) => {
    const { plants: near, empty } = neighbours(plant);
    for (const q of near) {
      if (q.isInert) continue;
      for (const e of payload) q.has.add(e);
    }
    for (const key of empty) {
      let set = received.get(key);
      if (!set) {
        set = new Set();
        received.set(key, set);
      }
      for (const e of payload) set.add(e);
    }
  };

  // 1. Direct effects, all at once. Slots give nothing.
  for (const plant of plants) {
    if (plant.isSlot || plant.buffs.intrinsic.size === 0) continue;
    give(plant, plant.buffs.intrinsic);
  }

  // 2. Plants holding effect_spread relay everything else they hold until nothing changes.
  // Worklist: a relay takes another turn only when a neighbouring relay just gave it something new.
  // (A Set visits entries added while iterating, so re-queued relays are picked up.)
  const relays = new Set(plants.filter((p) => !p.isSlot && p.has.has(RELAY_EFFECT)));
  const queue = new Set(relays);
  for (const plant of queue) {
    queue.delete(plant);
    const near = neighbours(plant).plants.filter((q) => relays.has(q));
    const sizes = near.map((q) => q.has.size);
    give(plant, new Set([...plant.has].filter((e) => e !== RELAY_EFFECT)));
    near.forEach((q, i) => q.has.size !== sizes[i] && queue.add(q));
  }

  const heldAt = (row: number, col: number): Set<string> => {
    const key = `${row},${col}`;
    const plant = cellToPlant.get(key);
    if (plant) return new Set(plant.has);
    return new Set(received.get(key) || []);
  };

  const heldOver = (position: [number, number], size: number): Set<string> => {
    const out = new Set<string>();
    for (let dr = 0; dr < size; dr++) {
      for (let dc = 0; dc < size; dc++) {
        for (const e of heldAt(position[0] + dr, position[1] + dc)) out.add(e);
      }
    }
    return out;
  };

  const missingSpecialEffects = (mutationId: string, position: [number, number], size: number): string[] => {
    const required = SPECIAL_EFFECT_SETS[mutationId];
    if (!required) return [];
    const held = heldOver(position, size);
    return required.filter((e) => !held.has(e));
  };

  return {
    heldAt,
    effectiveAt: (row, col) => effectiveEffects(heldAt(row, col)),
    heldOver,
    isSpecialEligible: (mutationId, position, size) =>
      !!SPECIAL_EFFECT_SETS[mutationId] && missingSpecialEffects(mutationId, position, size).length === 0,
    missingSpecialEffects,
  };
}

/** Short multi-line summary for native tooltips. */
export function describeEffects(has: Iterable<string>, gives: Iterable<string>): string {
  const hasList = sortEffects(has).map(getEffectName);
  const givesList = sortEffects(gives).map(getEffectName);
  return [
    `Has: ${hasList.length ? hasList.join(", ") : "nothing"}`,
    `Gives: ${givesList.length ? givesList.join(", ") : "nothing"}`,
  ].join("\n");
}
