import { DeterministicRandom } from 'phalanx-client';

class GameRandomInstance {
  private rng: DeterministicRandom | null = null;
  private seed = 0;

  initialize(seed: number): void {
    this.seed = seed;
    this.rng = new DeterministicRandom(seed);
    console.log(`[GameRandom] seed=${seed}`);
  }

  getSeed(): number {
    return this.seed;
  }

  isInitialized(): boolean {
    return this.rng !== null;
  }
}

export const GameRandom = new GameRandomInstance();
