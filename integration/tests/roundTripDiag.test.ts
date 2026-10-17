import { describe, expect, it } from 'vitest';
import { createV65Driver } from '../src/adapters/v65.js';
import { scenario } from '../src/dsl/scenario.js';
import { isSimulationFailure, simulate } from '../src/dsl/interpret.js';
import {
  firstSnapshotReconnect,
  generateScenario,
} from '../src/fuzz/generate.js';
import { prng } from '../src/util/prng.js';

describe('round-trip diagnostics', () => {
  it('names the snapshot tick and the corrupted field', async () => {
    const driver = createV65Driver();
    const run = simulate(
      driver,
      scenario('corrupt-restore', {
        suite: 'save-restore',
        tags: ['save-restore'],
        seed: 37,
        ticks: 8,
        slots: ['human', 'bot:aggressive'],
        peers: ['A'],
        timeline: [{ at: 4, op: 'roundTrip', peer: 'A' }],
        inputs: 'bots',
        expect: { converge: true },
        options: { corruptOnRestore: true },
      })
    );
    await expect(run).rejects.toThrow(/snapshot round-trip mismatch at tick/);
    try {
      await run;
    } catch (error) {
      expect(isSimulationFailure(error)).toBe(true);
      if (!isSimulationFailure(error)) return;
      expect(error.tick).toBe(3);
      expect(error.diffs.length).toBeGreaterThan(0);
      expect(error.diffs.length).toBeLessThanOrEqual(11);
      expect(error.before).toBeDefined();
      expect(error.after).toBeDefined();
      const health = error.diffs.find((diff) => diff.field === 'health');
      expect(health).toMatchObject({ component: 'Gas', field: 'health' });
    }
  });
});

describe('fuzz without an early restore', () => {
  it('keeps snapshot reconnects out of the first half of late-restore timelines', () => {
    let late = 0;
    let total = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const rng = prng(seed);
      for (let index = 0; index < 40; index += 1) {
        const generated = generateScenario(rng, seed, index);
        total += 1;
        if (!generated.tags.includes('late-restore')) continue;
        late += 1;
        const at = firstSnapshotReconnect(generated.timeline);
        const mid = Math.floor(generated.ticks / 2);
        expect(at === null || at >= mid).toBe(true);
      }
    }
    expect(late / total).toBeGreaterThanOrEqual(0.3);
  });
});
