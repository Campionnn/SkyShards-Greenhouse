/**
 * Crop effect propagation - a TypeScript port of the API's solver/effects.py.
 *
 * Game rules (measured in game; see the API docstring for the evidence):
 * 1. Direct effects: every plant gives its listed buffs (positive + negative)
 *    to its four cardinal neighbours, all at once. Nothing holds its own
 *    listed buffs.
 * 2. Relays: every plant that now HOLDS effect_spread - it stands next to
 *    something listing it, such as a wild rose - gets exactly one turn, and
 *    on it gives everything it holds (except effect_spread) to its
 *    neighbours. What it receives after its turn is not passed on. A lone
 *    rose relays nothing; the plants next to it do.
 * 3. Turn order is Java HashMap iteration: slot (13 * column + row) % table,
 *    ascending, ties by row then column. The table starts at 16 and doubles
 *    whenever the relay count exceeds 75% of it, so 13, 25, 49 and 97 relays
 *    each reorder every turn on the plot.
 * - Effects are a set. Immunity cancels negatives for the plant that holds
 *   it (it still relays them). improved_x hides x.
 * - A multi-cell plant is one entity: one shared effect set, one turn keyed
 *   at its top-left position.
 * - A mutation SLOT (a solver target / a designer target) gives nothing and
 *   never relays: it marks where the mutation *can* spawn, not a plant
 *   standing there. Slots still receive - that is what gets scored. A
 *   mutation placed as an input crop, or locked onto the grid, is a real
 *   plant and does give.
 * - Godseed (special "all_positive_crop_effects") has no crop requirements:
 *   a spot is eligible when its (empty) cells receive every positive effect
 *   godseed lists - the slot rule above, applied to eligibility.
 * Unlike the API simulator, this one also records what EMPTY tiles receive
 * (the designer shows godseed candidate spots); empty tiles never relay.
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

// Relay turn order = Java HashMap iteration over positions.
export const RELAY_HASH_COLUMN_FACTOR = 13;
export const RELAY_TABLE_INITIAL = 16;
export const RELAY_TABLE_LOAD_FACTOR = 0.75;

/** HashMap capacity holding `count` relays: 16, doubled past 75% full. */
export function relayTableSize(count: number): number {
  let table = RELAY_TABLE_INITIAL;
  while (count > RELAY_TABLE_LOAD_FACTOR * table) table *= 2;
  return table;
}

/** A relay's hash slot for its turn (ties then go by row, then column). */
export function relaySlot(position: [number, number], table: number): number {
  return (RELAY_HASH_COLUMN_FACTOR * position[1] + position[0]) % table;
}

const buffCache = new Map<string, PlantBuffs | undefined>();

export function getPlantBuffs(id: string): PlantBuffs | undefined {
  if (buffCache.has(id)) return buffCache.get(id);
  const entry = CROPS[id] || MUTATIONS[id];
  let out: PlantBuffs | undefined;
  if (entry) {
    const listed = [...(entry.positive_buffs || []), ...(entry.negative_buffs || [])];
    out = {
      intrinsic: new Set(listed),
      spreads: listed.includes(RELAY_EFFECT),
    };
  }
  buffCache.set(id, out);
  return out;
}

/**
 * Effects a plant gives to its cardinal neighbours (its listed buffs).
 * A slot gives nothing - see the module docstring.
 */
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
  /** Positions of the relays, in the order they took their turn. */
  relayOrder: Array<[number, number]>;
  /** HashMap table size that produced that order. */
  relayTable: number;
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
    const plant: SimPlant = { id: p.id, position: p.position, cells, buffs, has: new Set(), isSlot: !!p.isSlot };
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
    for (const q of near) for (const e of payload) q.has.add(e);
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

  // 2-3. One relay turn per plant holding effect_spread, in HashMap order.
  const relays = plants.filter((p) => !p.isSlot && p.has.has(RELAY_EFFECT));
  const relayTable = relayTableSize(relays.length);
  relays.sort((a, b) =>
    relaySlot(a.position, relayTable) - relaySlot(b.position, relayTable) ||
    a.position[0] - b.position[0] ||
    a.position[1] - b.position[1]
  );
  for (const plant of relays) {
    const payload = new Set([...plant.has].filter((e) => e !== RELAY_EFFECT));
    if (payload.size > 0) give(plant, payload);
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
    relayOrder: relays.map((p) => p.position),
    relayTable,
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
