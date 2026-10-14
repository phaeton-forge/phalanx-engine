import prand from 'pure-rand';

/**
 * Deterministic Random Number Generator
 *
 * Wrapper around pure-rand library for deterministic pseudo-random number generation.
 * All clients initialized with the same seed will produce identical sequences.
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
    return array[this.intRange(0, array.length - 1)] as T;
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
      array[i] = array[j] as T;
      array[j] = temp as T;
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
   * Get current generator for serialization
   * Note: pure-rand generators are immutable, so this returns a copy
   */
  getGenerator(): prand.RandomGenerator {
    return this.rng;
  }

  /**
   * Set generator from previously saved state
   * @param generator - Previously saved generator
   */
  setGenerator(generator: prand.RandomGenerator): void {
    this.rng = generator;
  }
}
