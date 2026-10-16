import { describe, expect, it } from 'vitest';
import { FaultGate } from '../src/transport/FaultyTransport.js';
import { prng } from '../src/util/prng.js';

describe('FaultGate', () => {
  it('holds a delayed envelope until the release tick, then returns it', () => {
    const gate = new FaultGate();
    gate.setFault({ delay: [2, 2], dup: 0, reorder: 0, drop: 0 });
    gate.offer(5, entry(5), prng(1));
    expect(gate.releaseDue(5)).toEqual([]);
    expect(gate.horizon(5)).toBe(5);
    expect(gate.releaseDue(7).map((item) => item.tick)).toEqual([5]);
    expect(gate.horizon(7)).toBe(Number.POSITIVE_INFINITY);
  });

  it('withholds a drop until the log catch-up clears it', () => {
    const gate = new FaultGate();
    gate.setFault({ delay: [0, 0], dup: 0, reorder: 0, drop: 1 });
    gate.offer(3, entry(3), prng(1));
    expect(gate.hasDrop()).toBe(true);
    expect(gate.releaseDue(3)).toEqual([]);
    expect(gate.horizon(3)).toBe(3);
    gate.retransmit();
    expect(gate.hasDrop()).toBe(false);
    expect(gate.horizon(3)).toBe(Number.POSITIVE_INFINITY);
  });

  it('passthrough releases every envelope immediately', () => {
    const gate = new FaultGate(true);
    gate.setFault({ delay: [4, 4], dup: 0, reorder: 0, drop: 1 });
    gate.offer(3, entry(3), prng(1));
    expect(gate.releaseDue(3).map((item) => item.tick)).toEqual([3]);
    expect(gate.horizon(3)).toBe(Number.POSITIVE_INFINITY);
  });
});

function entry(tick: number) {
  return {
    tick,
    playerId: 'local:0',
    type: 'move',
    data: { q: 0, p: { type: 'move', dir: 0 } },
  };
}
