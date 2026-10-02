import { recomputeEffects } from "../effects/adapter";
import type { GameData, KindId, MutationDef, MutationId } from "../data/types";
import { cellIndex, footprint, footprintFits, GRID_SIZE, inBounds, ringCells } from "../grid/cells";
import { candidateMutations } from "../spawn/candidates";
import { locationOpenFor, ringCounts, type RingCounts } from "../spawn/eligibility";
import { effectiveWeight, isAllPositiveSpecial, requiresZeroAdjacent } from "../spawn/multiplicity";
import { applyMutationChanceBonus, poolDenominator, type SpawnPool } from "../spawn/pool";
import { buildOccupancy, isDry, isFootprintFree, removePlant, type Occupancy } from "../sim/plants";
import type { PlantState, PlotId, SimulationState } from "../sim/state";

// Sanity Check (Plant Diagnostics Tool): which mutations can spawn at one cell.
// Read-only: draws no RNG, never writes `state` (works on a cloned plot), never
// calls creditInputs. Mirrors `phaseSpawn` (sim/tick.ts) through the same
// helpers, so the reported chance is the next roll's. Entries are in data.json
// order, not ranked.

/** A plant standing on (or in the way of) the checked footprint. */
export interface SanityOccupant {
  kindId: KindId;
  row: number;
  col: number;
  size: number;
  isDeadPlant: boolean;
  /** Halted: occupies the cell but doesn't count toward requirements. */
  dry: boolean;
}

/** Why a mutation can't spawn here. Check order: footprint, ground, mutation rules. */
export type SanityBlocker =
  /** The footprint hangs off the plot. */
  | { kind: "outOfBounds" }
  /** Part of the footprint is covered by something. */
  | { kind: "occupied"; by: SanityOccupant[] }
  /** Footprint cells whose ground is not the one the mutation needs. */
  | { kind: "ground"; needed: string; wrong: { row: number; col: number; have: string | null }[] }
  /** A requirement is short; `dry` plants in the ring don't count. */
  | { kind: "requirement"; crop: KindId; needed: number; have: number; dry: number }
  /** Lonelily: anything in the ring blocks it, including dry plants, Dead Plants and roots. */
  | { kind: "ringNotEmpty"; occupants: SanityOccupant[] }
  /** Godseed: effects the spot does not receive (EffectIds). */
  | { kind: "missingEffects"; effects: string[] }
  /** Not in the plot's spawn pool: a required kind isn't on the plot. */
  | { kind: "notCandidate" }
  /** Unexplained by the above (unmodelled special rule). */
  | { kind: "noWeight" };

export interface SanityRequirement {
  crop: KindId;
  needed: number;
  /** Counting ring cells of that crop (halted excluded). */
  have: number;
  /** Halted ring cells of that crop (not counted). */
  dry: number;
}

export type SanityFootprint = "fits" | "outOfBounds" | "occupied";

export interface SanityEntry {
  mutationId: MutationId;
  size: number;
  /** Pool membership: candidate (all required kinds on the plot), the slot's target, or no. */
  pool: "candidate" | "slotTarget" | "no";
  footprint: SanityFootprint;
  /** Plants covering the footprint (when `footprint` is "occupied"). */
  blockedBy: SanityOccupant[];
  ground: {
    needed: string;
    ok: boolean;
    wrong: { row: number; col: number; have: string | null }[];
  };
  /** Per requirement; empty when the footprint is off the plot (no ring). */
  requirements: SanityRequirement[];
  /** Lonelily: ring occupants. Null for other mutations. */
  ring: SanityOccupant[] | null;
  /** Godseed: effects the spot does not receive. Null for other mutations. */
  missingEffects: string[] | null;
  canSpawn: boolean;
  /** Weight in the spawn pool after Bioanalysis (0 when it can't spawn). */
  weight: number;
  /** Chance per spawn roll: weight / max(SPAWN_POOL_FLOOR, sum of weights over the pool). 0 when it can't spawn. */
  chance: number;
  /** Blocking reasons in check order. Empty when it can spawn. */
  blockers: SanityBlocker[];
  /** Display aid: total missing (requirement cells, wrong ground, footprint, ring occupants, effects). */
  missingCount: number;
}

export interface SanityCheckResult {
  plotId: PlotId;
  row: number;
  col: number;
  /** What stands on the cell; entries assume it was removed. */
  occupied: SanityOccupant | null;
  /** The labelled slot's target, when the cell is a slot anchor. */
  slotTarget: MutationId | null;
  /** Sum of pool weights after Bioanalysis. */
  totalWeight: number;
  /** max(SPAWN_POOL_FLOOR, totalWeight). */
  denominator: number;
  /** Chance a roll spawns anything: totalWeight / denominator. */
  anyChance: number;
  /** Every mutation with a spawn weight, plus the slot's target, in data.json order. */
  entries: SanityEntry[];
  /** Entries in the pool. */
  canSpawn: SanityEntry[];
  /** Entries not in the pool, with blockers. */
  cannot: SanityEntry[];
}

const occupantOf = (p: PlantState): SanityOccupant => ({
  kindId: p.kindId,
  row: p.row,
  col: p.col,
  size: p.size,
  isDeadPlant: p.isDeadPlant,
  dry: isDry(p),
});

/** Distinct plants (anchor order) covering any of these cell indices. */
function plantsAt(occ: Occupancy, cells: readonly number[]): PlantState[] {
  const seen: PlantState[] = [];
  for (const idx of cells) {
    const q = occ[idx];
    if (q && !seen.includes(q)) seen.push(q);
  }
  return seen;
}

/** What the next spawn roll with anchor (top-left) (row, col) would offer. Config and Bioanalysis from scenario settings. */
export function sanityCheck(state: SimulationState, data: GameData, plotId: PlotId, row: number, col: number): SanityCheckResult {
  const live = state.plots.find((p) => p.id === plotId);
  if (!live) throw new RangeError(`Sanity Check: no plot ${plotId}`);
  if (!inBounds(row, col)) throw new RangeError(`Sanity Check: (${row}, ${col}) is off the plot`);
  const { playerStats } = state.scenario.settings;

  // Private copy: the effect simulation writes `held` into plants.
  const plot = structuredClone(live);
  let occupied: SanityOccupant | null = null;
  const standing = buildOccupancy(plot)[cellIndex(row, col)];
  if (standing) {
    occupied = occupantOf(standing);
    removePlant(plot, standing);
  }
  const occ = buildOccupancy(plot);
  const effects = recomputeEffects(plot);

  // Pool membership, as in phaseSpawn.
  const candidates = candidateMutations(new Set(plot.plants.map((p) => p.kindId)), data);
  const slot = plot.slots.find((s) => s.row === row && s.col === col) ?? null;
  const target = slot ? data.mutations[slot.mutationId] : undefined;
  const poolMuts = target && !candidates.includes(target) ? [...candidates, target] : candidates;

  const ringBySize = new Map<number, RingCounts>();
  const pool: SpawnPool = { ids: [], weights: [] };
  for (const m of poolMuts) {
    if (!locationOpenFor(plot, occ, row, col, m)) continue;
    let ring = ringBySize.get(m.size);
    if (!ring) {
      ring = ringCounts(occ, row, col, m.size);
      ringBySize.set(m.size, ring);
    }
    const special = isAllPositiveSpecial(m) ? effects.isSpecialEligible(m.id, [row, col], m.size) : undefined;
    const w = effectiveWeight(m, ring, special);
    if (w > 0) {
      pool.ids.push(m.id);
      pool.weights.push(w);
    }
  }
  const boosted = applyMutationChanceBonus(pool, playerStats.mutationChanceBonus);
  const denominator = poolDenominator(boosted.weights);
  const totalWeight = boosted.weights.reduce((a, b) => a + b, 0);

  const entries: SanityEntry[] = [];
  for (const id of data.mutationIds) {
    const m = data.mutations[id];
    if (m.spawnWeight <= 0 && m !== target) continue;
    const i = boosted.ids.indexOf(id);
    const weight = i >= 0 ? boosted.weights[i] : 0;
    entries.push(
      entryFor(m, {
        plot,
        occ,
        row,
        col,
        effects,
        poolKind: m === target && !candidates.includes(m) ? "slotTarget" : candidates.includes(m) ? "candidate" : "no",
        weight,
        chance: weight / denominator,
        ring: ringBySize.get(m.size),
      })
    );
  }

  return {
    plotId,
    row,
    col,
    occupied,
    slotTarget: slot?.mutationId ?? null,
    totalWeight,
    denominator,
    anyChance: totalWeight / denominator,
    entries,
    canSpawn: entries.filter((e) => e.canSpawn),
    cannot: entries.filter((e) => !e.canSpawn),
  };
}

interface EntryCtx {
  plot: SimulationState["plots"][number];
  occ: Occupancy;
  row: number;
  col: number;
  effects: ReturnType<typeof recomputeEffects>;
  poolKind: SanityEntry["pool"];
  weight: number;
  chance: number;
  /** Ring computed for this size, if any. */
  ring: RingCounts | undefined;
}

function entryFor(m: MutationDef, c: EntryCtx): SanityEntry {
  const { plot, occ, row, col } = c;
  const fits = footprintFits(row, col, m.size);
  const cells = fits ? footprint(row, col, m.size) : [];
  const blockedBy = fits && !isFootprintFree(occ, row, col, m.size) ? plantsAt(occ, cells).map((p) => occupantOf(p)) : [];
  const footprintStatus: SanityFootprint = !fits ? "outOfBounds" : blockedBy.length > 0 ? "occupied" : "fits";

  const wrong: { row: number; col: number; have: string | null }[] = [];
  for (let dr = 0; dr < m.size; dr++) {
    for (let dc = 0; dc < m.size; dc++) {
      const r = row + dr;
      const cc = col + dc;
      if (r >= GRID_SIZE || cc >= GRID_SIZE) continue;
      const key = `${r},${cc}`;
      const have = plot.groundOverrides[key] ?? plot.groundTiles[key] ?? null;
      if (have !== m.ground) wrong.push({ row: r, col: cc, have });
    }
  }
  const groundOk = wrong.length === 0; // same rule as `groundFits`, per cell (pinned by tests)

  // The ring exists only when the footprint is on the plot.
  const ring = fits ? (c.ring ?? ringCounts(occ, row, col, m.size)) : null;
  const ringPlants = fits ? plantsAt(occ, ringCells(row, col, m.size)) : [];
  const dryByKind: Record<string, number> = {};
  if (fits) {
    for (const idx of ringCells(row, col, m.size)) {
      const q = occ[idx];
      if (q && isDry(q)) dryByKind[q.kindId] = (dryByKind[q.kindId] ?? 0) + 1;
    }
  }
  const requirements: SanityRequirement[] = ring
    ? m.requirements.map((r) => ({ crop: r.crop, needed: r.count, have: ring.counts[r.crop] ?? 0, dry: dryByKind[r.crop] ?? 0 }))
    : [];

  const isLonelily = requiresZeroAdjacent(m);
  const ringOccupants = isLonelily && ring ? ringPlants.map((p) => occupantOf(p)) : isLonelily ? [] : null;
  const missingEffects =
    isAllPositiveSpecial(m) && fits ? c.effects.missingSpecialEffects(m.id, [row, col], m.size) : isAllPositiveSpecial(m) ? [] : null;

  const blockers: SanityBlocker[] = [];
  if (!fits) blockers.push({ kind: "outOfBounds" });
  else if (blockedBy.length > 0) blockers.push({ kind: "occupied", by: blockedBy });
  if (!groundOk) blockers.push({ kind: "ground", needed: m.ground, wrong });
  if (ring) {
    if (isLonelily && ring.ringOccupied) blockers.push({ kind: "ringNotEmpty", occupants: ringOccupants ?? [] });
    if (missingEffects && missingEffects.length > 0) blockers.push({ kind: "missingEffects", effects: missingEffects });
    if (!isLonelily && !isAllPositiveSpecial(m)) {
      for (const r of requirements) if (r.have < r.needed) blockers.push({ kind: "requirement", ...r });
    }
  }

  // The pool is authoritative.
  const canSpawn = c.weight > 0;
  if (!canSpawn && blockers.length === 0) blockers.push(c.poolKind === "no" ? { kind: "notCandidate" } : { kind: "noWeight" });
  if (canSpawn) blockers.length = 0;

  let missingCount = 0;
  for (const b of blockers) {
    if (b.kind === "requirement") missingCount += b.needed - b.have;
    else if (b.kind === "ground") missingCount += b.wrong.length;
    else if (b.kind === "ringNotEmpty") missingCount += Math.max(1, b.occupants.length);
    else if (b.kind === "missingEffects") missingCount += b.effects.length;
    else missingCount += 1;
  }

  return {
    mutationId: m.id,
    size: m.size,
    pool: c.poolKind,
    footprint: footprintStatus,
    blockedBy,
    ground: { needed: m.ground, ok: groundOk, wrong },
    requirements,
    ring: ringOccupants,
    missingEffects,
    canSpawn,
    weight: canSpawn ? c.weight : 0,
    chance: canSpawn ? c.chance : 0,
    blockers,
    missingCount,
  };
}
