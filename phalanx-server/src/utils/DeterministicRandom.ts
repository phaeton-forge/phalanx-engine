import { randomBytes } from 'node:crypto';
import { DeterministicRandom as MathDeterministicRandom } from '@phalanx-engine/math';

/**
 * Server RNG. Instance behavior, including `getState` / `setState` /
 * `fromState`, lives in `@phalanx-engine/math`. This subclass keeps the
 * Node-only helpers that the math package must not import (`node:crypto`).
 *
 * `generateSeed` used to call `require('crypto')` inside an ESM module.
 * It now uses the ESM `node:crypto` import.
 */
export class DeterministicRandom extends MathDeterministicRandom {
  public override fork(): DeterministicRandom {
    const forked = super.fork();
    const copy = new DeterministicRandom(0);
    copy.setState(forked.getState());
    return copy;
  }

  public static override fromState(
    state: readonly number[]
  ): DeterministicRandom {
    const rng = new DeterministicRandom(0);
    rng.setState(state);
    return rng;
  }

  /**
   * Create RNG from a bigint seed (for compatibility with previous API)
   * @param seed - A bigint to use as seed
   */
  public static fromBigInt(seed: bigint): DeterministicRandom {
    // Use lower 32 bits of the bigint
    return new DeterministicRandom(Number(BigInt.asUintN(32, seed)));
  }

  /**
   * Generate a random seed (for server use).
   * Uses `node:crypto` for a 32-bit seed. Not a simulation draw.
   */
  public static generateSeed(): number {
    return randomBytes(4).readUInt32BE(0);
  }
}
