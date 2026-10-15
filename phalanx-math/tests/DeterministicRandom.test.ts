import { describe, it, expect } from 'vitest';
import { DeterministicRandom } from '../src/DeterministicRandom.js';

const CONTINUATION_DRAWS = 1000;

function draw(rng: DeterministicRandom, count: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(rng.intRange(0, 1_000_000));
  }
  return values;
}

describe('DeterministicRandom state', () => {
  it('fromState(getState()) continues identically for 1000 draws', () => {
    const original = new DeterministicRandom(0x0a11ce);
    draw(original, 17);
    const state = original.getState();

    expect(state).toHaveLength(4);
    for (const word of state) {
      expect(Number.isSafeInteger(word)).toBe(true);
    }

    const continued = DeterministicRandom.fromState(state);
    const resumed = new DeterministicRandom(1);
    resumed.setState(state);

    const expected = draw(original, CONTINUATION_DRAWS);
    expect(draw(continued, CONTINUATION_DRAWS)).toEqual(expected);
    expect(draw(resumed, CONTINUATION_DRAWS)).toEqual(expected);
  });

  it('getState does not advance the sequence', () => {
    const left = new DeterministicRandom(99);
    const right = new DeterministicRandom(99);
    left.getState();
    expect(left.intRange(0, 50)).toBe(right.intRange(0, 50));
  });

  it('setState and fromState reject a state that is not four integers', () => {
    const rng = new DeterministicRandom(1);
    const before = rng.getState();
    expect(() => rng.setState([1, 2, 3])).toThrow(/4 integer words/);
    expect(() => rng.setState([1, 2, 3, 1.5])).toThrow(/integer/);
    expect(() => DeterministicRandom.fromState([1, 2, 3, Number.NaN])).toThrow(
      /integer/
    );
    expect(rng.getState()).toEqual(before);
  });

  it('two seeds still diverge, and the same seed still matches', () => {
    const a = new DeterministicRandom(12345);
    const b = new DeterministicRandom(12345);
    const c = new DeterministicRandom(12346);
    expect(a.intRange(10, 20)).toBe(b.intRange(10, 20));
    expect(a.int(8)).not.toBe(c.int(8));
  });
});
