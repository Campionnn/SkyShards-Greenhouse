/**
 * Seeded xoshiro128** PRNG. State is a plain 4-word array inside
 * SimulationState, so it survives structuredClone/JSON and a run can be split
 * at any cycle without changing the stream. The engine never uses Math.random.
 */

export type RngState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const next = splitmix32(Math.trunc(seed));
  const s: RngState = [next(), next(), next(), next()];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1; // the all-zero state is a fixed point
  return s;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Next uint32. Mutates `s` in place. */
export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** Uniform in [0, 1). */
export function nextFloat(s: RngState): number {
  return nextU32(s) / 4294967296;
}

export function intInclusive(s: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(s) * (max - min + 1));
}

export function chance(s: RngState, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return nextFloat(s) < p;
}

/**
 * One weighted draw against `denominator` (>= weight sum); the remainder is
 * blank (-1). Always consumes exactly one number.
 */
export function weightedPick(s: RngState, weights: readonly number[], denominator: number): number {
  const roll = nextFloat(s) * denominator;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll < acc) return i;
  }
  return -1;
}
