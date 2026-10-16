import { describe, expect, it } from 'vitest';
import { createCurrentDriver } from '../src/adapters/current.js';
import { scenario } from '../src/dsl/scenario.js';
import { simulate } from '../src/dsl/interpret.js';
import { canonicalDigest } from '../src/oracle/digest.js';

describe('oracle sensitivity', () => {
  it('goes red when the fault gate is disabled', async () => {
    const driver = createCurrentDriver();
    const base = scenario('fault-off', {
      suite: 'disconnect',
      tags: ['disconnect'],
      seed: 3,
      ticks: 12,
      slots: ['human'],
      peers: ['A', 'B'],
      timeline: [
        {
          op: 'faults',
          from: 2,
          to: 8,
          peer: 'B',
          delay: [3, 3],
          dup: 0,
          reorder: 0,
          drop: 0,
        },
      ],
      inputs: 'scripted:always',
      expect: { converge: true, faultEffect: true },
    });
    await expect(simulate(driver, base)).resolves.toMatchObject({
      ticks: 12,
    });
    await expect(
      simulate(driver, {
        ...base,
        options: { disableFaultGate: true },
      })
    ).rejects.toThrow(/fault gate had no effect/);
  });

  it('changes homeZ and records contacts, and the digest is not snapshot bytes', async () => {
    const driver = createCurrentDriver();
    const match = driver.createMatch({
      seed: 5,
      inputDelayTicks: 1,
      slots: [
        { kind: 'human', team: 0 },
        { kind: 'human', team: 1 },
      ],
      options: {},
    });
    try {
      const peer = match.createPeer('A', { role: 'authority' });
      peer.step(2);
      const dump = peer.stateDump();
      const first = Object.values(dump.entities)[0];
      const homeZ = first?.['SkirmishUnit']?.['homeZ'];
      expect(homeZ).toBeDefined();
      expect(homeZ).not.toBe('0');
      expect(Number(dump.contacts)).toBeGreaterThan(0);
      const digest = peer.digest();
      expect(digest).toBe(canonicalDigest(dump));
      // Contacts are harness counters, not snapshot state.
      expect(digest).toBe(canonicalDigest({ ...dump, contacts: '0' }));
      expect(digest).not.toBe(canonicalDigest({ ...dump, rng: [] }));
    } finally {
      match.dispose();
    }
  });
});
