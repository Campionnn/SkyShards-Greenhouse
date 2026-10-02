import { recomputeEffects } from "../effects/adapter";
import type { GameData, KindId, MutationDef, MutationId } from "../data/types";
import { cellIndex, footprint, footprintFits, GRID_SIZE, inBounds, ringCells } from "../grid/cells";
import { candidateMutations } from "../spawn/candidates";
import { locationOpenFor, ringCounts, type RingCounts } from "../spawn/eligibility";
import { effectiveWeight, isAllPositiveSpecial, requiresZeroAdjacent } from "../spawn/multiplicity";
import { applyMutationChanceBonus, poolDenominator, type SpawnPool } from "../spawn/pool";
import { buildOccupancy, isDry, isFootprintFree, removePlant, type Occupancy } from "../sim/plants";
import type { PlantState, PlotId, SimulationState } from "../sim/state";

// Sanity Check: "which mutations can grow in this spot?" (the 0.27.2 Plant
// Diagnostics Tool ability). A pure, read-only EVALUATION of one cell:
// - no RNG is drawn and `state` is never written (the plot is cloned before
//   anything that writes plant fields, e.g. the effect simulation);
// - it mirrors `phaseSpawn` (sim/tick.ts) for that cell as the anchor, through
//   the same helpers (candidateMutations, locationOpenFor, ringCounts,
//   effectiveWeight, applyMutationChanceBonus, poolDenominator), so the chance
//   it reports is the chance the next spawn roll uses;
// - it never calls creditInputs and never ranks anything: entries come back in
//   data.json order.

/** A plant standing on (or in the way of) the checked footprint. */
export interface SanityOccupant {
  kindId: KindId;
  row: number;
  col: number;
  size: number;
  isDeadPlant: boolean;
  /** Dried out (halted): it doesn't count toward requirements but is still there. */
  dry: boolean;
}

/** Why one mutation can't spawn at the checked cell. Listed in check order: footprint, ground, then the mutation's own rules. */
export type SanityBlocker =
  /** The footprint hangs off the plot. */
  | { kind: "outOfBounds" }
  /** Part of the footprint is covered by something. */
  | { kind: "occupied"; by: SanityOccupant[] }
  /** Footprint cells whose ground is not the one the mutation needs. */
  | { kind: "ground"; needed: string; wrong: { row: number; col: number; have: string | null }[] }
  /** A listed requirement is short. `dry` plants of that crop stand in the ring but don't count. */
  | { kind: "requirement"; crop: KindId; needed: number; have: number; dry: number }
  /** Lonelily: anything at all in the ring (dry plants, Dead Plants and roots included) blocks it. */
  | { kind: "ringNotEmpty"; occupants: SanityOccupant[] }
  /** Godseed: effects the spot does not receive (EffectIds). */
  | { kind: "missingEffects"; effects: string[] }
  /** Not part of the plot's spawn pool: a kind it needs doesn't stand on the plot at all. */
  | { kind: "notCandidate" }
  /** Nothing above explains it (an unmodelled special rule). */
  | { kind: "noWeight" };

export interface SanityRequirement {
  crop: KindId;
  needed: number;
  /** Cells of that crop in the ring that count (dried-out plants excluded). */
  have: number;
  /** Cells of that crop in the ring that are dried out, so are NOT counted. */
  dry: number;
}

export type SanityFootprint = "fits" | "outOfBounds" | "occupied";

export interface SanityEntry {
  mutationId: MutationId;
  size: number;
  /** Whether the plot's spawn pool considers it at all: a coarse candidate (all required kinds stand on the plot) or the slot's target. */
  pool: "candidate" | "slotTarget" | "no";
  footprint: SanityFootprint;
  /** Plants covering part of the footprint (only when `footprint` is "occupied"). */
  blockedBy: SanityOccupant[];
  ground: {
    needed: string;
    ok: boolean;
    wrong: { row: number; col: number; have: string | null }[];
  };
  /** Per listed requirement; empty when the footprint is off the plot (the ring is then undefined). */
  requirements: SanityRequirement[];
  /** Lonelily: what stands in the ring (empty list = the ring is empty). Null for every other mutation. */
  ring: SanityOccupant[] | null;
  /** Godseed: effects the spot does not receive. Null for every other mutation. */
  missingEffects: string[] | null;
  canSpawn: boolean;
  /** Weight in the spawn pool after Bioanalysis (0 when it can't spawn). */
  weight: number;
  /** Chance per spawn roll: weight / max(blankFillTo, sum of weights over the pool). 0 when it can't spawn. */
  chance: number;
  /** Every blocking reason, first one first. Empty when it can spawn. */
  blockers: SanityBlocker[];
  /** How much is missing in total (requirement cells short + wrong ground cells + footprint problem + ring occupants + missing effects). A display aid. */
  missingCount: number;
}

export interface SanityCheckResult {
  plotId: PlotId;
  row: number;
  col: number;
  /** Set when something stands on the cell. The entries then assume it was removed ("once this cell is free"). */
  occupied: SanityOccupant | null;
  /** The labelled slot's target, when the cell is a slot anchor. */
  slotTarget: MutationId | null;
  /** Does this cell roll for a spawn at all? False in "slots only" spawn mode for a cell that isn't a slot. */
  rolls: boolean;
  noRollReason: string | null;
  /** Sum of the pool weights (after Bioanalysis); the roll's denominator is `denominator`. */
  totalWeight: number;
  /** max(blankFillTo, totalWeight). */
  denominator: number;
  /** Chance that a roll here spawns anything: totalWeight / denominator. */
  anyChance: number;
  /** Every mutation that has a spawn weight (plus the slot's target), in data.json order. Not ranked. */
  entries: SanityEntry[];
  /** The entries that would be in the pool, in data.json order. */
  canSpawn: SanityEntry[];
  /** The rest, in data.json order, each with its blockers. */
  cannot: SanityEntry[];
}

const occupantOf = (p: PlantState, config: { haltWater: number }): SanityOccupant => ({
  kindId: p.kindId,
  row: p.row,
  col: p.col,
  size: p.size,
  isDeadPlant: p.isDeadPlant,
  dry: isDry(p, config),
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

/**
 * What would the next spawn roll at (row, col) offer? `row`/`col` is the
 * anchor (top-left) of the footprint, as in `phaseSpawn`. Pure and read-only.
 * The config and the Bioanalysis bonus come from `state.scenario.settings`.
 */
export function sanityCheck(state: SimulationState, data: GameData, plotId: PlotId, row: number, col: number): SanityCheckResult {
  const live = state.plots.find((p) => p.id === plotId);
  if (!live) throw new RangeError(`Sanity Check: no plot ${plotId}`);
  if (!inBounds(row, col)) throw new RangeError(`Sanity Check: (${row}, ${col}) is off the plot`);
  const { config, playerStats } = state.scenario.settings;

  // Work on a private copy: the effect simulation writes `held` into plants.
  const plot = structuredClone(live);
  let occupied: SanityOccupant | null = null;
  const standing = buildOccupancy(plot)[cellIndex(row, col)];
  if (standing) {
    occupied = occupantOf(standing, config);
    removePlant(plot, standing); // "once this cell is free": occupancy, kinds and effects all lose it
  }
  const occ = buildOccupancy(plot);
  const effects = recomputeEffects(plot, config);

  // The pool's membership, exactly as phaseSpawn builds it.
  const candidates = candidateMutations(new Set(plot.plants.map((p) => p.kindId)), data);
  const slot = plot.slots.find((s) => s.row === row && s.col === col) ?? null;
  const target = slot ? data.mutations[slot.mutationId] : undefined;
  const poolMuts = target && !candidates.includes(target) ? [...candidates, target] : candidates;

  const rolls = config.spawnCells !== "slotsOnly" || !!slot;
  const ringBySize = new Map<number, RingCounts>();
  const pool: SpawnPool = { ids: [], weights: [] };
  for (const m of poolMuts) {
    if (!locationOpenFor(plot, occ, row, col, m)) continue;
    let ring = ringBySize.get(m.size);
    if (!ring) {
      ring = ringCounts(occ, row, col, m.size, config);
      ringBySize.set(m.size, ring);
    }
    const special = isAllPositiveSpecial(m) ? effects.isSpecialEligible(m.id, [row, col], m.size) : undefined;
    const w = effectiveWeight(m, ring, config, special);
    if (w > 0) {
      pool.ids.push(m.id);
      pool.weights.push(w);
    }
  }
  const boosted = applyMutationChanceBonus(pool, playerStats.mutationChanceBonus);
  const denominator = poolDenominator(boosted.weights, config.blankFillTo);
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
        config,
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
    rolls,
    noRollReason: rolls ? null : "Only target slots roll for spawns (the Spawn cells setting is \"slots only\"), and this cell isn't one.",
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
  config: SimulationState["scenario"]["settings"]["config"];
  effects: ReturnType<typeof recomputeEffects>;
  poolKind: SanityEntry["pool"];
  weight: number;
  chance: number;
  /** The ring phaseSpawn computed for this size, when it computed one. */
  ring: RingCounts | undefined;
}

function entryFor(m: MutationDef, c: EntryCtx): SanityEntry {
  const { plot, occ, row, col, config } = c;
  const fits = footprintFits(row, col, m.size);
  const cells = fits ? footprint(row, col, m.size) : [];
  const blockedBy = fits && !isFootprintFree(occ, row, col, m.size) ? plantsAt(occ, cells).map((p) => occupantOf(p, config)) : [];
  const footprintStatus: SanityFootprint = !fits ? "outOfBounds" : blockedBy.length > 0 ? "occupied" : "fits";

  // Ground, per footprint cell that is on the plot.
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
  const groundOk = wrong.length === 0; // the engine's per-cell `groundFits` rule, spelled out to list the wrong cells (pinned by tests)

  // The ring is only defined when the footprint is on the plot (phaseSpawn never reads it otherwise).
  const ring = fits ? (c.ring ?? ringCounts(occ, row, col, m.size, config)) : null;
  const ringPlants = fits ? plantsAt(occ, ringCells(row, col, m.size)) : [];
  const dryByKind: Record<string, number> = {};
  if (fits) {
    for (const idx of ringCells(row, col, m.size)) {
      const q = occ[idx];
      if (q && isDry(q, config)) dryByKind[q.kindId] = (dryByKind[q.kindId] ?? 0) + 1;
    }
  }
  const requirements: SanityRequirement[] = ring
    ? m.requirements.map((r) => ({ crop: r.crop, needed: r.count, have: ring.counts[r.crop] ?? 0, dry: dryByKind[r.crop] ?? 0 }))
    : [];

  const isLonelily = requiresZeroAdjacent(m);
  const ringOccupants = isLonelily && ring ? ringPlants.map((p) => occupantOf(p, config)) : isLonelily ? [] : null;
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

  // The authoritative answer is the pool phaseSpawn would build.
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
