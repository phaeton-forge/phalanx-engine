import { DeterministicRandom } from 'phalanx-client';

/**
 * Global game random number generator
 *
 * This singleton provides access to the deterministic RNG initialized
 * with the seed from the server. All game logic that requires randomness
 * MUST use this class to ensure determinism across all clients.
 *
 * @example
 * ```typescript
 * import { GameRandom } from "../core/GameRandom";
 *
 * // Roll for critical hit
 * const isCrit = GameRandom.boolean(0.15); // 15% crit chance
 *
 * // Random damage in range
 * const damage = GameRandom.intRange(10, 20);
 *
 * // Pick random target from array
 * const target = GameRandom.pick(enemies);
 * ```
 */
class GameRandomInstance {
  private rng: DeterministicRandom | null = null;
  private seed: number = 0;

  /**
   * Initialize the RNG with a seed from the server
   * @param seed - The random seed received from game-start event
   */
  initialize(seed: number): void {
    this.seed = seed;
    this.rng = new DeterministicRandom(seed);
    console.log(`[GameRandom] Initialized with seed: ${seed}`);
  }

  /**
   * Reset the RNG to its initial state (for testing/replay)
   */
  reset(): void {
    if (this.seed !== 0) {
      this.rng = new DeterministicRandom(this.seed);
    }
  }

  /**
   * Get the current seed
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Check if RNG is initialized
   */
  isInitialized(): boolean {
    return this.rng !== null;
  }

  private ensureInitialized(): DeterministicRandom {
    if (!this.rng) {
      throw new Error(
        'GameRandom not initialized! Call GameRandom.initialize(seed) first.'
      );
    }
    return this.rng;
  }

  /**
   * Get next random float in range [0, 1)
   */
  float(): number {
    return this.ensureInitialized().float();
  }

  /**
   * Get next random float in range [min, max)
   */
  floatRange(min: number, max: number): number {
    return this.ensureInitialized().floatRange(min, max);
  }

  /**
   * Get next random integer in range [min, max]
   */
  intRange(min: number, max: number): number {
    return this.ensureInitialized().intRange(min, max);
  }

  /**
   * Get next random integer in range [0, max)
   */
  int(max: number): number {
    return this.ensureInitialized().int(max);
  }

  /**
   * Get next random boolean
   * @param probability - Probability of true (default 0.5)
   */
  boolean(probability: number = 0.5): boolean {
    return this.ensureInitialized().boolean(probability);
  }

  /**
   * Get a random element from an array
   */
  pick<T>(array: readonly T[]): T {
    return this.ensureInitialized().pick(array);
  }

  /**
   * Shuffle an array in place
   */
  shuffle<T>(array: T[]): T[] {
    return this.ensureInitialized().shuffle(array);
  }

  /**
   * Create a fork of the RNG for independent random stream
   */
  fork(): DeterministicRandom {
    return this.ensureInitialized().fork();
  }
}

/**
 * Global singleton instance
 */
export const GameRandom = new GameRandomInstance();
