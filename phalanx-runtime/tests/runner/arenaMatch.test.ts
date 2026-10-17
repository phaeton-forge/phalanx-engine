import { afterEach, describe, expect, it } from 'vitest';
import { FP } from '@phalanx-engine/math';
import { LocalTransport, MatchRunner, type Digest } from '../../src/index.js';
import { ArenaGame, type ArenaConfig } from '../fixtures/arenaGame.js';

const THROUGH = 20;
const SNAPSHOT_TICK = 10;

function config(): ArenaConfig {
  return {
    matchId: 'arena-match',
    gameId: 'arena',
    simVersion: 'arena-1',
    seed: 11,
    side: 'client',
    inputDelayTicks: 2,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
  };
}

describe('arena fixture', () => {
  const live: MatchRunner<typeof ArenaGame>[] = [];

  afterEach(() => {
    while (live.length > 0) live.pop()?.dispose();
  });

  it('matches per-tick hashes after snapshot and fastForward', async () => {
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(ArenaGame, config(), transport, {
      hashEveryTicks: 1,
    });
    live.push(runner);
    const hashes: Digest[] = [];
    runner.onDigest((tick, digest) => {
      hashes[tick] = digest;
    });
    runner.start();
    transport.step(SNAPSHOT_TICK + 1);
    runner.flush();
    expect(runner.tick).toBe(SNAPSHOT_TICK);
    const snapshot = runner.snapshot();
    const atSnapshot = runner.digest();
    transport.step(THROUGH - SNAPSHOT_TICK);
    runner.flush();
    expect(runner.tick).toBe(THROUGH);
    const full = FP.ToRaw(FP.FromInt(50));
    expect(runner.sim.healthRaw() < full).toBe(true);
    expect(hashes[THROUGH]).toBe(runner.digest());
    expect(hashes[THROUGH]).not.toBe(hashes[SNAPSHOT_TICK]);

    const tail = runner.log
      .entriesAfter(SNAPSHOT_TICK)
      .filter((entry) => entry.tick <= THROUGH);
    const restoredTransport = LocalTransport.stepped();
    const restored = new MatchRunner(ArenaGame, config(), restoredTransport, {
      hashEveryTicks: 1,
    });
    live.push(restored);
    const restoredHashes: Digest[] = [];
    restored.onDigest((tick, digest) => {
      restoredHashes[tick] = digest;
    });
    restored.restore(snapshot);
    expect(restored.tick).toBe(SNAPSHOT_TICK);
    expect(restored.digest()).toBe(atSnapshot);
    expect(restored.digest()).toBe(hashes[SNAPSHOT_TICK]);
    await restored.fastForward(tail, {
      budgetMs: 1_000,
      throughTick: THROUGH,
    });
    restored.flush();
    expect(restored.tick).toBe(THROUGH);
    expect(restored.digest()).toBe(hashes[THROUGH]);
    expect(restored.sim.healthRaw()).toBe(runner.sim.healthRaw());
    for (let tick = SNAPSHOT_TICK + 1; tick <= THROUGH; tick += 1) {
      expect(restoredHashes[tick]).toBe(hashes[tick]);
    }
  });
});
