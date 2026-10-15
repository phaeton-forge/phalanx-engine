import prand from 'pure-rand';

const XOROSHIRO_STATE_WORDS = 4;

/**
 * Deterministic Random Number Generator.
 *
 * Canonical implementation for the engine. `@phalanx-engine/client` re-exports
 * this class. `@phalanx-engine/server` subclasses it to add Node-only
 * `generateSeed` / `fromBigInt` without pulling `node:crypto` into browser
 * bundles.
 *
 * Wrapper around pure-rand's `xoroshiro128plus`. All peers initialized with
 * the same seed, or restored from the same {@link getState}, produce
 * identical sequences.
 *
 * `float`, `floatRange` and `boolean` are deprecated wrappers. Simulation
 * code uses `int` / `intRange`. Do not add new float call sites.
 *
 * @example
 * ```typescript
 * const rng = new DeterministicRandom(12345);
 * const damage = rng.intRange(10, 20); // Same on all clients with same seed
 * ```
 */
export class DeterministicRandom {
  private rng: prand.RandomGenerator;

  /**
   * Create a new deterministic RNG with the given seed
   * @param seed - A number seed value
   */
  constructor(seed: number) {
    // Use xoroshiro128+ algorithm - fast and high quality
    this.rng = prand.xoroshiro128plus(seed);
  }

  /**
   * Four signed int32 words from pure-rand `xoroshiro128plus.getState()`.
   * A fresh array; mutating it does not change this generator.
   */
  public getState(): readonly number[] {
    const state = readGeneratorState(this.rng);
    return [state[0], state[1], state[2], state[3]];
  }

  /**
   * Replace this generator with `xoroshiro128plus.fromState(state)`.
   * The next draw continues the saved sequence.
   *
   * @throws If `state` is not four safe integers.
   */
  public setState(state: readonly number[]): void {
    this.rng = xoroshiroFromState(state);
  }

  /**
   * Generator positioned at `state`. Equivalent to `setState` on a new
   * instance; the seed passed to the constructor is discarded.
   *
   * @throws If `state` is not four safe integers.
   */
  public static fromState(state: readonly number[]): DeterministicRandom {
    const rng = new DeterministicRandom(0);
    rng.setState(state);
    return rng;
  }

  /**
   * Generate next random 32-bit integer and advance state
   */
  private nextInt(): number {
    const [value, next] = this.rng.next();
    this.rng = next;
    return value;
  }

  /**
   * Get next random float in range [0, 1).
   *
   * @deprecated No floats in simulation code. Use `int` / `intRange`.
   */
  float(): number {
    // Use unsigned 32-bit integer for conversion
    const value = this.nextInt() >>> 0;
    return value / 0x100000000;
  }

  /**
   * Get next random float in range [min, max).
   *
   * @deprecated No floats in simulation code. Use `intRange`.
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (exclusive)
   */
  floatRange(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /**
   * Get next random integer in range [min, max]
   * @param min - Minimum value (inclusive)
   * @param max - Maximum value (inclusive)
   */
  intRange(min: number, max: number): number {
    min = Math.floor(min);
    max = Math.floor(max);
    const [value, next] = prand.uniformIntDistribution(min, max)(this.rng);
    this.rng = next;
    return value;
  }

  /**
   * Get next random integer in range [0, max)
   * @param max - Maximum value (exclusive)
   */
  int(max: number): number {
    return this.intRange(0, max - 1);
  }

  /**
   * Get next random boolean.
   *
   * @deprecated Float probability draw. Simulation code uses an integer
   * threshold instead.
   * @param probability - Probability of true (default 0.5)
   */
  boolean(probability: number = 0.5): boolean {
    return this.float() < probability;
  }

  /**
   * Get a random element from an array
   * @param array - Array to pick from
   */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[this.intRange(0, array.length - 1)];
  }

  /**
   * Shuffle an array in place using Fisher-Yates algorithm
   * @param array - Array to shuffle
   * @returns The same array, shuffled
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.intRange(0, i);
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  /**
   * Create a fork of this RNG with independent state
   * Useful for parallel simulations that need separate random streams
   */
  fork(): DeterministicRandom {
    // Generate a new seed from current state
    const newSeed = this.nextInt();
    return new DeterministicRandom(newSeed >>> 0);
  }

  /**
   * Get the current pure-rand generator.
   *
   * @deprecated Prefer {@link getState}. This leaks `pure-rand`'s
   * `RandomGenerator` into the public math API.
   */
  getGenerator(): prand.RandomGenerator {
    return this.rng;
  }

  /**
   * Replace the generator with a previously saved pure-rand generator.
   *
   * @deprecated Prefer {@link setState} or {@link fromState}. Accepting a
   * `pure-rand` `RandomGenerator` leaks that type into the public math API.
   * @param generator - Previously saved generator
   */
  setGenerator(generator: prand.RandomGenerator): void {
    this.rng = generator;
  }
}

type XoroshiroState = readonly [number, number, number, number];

function readGeneratorState(generator: prand.RandomGenerator): XoroshiroState {
  return assertXoroshiroState(generator.getState());
}

function xoroshiroFromState(state: readonly number[]): prand.RandomGenerator {
  return prand.xoroshiro128plus.fromState(assertXoroshiroState(state));
}

function assertXoroshiroState(state: readonly number[]): XoroshiroState {
  if (state.length !== XOROSHIRO_STATE_WORDS) {
    throw new Error(
      `DeterministicRandom: xoroshiro128plus state must have 4 integer words, got ${state.length}`
    );
  }
  const words: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < XOROSHIRO_STATE_WORDS; i++) {
    const word = state[i];
    if (word === undefined || !Number.isSafeInteger(word)) {
      throw new Error(
        `DeterministicRandom: xoroshiro128plus state word ${i} must be an integer`
      );
    }
    words[i] = word;
  }
  return words;
}
