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

const EFFECT_ORDER: ReadonlyMap<string, number> = new Map(EFFECT_IDS.map((e, i) => [e, i]));
const IMPROVED_PAIRS: ReadonlyArray<readonly [string, string]> = Object.entries(IMPROVED_OF);

/** Stable display order: positives (data.json order) then negatives. */
export function sortEffects(effects: Iterable<string>): string[] {
  return [...new Set(effects)].sort((a, b) => {
    const na = NEGATIVE_EFFECTS.has(a) ? 1 : 0;
    const nb = NEGATIVE_EFFECTS.has(b) ? 1 : 0;
    if (na !== nb) return na - nb;
    return (EFFECT_ORDER.get(a) ?? 99) - (EFFECT_ORDER.get(b) ?? 99);
  });
}

/** The set that matters in game: immunity strips negatives, improved hides base. */
export function effectiveEffects(raw: Iterable<string>): Set<string> {
  const eff = new Set(raw);
  if (eff.has("immunity")) {
    for (const n of NEGATIVE_EFFECTS) eff.delete(n);
  }
  for (const [base, improved] of IMPROVED_PAIRS) {
    if (eff.has(improved)) eff.delete(base);
  }
  return eff;
}

// ---------------------------------------------------------------------------------------------
// Bitmask representation. Every effect any crop or mutation can give gets one bit, assigned in
// display order (`sortEffects`), so a mask's set bits read low to high are already sorted.
// The simulation below runs on masks; the Set/array API around it is unchanged.

const ALL_EFFECTS: readonly string[] = sortEffects([
  ...EFFECT_IDS,
  ...[...Object.values(CROPS), ...Object.values(MUTATIONS)].flatMap((e) => [...(e.positive_buffs || []), ...(e.negative_buffs || [])]),
]);
if (ALL_EFFECTS.length > 31) throw new Error(`effectSimulation: ${ALL_EFFECTS.length} effects do not fit a 31-bit mask`);
const EFFECT_BIT: ReadonlyMap<string, number> = new Map(ALL_EFFECTS.map((e, i) => [e, 1 << i]));
const RELAY_BIT = EFFECT_BIT.get(RELAY_EFFECT) ?? 0;
const IMMUNITY_BIT = EFFECT_BIT.get("immunity") ?? 0;
const NEGATIVE_MASK = ALL_EFFECTS.reduce((m, e, i) => (NEGATIVE_EFFECTS.has(e) ? m | (1 << i) : m), 0);
const IMPROVED_BITS: ReadonlyArray<readonly [number, number]> = IMPROVED_PAIRS.filter(([b, i]) => EFFECT_BIT.has(b) && EFFECT_BIT.has(i)).map(
  ([b, i]) => [EFFECT_BIT.get(b)!, EFFECT_BIT.get(i)!] as const
);

/** Mask of a list of effect ids, or null if one of them has no bit (not a known effect). */
export function effectMask(effects: Iterable<string>): number | null {
  let mask = 0;
  for (const e of effects) {
    const bit = EFFECT_BIT.get(e);
    if (bit === undefined) return null;
    mask |= bit;
  }
  return mask;
}

const listCache = new Map<number, readonly string[]>();
/** `listCache` for masks below 2^12 (every set when there are at most 12 effects), by index. */
const smallLists: (readonly string[] | undefined)[] = [];
const SMALL_MASKS = 1 << 12;
/** `effectList` arrays back to their mask, so those lists convert without a lookup per id. */
const maskOfList = new WeakMap<readonly string[], number>();

/** The effects in a mask, sorted (`sortEffects` order). Shared and frozen: copy before changing it. */
export function effectList(mask: number): readonly string[] {
  const small = mask >= 0 && mask < SMALL_MASKS;
  let out = small ? smallLists[mask] : listCache.get(mask);
  if (!out) {
    const list: string[] = [];
    for (let i = 0; i < ALL_EFFECTS.length; i++) if (mask & (1 << i)) list.push(ALL_EFFECTS[i]);
    out = Object.freeze(list);
    if (small) smallLists[mask] = out;
    else listCache.set(mask, out);
    maskOfList.set(out, mask);
  }
  return out;
}

/** `effectMask`, without a lookup per id for lists made by `effectList`. */
function listMask(raw: Iterable<string>): number | null {
  const known = maskOfList.get(raw as readonly string[]);
  return known !== undefined ? known : effectMask(raw);
}

/** `effectiveEffects` on a mask: immunity strips negatives, improved hides base. */
export function effectiveMask(mask: number): number {
  let m = mask;
  if (m & IMMUNITY_BIT) m &= ~NEGATIVE_MASK;
  for (const [base, improved] of IMPROVED_BITS) if (m & improved) m &= ~base;
  return m;
}

const effectiveListCache = new Map<number, readonly string[]>();

/**
 * `sortEffects(effectiveEffects(raw))`, via masks when every id is a known effect. The result may
 * be a shared, frozen list (one per distinct set): copy it before changing it.
 */
export function effectiveSortedList(raw: Iterable<string>): readonly string[] {
  const mask = listMask(raw);
  if (mask === null) return sortEffects(effectiveEffects(raw));
  let out = effectiveListCache.get(mask);
  if (!out) {
    out = effectList(effectiveMask(mask));
    effectiveListCache.set(mask, out);
  }
  return out;
}

const intrinsicMaskCache = new Map<string, number>();

/** Mask of what a kind gives its neighbours (0 for unknown kinds and inert scenery). */
function intrinsicMask(id: string): number {
  let m = intrinsicMaskCache.get(id);
  if (m === undefined) {
    const b = getPlantBuffs(id);
    m = b ? (effectMask(b.intrinsic) ?? 0) : 0;
    intrinsicMaskCache.set(id, m);
  }
  return m;
}

const specialMaskCache = new Map<string, number | null>();
/** Mask of a special mutation's required effects; null if one has no bit (can never be held). */
function specialMask(mutationId: string): number | null {
  let m = specialMaskCache.get(mutationId);
  if (m === undefined) {
    m = effectMask(SPECIAL_EFFECT_SETS[mutationId] ?? []);
    specialMaskCache.set(mutationId, m);
  }
  return m;
}

export interface SimPlacement {
  id: string;
  position: [number, number];
  size: number;
  /** A mutation slot: receives effects but never gives any. */
  isSlot?: boolean;
}

export interface EffectSimulation {
  /** Raw held set of the plant covering the cell (whole entity), or what an empty cell received. */
  heldAt(row: number, col: number): Set<string>;
  /** `heldAt` as a mask (`effectList` turns it into the sorted list). Off the grid: 0. */
  heldMaskAt(row: number, col: number): number;
  /** heldAt after immunity / improved-override rules. */
  effectiveAt(row: number, col: number): Set<string>;
  /** Union of what the given cells hold / received (a candidate multi-cell spot). */
  heldOver(position: [number, number], size: number): Set<string>;
  /** Godseed rule: does the spot hold every effect in the mutation's required set? */
  isSpecialEligible(mutationId: string, position: [number, number], size: number): boolean;
  /** Which required effects a spot is missing (empty list = eligible). */
  missingSpecialEffects(mutationId: string, position: [number, number], size: number): string[];
}

/**
 * Plants for `computeEffectMasks`, as parallel arrays (index = plant). Callers may reuse one
 * instance between calls; only the first `count` entries are read.
 */
export interface EffectInput {
  count: number;
  /** Kind id (crop or mutation id). */
  kinds: string[];
  rows: Int32Array;
  cols: Int32Array;
  sizes: Int32Array;
  /** 1 = a slot or dried-out plant: receives effects but never gives or relays any. */
  slots: Uint8Array;
  /**
   * Optional, per plant: what it gives (`kindEffectInfo(kind).gives`) and whether it is inert
   * scenery (1). Filled by callers that know them; otherwise looked up from `kinds`.
   */
  gives?: Int32Array;
  inert?: Uint8Array;
}

/** An `EffectInput` with room for `capacity` plants (grow with `growEffectInput`). */
export function newEffectInput(capacity = 128): EffectInput {
  return {
    count: 0,
    kinds: [],
    rows: new Int32Array(capacity),
    cols: new Int32Array(capacity),
    sizes: new Int32Array(capacity),
    slots: new Uint8Array(capacity),
    gives: new Int32Array(capacity),
    inert: new Uint8Array(capacity),
  };
}

/** Make sure `input` can hold `n` plants (keeps nothing: call before filling it). */
export function growEffectInput(input: EffectInput, n: number): void {
  if (input.rows.length >= n) return;
  const cap = Math.max(n, input.rows.length * 2);
  input.rows = new Int32Array(cap);
  input.cols = new Int32Array(cap);
  input.sizes = new Int32Array(cap);
  input.slots = new Uint8Array(cap);
  if (input.gives) input.gives = new Int32Array(cap);
  if (input.inert) input.inert = new Uint8Array(cap);
}

/** What one kind contributes to the effect simulation, looked up once per kind id. */
export interface KindEffectInfo {
  /** Mask of what it gives its neighbours (0 for unknown kinds and inert scenery). */
  gives: number;
  /** Inert scenery (fire): never holds or relays anything. */
  inert: boolean;
}
const kindInfoCache = new Map<string, KindEffectInfo>();
export function kindEffectInfo(id: string): KindEffectInfo {
  let info = kindInfoCache.get(id);
  if (!info) {
    info = { gives: intrinsicMask(id), inert: isEffectInert(id) };
    kindInfoCache.set(id, info);
  }
  return info;
}

// Working buffers of `computeEffectMasks` (synchronous, so one set is enough).
let cellPlantBuf = new Int32Array(0);
let receivedBuf = new Int32Array(0);
let hasBuf = new Int32Array(0);
let flagBuf = new Uint8Array(0);
const queueBuf: number[] = [];
const FLAG_SLOT = 1;
const FLAG_INERT = 2;
const FLAG_RELAY = 4;
const FLAG_QUEUED = 8;

/**
 * The core of the effect simulation, on bitmasks: per cell of a `gridSize` x `gridSize` grid, the
 * raw held mask of the plant covering it (the whole entity), or what an empty cell received.
 * A later plant wins a shared cell. `out` (length >= gridSize^2) is filled and returned.
 *
 * Rules (port of solver/effects.py):
 * 1. Every plant that isn't a slot gives its intrinsic effects to each cardinal neighbour: other
 *    plants (whole entity, never itself; inert scenery receives nothing) and empty cells.
 * 2. Plants holding effect_spread (not slots) relay everything else they hold the same way, until
 *    nothing changes. A worklist: a relay takes another turn only when a neighbouring relay just
 *    gave it something new. Every give is a union and the set of relays can't change during the
 *    pass, so any order ends at the same fixed point.
 * Gives go cell by cell; giving the same plant or cell twice changes nothing (a union).
 */
export function computeEffectMasks(input: EffectInput, gridSize: number, out: Int32Array): Int32Array {
  const n = input.count;
  const total = gridSize * gridSize;
  if (cellPlantBuf.length < total) {
    cellPlantBuf = new Int32Array(total);
    receivedBuf = new Int32Array(total);
  }
  if (hasBuf.length < n) {
    hasBuf = new Int32Array(Math.max(n, hasBuf.length * 2, 64));
    flagBuf = new Uint8Array(hasBuf.length);
  }
  const cellPlant = cellPlantBuf;
  const received = receivedBuf;
  const has = hasBuf;
  const flags = flagBuf;
  cellPlant.fill(0, 0, total);
  received.fill(0, 0, total);
  const { kinds, rows, cols, sizes, slots } = input;
  // Per-plant gives / inert: from the caller when given, else looked up by kind.
  const givesIn = input.gives;
  const inertIn = input.inert;
  const known = givesIn !== undefined && inertIn !== undefined;

  for (let i = 0; i < n; i++) {
    has[i] = 0;
    const inert = known ? inertIn[i] === 1 : isEffectInert(kinds[i]);
    flags[i] = (slots[i] ? FLAG_SLOT : 0) | (inert ? FLAG_INERT : 0);
    const r0 = rows[i];
    const c0 = cols[i];
    const size = sizes[i];
    for (let dr = 0; dr < size; dr++) {
      const r = r0 + dr;
      if (r < 0 || r >= gridSize) continue;
      for (let dc = 0; dc < size; dc++) {
        const c = c0 + dc;
        if (c < 0 || c >= gridSize) continue;
        cellPlant[r * gridSize + c] = i + 1;
      }
    }
  }

  /** Give `payload` from plant `i` to its cardinal neighbours. `relayTurn`: queue relays that gained something. */
  const give = (i: number, payload: number, relayTurn: boolean) => {
    const r0 = rows[i];
    const c0 = cols[i];
    const size = sizes[i];
    for (let dr = 0; dr < size; dr++) {
      const r = r0 + dr;
      if (r < 0 || r >= gridSize) continue;
      for (let dc = 0; dc < size; dc++) {
        const c = c0 + dc;
        if (c < 0 || c >= gridSize) continue;
        for (let d = 0; d < 4; d++) {
          const nr = d === 0 ? r - 1 : d === 1 ? r + 1 : r;
          const nc = d === 2 ? c - 1 : d === 3 ? c + 1 : c;
          if (nr < 0 || nc < 0 || nr >= gridSize || nc >= gridSize) continue;
          const key = nr * gridSize + nc;
          const q = cellPlant[key] - 1;
          if (q < 0) {
            received[key] |= payload;
            continue;
          }
          if (q === i || flags[q] & FLAG_INERT) continue;
          const before = has[q];
          const after = before | payload;
          if (after === before) continue;
          has[q] = after;
          if (relayTurn && (flags[q] & (FLAG_RELAY | FLAG_QUEUED)) === FLAG_RELAY) {
            flags[q] |= FLAG_QUEUED;
            queueBuf.push(q);
          }
        }
      }
    }
  };

  // 1. Direct effects, all at once. Slots give nothing.
  for (let i = 0; i < n; i++) {
    if (flags[i] & FLAG_SLOT) continue;
    const mask = known ? givesIn[i] : intrinsicMask(kinds[i]);
    if (mask) give(i, mask, false);
  }

  // 2. Relays.
  queueBuf.length = 0;
  for (let i = 0; i < n; i++) {
    if (flags[i] & FLAG_SLOT || !(has[i] & RELAY_BIT)) continue;
    flags[i] |= FLAG_RELAY | FLAG_QUEUED;
    queueBuf.push(i);
  }
  for (let head = 0; head < queueBuf.length; head++) {
    const i = queueBuf[head];
    flags[i] &= ~FLAG_QUEUED;
    give(i, has[i] & ~RELAY_BIT, true);
  }
  queueBuf.length = 0;

  for (let key = 0; key < total; key++) {
    const q = cellPlant[key] - 1;
    out[key] = q >= 0 ? has[q] : received[key];
  }
  return out;
}

/** The effect simulation of a list of placements (later placements win a shared cell). */
export function simulateEffects(placements: SimPlacement[], gridSize = 10): EffectSimulation {
  const input = newEffectInput(Math.max(1, placements.length));
  delete input.gives; // looked up from the kinds
  delete input.inert;
  input.count = placements.length;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    input.kinds.push(p.id);
    input.rows[i] = p.position[0];
    input.cols[i] = p.position[1];
    input.sizes[i] = p.size;
    input.slots[i] = p.isSlot ? 1 : 0;
  }
  return effectSimulationOf(computeEffectMasks(input, gridSize, new Int32Array(gridSize * gridSize)), gridSize);
}

/** The `EffectSimulation` view over per-cell held masks (`computeEffectMasks`). Keeps `cellMasks`: don't reuse it. */
export function effectSimulationOf(cellMasks: Int32Array, gridSize = 10): EffectSimulation {
  const heldMaskAt = (row: number, col: number): number => {
    if (row < 0 || col < 0 || row >= gridSize || col >= gridSize) return 0;
    return cellMasks[row * gridSize + col];
  };

  const heldMaskOver = (position: [number, number], size: number): number => {
    let out = 0;
    for (let dr = 0; dr < size; dr++) {
      for (let dc = 0; dc < size; dc++) out |= heldMaskAt(position[0] + dr, position[1] + dc);
    }
    return out;
  };

  const heldAt = (row: number, col: number): Set<string> => new Set(effectList(heldMaskAt(row, col)));

  const heldOver = (position: [number, number], size: number): Set<string> => new Set(effectList(heldMaskOver(position, size)));

  const missingSpecialEffects = (mutationId: string, position: [number, number], size: number): string[] => {
    const required = SPECIAL_EFFECT_SETS[mutationId];
    if (!required) return [];
    const held = heldMaskOver(position, size);
    return required.filter((e) => !(held & (EFFECT_BIT.get(e) ?? 0)));
  };

  return {
    heldAt,
    heldMaskAt,
    effectiveAt: (row, col) => effectiveEffects(heldAt(row, col)),
    heldOver,
    isSpecialEligible: (mutationId, position, size) => {
      if (!SPECIAL_EFFECT_SETS[mutationId]) return false;
      const req = specialMask(mutationId);
      return req !== null && (heldMaskOver(position, size) & req) === req;
    },
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
