import { describe, expect, it } from 'vitest';
import { createV65Driver } from '../src/adapters/v65.js';
import { scenario } from '../src/dsl/scenario.js';
import { simulate } from '../src/dsl/interpret.js';

const probe = scenario('mutation-probe', {
  suite: 'save-restore',
  tags: ['save-restore'],
  seed: 37,
  ticks: 12,
  slots: ['human', 'bot:aggressive'],
  peers: ['A'],
  timeline: [atRoundTrip(6)],
  inputs: 'bots',
  expect: { converge: true },
});

describe('mutation probes', () => {
  it('a clean restore converges', async () => {
    const driver = createV65Driver();
    await expect(simulate(driver, probe)).resolves.toMatchObject({
      ticks: 12,
    });
  });

  it('goes red when restore leaves SoA and RNG dirty', async () => {
    const driver = createV65Driver();
    await expect(
      simulate(driver, {
        ...probe,
        options: { dirtyAfterRestore: true },
      })
    ).rejects.toThrow(/round-trip state mismatch|diverged/);
  });

  it('goes red when bot restore drops saved memory', async () => {
    const driver = createV65Driver();
    await expect(
      simulate(driver, {
        ...probe,
        timeline: [{ at: 6, op: 'restoreSelf', peer: 'A' }],
        expect: { converge: true, liveReference: true },
        options: { breakBotRestore: true },
      })
    ).rejects.toThrow(/restore changed state|diverged/);
  });

  it('still diverges when pause shifts the sim clock', async () => {
    const driver = createV65Driver();
    await expect(
      simulate(
        driver,
        scenario('inject-after-pause', {
          suite: 'fuzz',
          tags: ['fuzz', 'inject'],
          seed: 2,
          ticks: 8,
          slots: ['human', 'bot:aggressive'],
          peers: ['A'],
          timeline: [
            { at: 2, op: 'pause' },
            { at: 4, op: 'resume' },
            { at: 6, op: 'inject', peer: 'A', when: 'tick' },
          ],
          inputs: 'scripted:basic',
          expect: { diverges: true },
        })
      )
    ).rejects.toThrow(/diverged/);
  });
});

function atRoundTrip(at: number): {
  at: number;
  op: 'roundTrip';
  peer: string;
} {
  return { at, op: 'roundTrip', peer: 'A' };
}
