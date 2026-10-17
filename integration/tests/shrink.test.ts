import { describe, expect, it } from 'vitest';
import { injectScenario } from '../src/fuzz/generate.js';
import { shrinkScenario } from '../src/fuzz/shrink.js';

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
});
