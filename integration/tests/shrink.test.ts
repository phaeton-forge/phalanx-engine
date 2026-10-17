import { describe, expect, it } from 'vitest';
import { scenario } from '../src/dsl/scenario.js';
import { injectScenario } from '../src/fuzz/generate.js';
import {
  failureSignature,
  sameFailureSignature,
  shrinkScenario,
} from '../src/fuzz/shrink.js';

describe('shrinkScenario', () => {
  it('keeps the inject event and drops the rest', async () => {
    const shrunk = await shrinkScenario(
      injectScenario(5),
      async (candidate) => {
        const injected = candidate.timeline.some(
          (event) => event.op === 'inject'
        );
        return injected && candidate.ticks >= 4;
      }
    );
    expect(shrunk.timeline.length).toBeLessThanOrEqual(5);
    expect(shrunk.timeline.some((event) => event.op === 'inject')).toBe(true);
    expect(shrunk.timeline.filter((event) => event.op !== 'inject')).toEqual(
      []
    );
  });

  it('drops a controller handoff only as a pair', async () => {
    const original = scenario('pair', {
      suite: 'fuzz',
      tags: ['fuzz'],
      seed: 1,
      ticks: 8,
      slots: ['human'],
      peers: ['A', 'B'],
      timeline: [
        {
          at: 2,
          op: 'replaceWithBot',
          peer: 'A',
          policy: 'defensive',
          slot: 0,
        },
        { at: 3, op: 'malformed', peer: 'A' },
        { at: 4, op: 'returnFromBot', peer: 'A', slot: 0 },
      ],
      inputs: 'scripted:basic',
      expect: { converge: true },
    });
    const shrunk = await shrinkScenario(original, async (candidate) => {
      const ops = candidate.timeline.map((event) => event.op);
      const replace = ops.includes('replaceWithBot');
      const back = ops.includes('returnFromBot');
      return ops.includes('malformed') && replace === back;
    });
    expect(shrunk.timeline.map((event) => event.op)).toEqual(['malformed']);
  });

  it('treats a different divergence tick or a rejection as a new failure', () => {
    const diverged = new Error('peer B diverged at tick 5');
    expect(
      sameFailureSignature(new Error('peer B diverged at tick 5'), diverged)
    ).toBe(true);
    expect(
      sameFailureSignature(new Error('peer A diverged at tick 8'), diverged)
    ).toBe(false);
    expect(
      sameFailureSignature(
        new Error('setController rejected: slot is already human'),
        diverged
      )
    ).toBe(false);
    expect(failureSignature(diverged)).toEqual({ type: 'diverged', tick: 5 });
  });
});
