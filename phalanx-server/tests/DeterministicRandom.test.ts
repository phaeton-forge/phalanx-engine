import { describe, it, expect } from 'vitest';
import { DeterministicRandom as MathDeterministicRandom } from '@phalanx-engine/math';
import { DeterministicRandom } from '../src/utils/DeterministicRandom.js';

describe('server DeterministicRandom', () => {
  it('fromBigInt uses the lower 32 bits', () => {
    const fromNumber = new DeterministicRandom(42);
    const fromBig = DeterministicRandom.fromBigInt(0x1_0000_0000n + 42n);
    expect(fromBig.intRange(0, 10_000)).toBe(fromNumber.intRange(0, 10_000));
  });

  it('generateSeed returns a uint32', () => {
    const seed = DeterministicRandom.generateSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('fromState and fork match the math generator', () => {
    const server = new DeterministicRandom(77);
    const math = new MathDeterministicRandom(77);
    for (let i = 0; i < 5; i++) {
      server.intRange(0, 1000);
      math.intRange(0, 1000);
    }

    const continued = DeterministicRandom.fromState(server.getState());
    const mathContinued = MathDeterministicRandom.fromState(math.getState());
    for (let i = 0; i < 100; i++) {
      expect(continued.intRange(0, 1_000_000)).toBe(
        mathContinued.intRange(0, 1_000_000)
      );
    }

    const serverFork = new DeterministicRandom(77);
    const mathFork = new MathDeterministicRandom(77);
    const forkedServer = serverFork.fork();
    const forkedMath = mathFork.fork();
    expect(forkedServer).toBeInstanceOf(DeterministicRandom);
    for (let i = 0; i < 20; i++) {
      expect(forkedServer.intRange(0, 1000)).toBe(forkedMath.intRange(0, 1000));
      expect(serverFork.intRange(0, 1000)).toBe(mathFork.intRange(0, 1000));
    }
  });
});
