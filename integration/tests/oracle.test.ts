import { describe, expect, it } from 'vitest';
import { firstDivergingTick } from '../src/oracle/oracle.js';

describe('firstDivergingTick', () => {
  it('returns a mismatch even when a later tick agrees', () => {
    const peer = new Map([
      [0, 'a'],
      [1, 'DIFF'],
      [2, 'c'],
    ]);
    const reference = new Map([
      [0, 'a'],
      [1, 'b'],
      [2, 'c'],
    ]);
    expect(firstDivergingTick(peer, reference)).toBe(1);
    expect(firstDivergingTick(reference, reference)).toBeNull();
  });

  it('ignores ticks the peer has not recorded', () => {
    const peer = new Map([[6, 'same']]);
    const reference = new Map([
      [0, 'early'],
      [6, 'same'],
    ]);
    expect(firstDivergingTick(peer, reference)).toBeNull();
  });
});
