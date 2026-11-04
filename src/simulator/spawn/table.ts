import { SPAWN_PRIORITY } from "../config";
import type { GameData, MutationDef } from "../data/types";
import { candidateMutations } from "./candidates";
import { SCALING_QUIRKS } from "./multiplicity";

/**
 * The spawn rules of every mutation compiled once per game data into flat arrays, for the spawn
 * phase's hot loop (sim/tick.ts `phaseSpawn`). Kinds are numbered (`kindIndex`); every kind that
 * isn't in the data (Devourer roots) shares the `other` index, which no requirement names.
 * Same rules as `effectiveWeight` / `multiplicity` (spawn/multiplicity.ts), which stay the
 * reference (Sanity Check uses them; `analysis/sanityCheck.test.ts` checks they agree).
 */
export interface CompiledMutation {
  def: MutationDef;
  /** Position in `data.mutationIds`. */
  order: number;
  size: number;
  ground: string;
  weight: number;
  /** 1 = requires an empty ring (Lonelily), 2 = all positive crop effects (Godseed), 3 = never spawns (no requirements), 0 = requirements. */
  rule: 0 | 1 | 2 | 3;
  reqKinds: Int32Array;
  reqCounts: Int32Array;
  /** Ashwreath-style scaling: kind index, its required count, the count at full weight; else kind -1. */
  scaleKind: number;
  scaleBase: number;
  scaleFull: number;
  /** Has a spawn priority (Godseed, Zombud): the cell's roll goes through `planPool`. */
  priority: boolean;
}

export interface SpawnTable {
  kindIndex: ReadonlyMap<string, number>;
  /** Index shared by kinds that aren't in the data. */
  other: number;
  /** Number of kind indices (`other` + 1). */
  kinds: number;
  byId: ReadonlyMap<string, CompiledMutation>;
  /** `candidateMutations` (spawn/candidates.ts) memoised by the set of kinds present (see `candidatesFor`). */
  candidateCache: Map<string, readonly CompiledMutation[]>;
}

/**
 * `candidateMutations(kinds present, data)` as compiled mutations, memoised on which kinds are
 * present. `present[kind index]` = 1 for every kind standing on the plot.
 */
export function candidatesFor(table: SpawnTable, data: GameData, present: Uint8Array, kindIds: Iterable<string>): readonly CompiledMutation[] {
  let key = "";
  for (let i = 0; i < table.kinds; i++) key += present[i] ? "1" : "0";
  let hit = table.candidateCache.get(key);
  if (!hit) {
    hit = candidateMutations(new Set(kindIds), data).map((m) => table.byId.get(m.id)!);
    table.candidateCache.set(key, hit);
  }
  return hit;
}

const tables = new WeakMap<GameData, SpawnTable>();

export function spawnTable(data: GameData): SpawnTable {
  let t = tables.get(data);
  if (t) return t;
  const kindIndex = new Map<string, number>();
  for (const id of data.cropIds) if (!kindIndex.has(id)) kindIndex.set(id, kindIndex.size);
  for (const id of data.mutationIds) if (!kindIndex.has(id)) kindIndex.set(id, kindIndex.size);
  const other = kindIndex.size;
  const byId = new Map<string, CompiledMutation>();
  data.mutationIds.forEach((id, order) => {
    const m = data.mutations[id];
    const rule = m.special === "requires_zero_adjacent" ? 1 : m.special === "all_positive_crop_effects" ? 2 : m.requirements.length === 0 ? 3 : 0;
    const quirk = SCALING_QUIRKS[m.id];
    const scaling = quirk ? m.requirements.find((r) => r.crop === quirk.scalingCrop) : undefined;
    byId.set(id, {
      def: m,
      order,
      size: m.size,
      ground: m.ground,
      weight: m.spawnWeight,
      rule,
      reqKinds: Int32Array.from(m.requirements.map((r) => kindIndex.get(r.crop) ?? other)),
      reqCounts: Int32Array.from(m.requirements.map((r) => r.count)),
      scaleKind: quirk && scaling ? (kindIndex.get(scaling.crop) ?? other) : -1,
      scaleBase: scaling?.count ?? 0,
      scaleFull: quirk?.fullWeightCount ?? 0,
      priority: SPAWN_PRIORITY[id] !== undefined,
    });
  });
  t = { kindIndex, other, kinds: other + 1, byId, candidateCache: new Map() };
  tables.set(data, t);
  return t;
}

/**
 * `effectiveWeight` (spawn/multiplicity.ts) over compiled rules. `counts[base + kind]`: requirement
 * counts by kind index in the ring (dry plants excluded); `ringOccupied`: anything stands in the ring.
 */
export function compiledWeight(m: CompiledMutation, counts: Int32Array, base: number, ringOccupied: boolean, specialEligible: boolean): number {
  // multiplicity
  let k: number;
  if (m.rule === 1) k = ringOccupied ? 0 : 1;
  else if (m.rule === 2) k = specialEligible ? 1 : 0;
  else if (m.rule === 3) k = 0;
  else {
    k = 1;
    const kinds = m.reqKinds;
    for (let i = 0; i < kinds.length; i++) {
      if (counts[base + kinds[i]] < m.reqCounts[i]) {
        k = 0;
        break;
      }
    }
    if (k > 0 && m.scaleKind >= 0) {
      const full = m.scaleFull - m.scaleBase + 1;
      k = Math.max(1, Math.min(counts[base + m.scaleKind] - m.scaleBase + 1, full));
    }
  }
  // effectiveWeight
  if (k <= 0 || m.weight <= 0) return 0;
  if (m.scaleKind >= 0) return Math.min(m.weight, (m.weight * (m.scaleBase + k - 1)) / m.scaleFull);
  return m.weight;
}
