import type { Settings } from "../sim/state";
import { cyclesUntilNextActive, isActive } from "./activity";
import { hourOfDay } from "./clock";

/**
 * All-in Aloe (wiki All-in_Aloe/Table). Harvestable at any stage; the stage
 * sets the fragment multiplier (9 fragments = 1 All-in Aloe), the crop bundle
 * is fixed. Growing out of stage s rolls stage s's reset chance (back to stage
 * 1), so 4 -> 5 is the first risky step (3%). With that reading the wiki's
 * "Expected Drops" column holds and stage 14 maximises expected drops (9.37)
 * when the player checks every cycle. Never decays.
 */

export const ALOE_FRAGMENT = "all_in_aloe_fragment";
export const FRAGMENTS_PER_ALOE = 9;

/** Index = growth stage (0..27). Stage 0 (just spawned) behaves like stage 1. */
export const ALOE_TABLE: ReadonlyArray<{ multiplier: number; resetChance: number }> = [
  { multiplier: 0, resetChance: 0 }, // 0
  { multiplier: 0, resetChance: 0 }, // 1
  { multiplier: 0, resetChance: 0 },
  { multiplier: 0, resetChance: 0 },
  { multiplier: 1, resetChance: 0.03 }, // 4
  { multiplier: 2, resetChance: 0.06 },
  { multiplier: 3, resetChance: 0.09 },
  { multiplier: 4, resetChance: 0.12 },
  { multiplier: 6, resetChance: 0.15 },
  { multiplier: 9, resetChance: 0.18 },
  { multiplier: 13, resetChance: 0.21 }, // 10
  { multiplier: 20, resetChance: 0.24 },
  { multiplier: 28, resetChance: 0.27 },
  { multiplier: 41, resetChance: 0.3 },
  { multiplier: 60, resetChance: 0.33 }, // 14
  { multiplier: 86, resetChance: 0.36 },
  { multiplier: 125, resetChance: 0.39 },
  { multiplier: 182, resetChance: 0.42 },
  { multiplier: 263, resetChance: 0.45 },
  { multiplier: 382, resetChance: 0.48 },
  { multiplier: 554, resetChance: 0.51 }, // 20
  { multiplier: 803, resetChance: 0.54 },
  { multiplier: 1164, resetChance: 0.57 },
  { multiplier: 1688, resetChance: 0.6 },
  { multiplier: 2448, resetChance: 0.63 },
  { multiplier: 3549, resetChance: 0.66 },
  { multiplier: 5146, resetChance: 0.69 },
  { multiplier: 7462, resetChance: 0.72 }, // 27
];

/** Best harvest stage when checking every cycle (and respawning at once); also the "fully grown" mark in Auto. */
export const ALOE_OPTIMAL_STAGE = 14;
/** First stage that drops fragments: Auto never harvests below it. */
export const ALOE_FIRST_PAYING_STAGE = 4;

export function aloeRow(stage: number) {
  return ALOE_TABLE[Math.max(0, Math.min(ALOE_TABLE.length - 1, Math.floor(stage)))];
}

/** Harvest at `stage`, with every 9 fragments converted to one All-in Aloe. */
export function aloeHarvestItems(stage: number): { aloes: number; fragments: number } {
  const total = aloeRow(stage).multiplier;
  return { aloes: Math.floor(total / FRAGMENTS_PER_ALOE), fragments: total % FRAGMENTS_PER_ALOE };
}

// ---- Auto harvest stage ----
//
// One aloe cell as a Markov chain over 28 states: 0 = empty, 1..27 = stage.
// Per cycle an empty cell gets a new aloe (stage 1) with the respawn chance;
// an aloe at stage s grows to s+1 or resets to 1 with stage s's reset chance.
// The player checks every `gap` cycles and harvests at stage >= k. For each k
// the long-run fragments per cycle are worked out exactly (stationary
// distribution of the check-to-check chain) and the k with the most wins.

const STATES = ALOE_TABLE.length; // 28
type Matrix = number[][];

function cycleMatrix(respawnChance: number): Matrix {
  const a: Matrix = Array.from({ length: STATES }, () => new Array<number>(STATES).fill(0));
  a[0][0] = 1 - respawnChance;
  a[0][1] = respawnChance;
  for (let s = 1; s < STATES - 1; s++) {
    const r = ALOE_TABLE[s].resetChance;
    a[s][s + 1] += 1 - r;
    a[s][1] += r;
  }
  a[STATES - 1][STATES - 1] = 1; // stage 27 stops growing
  return a;
}

function multiply(x: Matrix, y: Matrix): Matrix {
  const out: Matrix = Array.from({ length: STATES }, () => new Array<number>(STATES).fill(0));
  for (let i = 0; i < STATES; i++) {
    for (let k = 0; k < STATES; k++) {
      const v = x[i][k];
      if (v === 0) continue;
      for (let j = 0; j < STATES; j++) out[i][j] += v * y[k][j];
    }
  }
  return out;
}

function power(m: Matrix, n: number): Matrix {
  let result: Matrix = Array.from({ length: STATES }, (_, i) => Array.from({ length: STATES }, (_, j) => (i === j ? 1 : 0)));
  let base = m;
  for (let e = n; e > 0; e = Math.floor(e / 2)) {
    if (e % 2 === 1) result = multiply(result, base);
    if (e > 1) base = multiply(base, base);
  }
  return result;
}

/** Stationary distribution of row-stochastic `p` (one recurrent class): solve pi (P - I) = 0, sum pi = 1. */
function stationary(p: Matrix): number[] {
  const n = STATES;
  // Rows = equations: (P^T - I) pi = 0, last equation replaced by sum(pi) = 1.
  const a: Matrix = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    if (i === n - 1) {
      row.fill(1);
      return row;
    }
    for (let j = 0; j < n; j++) row[j] = p[j][i] - (i === j ? 1 : 0);
    return row;
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-15) continue; // transient state that never occurs: pi = 0
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col || a[r][col] === 0) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => (Math.abs(row[i]) < 1e-15 ? 0 : row[n] / row[i]));
}

/** Long-run fragments per cycle when checking every `gap` cycles and harvesting at stage >= k. */
export function aloeFragmentsPerCycle(k: number, gapCycles: number, respawnChance: number): number {
  return fragmentRate(k, gapCycles, power(cycleMatrix(respawnChance), gapCycles));
}

function fragmentRate(k: number, gap: number, overGap: Matrix): number {
  // Check-to-check chain: harvest (stage >= k -> empty), then `gap` cycles.
  const p = Array.from({ length: STATES }, (_, s) => overGap[s >= k ? 0 : s]);
  const pi = stationary(p);
  let fragments = 0;
  for (let s = k; s < STATES; s++) fragments += pi[s] * ALOE_TABLE[s].multiplier;
  return fragments / gap;
}

/** Gaps beyond this behave the same (the cell is fully mixed); also bounds the work. */
const MAX_GAP = 1000;
const cache = new Map<string, number>();

/**
 * Auto: the harvest stage that makes the most All-in Aloe per cycle when the
 * player is next online in `gapCycles` cycles and an empty cell regrows an
 * aloe with `respawnChance` per cycle. A respawn chance of 0 (the aloe can't
 * spawn there right now) is planned as an instant respawn. No next session
 * (Infinity): take anything that drops fragments. Pure and cached; draws no RNG.
 */
export function aloeHarvestStageFor(gapCycles: number, respawnChance: number): number {
  if (!Number.isFinite(gapCycles)) return ALOE_FIRST_PAYING_STAGE;
  const gap = Math.max(1, Math.min(MAX_GAP, Math.floor(gapCycles)));
  const q = respawnChance > 0 ? Math.min(1, Math.round(respawnChance * 1000) / 1000) || 0.001 : 1;
  const key = `${gap}:${q}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const overGap = power(cycleMatrix(q), gap);
  let best = ALOE_FIRST_PAYING_STAGE;
  let bestRate = -1;
  for (let k = ALOE_FIRST_PAYING_STAGE; k < STATES; k++) {
    const rate = fragmentRate(k, gap, overGap);
    if (rate > bestRate + 1e-12) {
      bestRate = rate;
      best = k;
    }
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, best);
  return best;
}

/** One online session in `aloeHarvestSchedule`. */
export interface AloeSession {
  cycle: number;
  /** Clock hour (0..24) when the session's cycle fires. */
  hour: number;
  /** Cycles until the next session; Infinity = never online again. */
  gapCycles: number;
  /** Stage auto harvests All-in Aloe at in this session. */
  stage: number;
}

/**
 * The online sessions in the first `horizonSeconds` of a run and the stage
 * auto would harvest All-in Aloe at in each, for a fixed cycle length and
 * respawn chance. Same timing as the engine: cycle c fires at (c + 1) x
 * cycleSeconds. Display aid for the schedule editor; the engine itself picks
 * per plant from the live respawn chance (sim/player.ts).
 */
export function aloeHarvestSchedule(
  settings: Pick<Settings, "activity" | "playerActions" | "playerStats">,
  cycleSeconds: number,
  respawnChance: number,
  horizonSeconds = 86400
): AloeSession[] {
  if (settings.playerActions === false || !(cycleSeconds > 0)) return [];
  const start = settings.playerStats.startTimeOfDay;
  const out: AloeSession[] = [];
  for (let cycle = 0; (cycle + 1) * cycleSeconds <= horizonSeconds; cycle++) {
    const firesAt = (cycle + 1) * cycleSeconds;
    if (!isActive(settings.activity, cycle, firesAt, start)) continue;
    const gapCycles = cyclesUntilNextActive(settings.activity, cycle, firesAt, cycleSeconds, start);
    out.push({ cycle, hour: hourOfDay(start, firesAt), gapCycles, stage: aloeHarvestStageFor(gapCycles, respawnChance) });
  }
  return out;
}
