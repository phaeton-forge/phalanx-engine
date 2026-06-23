import { DeterministicRandom } from '@phalanx-engine/client';

class GameRandomInstance {
  private instance: DeterministicRandom | null = null;
  private seed = 0;

  initialize(seed: number): void {
    this.seed = seed;
    this.instance = new DeterministicRandom(seed);
    console.log(`[GameRandom] seed=${seed}`);
  }

  getSeed(): number {
    return this.seed;
  }

  isInitialized(): boolean {
    return this.instance !== null;
  }

  /** Lockstep-safe RNG; throws if {@link initialize} has not been called. */
  get rng(): DeterministicRandom {
    if (!this.instance) {
      throw new Error('[GameRandom] initialize(seed) must be called before using rng');
    }
    return this.instance;
  }
}

export const GameRandom = new GameRandomInstance();
