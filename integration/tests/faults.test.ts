import { describe, expect, it } from 'vitest';
import { FaultGate } from '../src/transport/FaultyTransport.js';
import { prng } from '../src/util/prng.js';

describe('FaultGate', () => {
  it('holds a delayed tick and releases it on retransmit', () => {
    const gate = new FaultGate();
    gate.setFault({ delay: [2, 2], dup: 0, reorder: 0, drop: 0 });
    gate.offer(5, entry(5), prng(1));
    expect(gate.horizon(5)).toBe(5);
    gate.retransmit();
    expect(gate.horizon(5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('withholds a drop until retransmit', () => {
    const gate = new FaultGate();
    gate.setFault({ delay: [0, 0], dup: 0, reorder: 0, drop: 1 });
    gate.offer(3, entry(3), prng(1));
    expect(gate.horizon(3)).toBe(3);
    gate.setFault(null);
    gate.retransmit();
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
