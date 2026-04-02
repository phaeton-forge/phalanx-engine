/**
 * Simple seeded PRNG (xorshift32) for deterministic randomness.
 * No external dependencies — phalanx-client's DeterministicRandom uses pure-rand
 * which we don't need for a single-player game.
 */
class GameRandomInstance {
  private state: number = 0;
  private initialSeed: number = 0;

  initialize(seed: number): void {
    this.initialSeed = seed;
    this.state = seed;
  }

  reset(): void {
    this.state = this.initialSeed;
  }

  private next(): number {
    let s = this.state;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    this.state = s;
    return (s >>> 0);
  }

  float(): number {
    return this.next() / 0x100000000;
  }

  floatRange(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  intRange(min: number, max: number): number {
    min = Math.floor(min);
    max = Math.floor(max);
    return min + (this.next() % (max - min + 1));
  }

  boolean(probability: number = 0.5): boolean {
    return this.float() < probability;
  }
}

export const GameRandom = new GameRandomInstance();
