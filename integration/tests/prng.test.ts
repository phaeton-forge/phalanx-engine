import { describe, expect, it } from 'vitest';
import { mixSeed, prng } from '../src/util/prng.js';

describe('prng', () => {
  it('repeats a seed and stays inside the range', () => {
    const left = prng(42);
    const right = prng(42);
    const draws: number[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const value = left.int(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
      expect(value).toBe(right.int(7));
      draws.push(value);
    }
    expect(new Set(draws).size).toBe(7);
    expect(prng(1).state()).not.toEqual(prng(2).state());
  });

  it('mixes seeds without Math.random', () => {
    expect(mixSeed(1, 2)).toBe(mixSeed(1, 2));
    expect(mixSeed(1, 2)).not.toBe(mixSeed(1, 3));
    expect(prng(0).state()).toEqual(prng(0).state());
  });
});
