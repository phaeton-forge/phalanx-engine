/**
 * xoshiro128**. Integer-only. The seed is recorded in every report.
 * Harness randomness (faults, fuzz, scripted input) goes through this.
 * The simulation itself uses the match RNG.
 */
export interface Prng {
  /** Uniform integer in `0 .. max-1`. `max` must be an integer >= 1. */
  int(max: number): number;
  /** Snapshot of the four state words, for the report. */
  state(): readonly number[];
}

const MASK = 0xffffffff;

export function prng(seed: number): Prng {
  let a = seed >>> 0 || 0x9e3779b9;
  let b = Math.imul(a, 0x85ebca6b) >>> 0;
  let c = Math.imul(b, 0xc2b2ae35) >>> 0;
  let d = Math.imul(c, 0x27d4eb2f) >>> 0;
  if ((a | b | c | d) === 0) d = 1;

  const next = (): number => {
    const result = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return result;
  };

  return {
    int(max: number): number {
      if (!Number.isInteger(max) || max <= 0) {
        throw new Error(
          `prng.int: max must be an integer >= 1, got ${String(max)}`
        );
      }
      // Rejection sampling keeps the draw uniform for any max.
      const limit = Math.floor(0x100000000 / max) * max;
      let draw = next();
      while (draw >= limit) draw = next();
      return draw % max;
    },
    state(): readonly number[] {
      return [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    },
  };
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) & MASK;
}

/** Mix two integers into one unsigned seed. Deterministic. */
export function mixSeed(seed: number, salt: number): number {
  let mixed = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
