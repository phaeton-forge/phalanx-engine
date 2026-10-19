import { describe, expect, it } from 'vitest';
import type { SlotConfig } from '@phalanx-engine/protocol';
import { createServerSim } from '../../src/server/createServerSim.js';
import { SnapshotStore } from '../../src/server/SnapshotStore.js';
import { RelayGame } from './fixtures/relayGame.js';

const game = {
  module: './game.js',
  export: 'Game',
};

describe('createServerSim validation', () => {
  it('rejects a missing config', () => {
    expect(() => createServerSim(undefined as never)).toThrow(
      'Invalid sim: must be an object.'
    );
  });

  it('rejects games that are not an array', () => {
    expect(() => createServerSim({ games: undefined as never })).toThrow(
      'Invalid games: must be an array.'
    );
  });

  it('rejects an empty games list', () => {
    expect(() => createServerSim({ games: [] })).toThrow(
      'Invalid games: must be a non-empty array.'
    );
  });

  it('rejects an unknown mode', () => {
    expect(() =>
      createServerSim({
        games: [game],
        mode: 'thread' as 'worker',
      })
    ).toThrow("Invalid sim.mode: thread. Must be 'worker' or 'inProcess'.");
  });

  it('rejects workers other than 1', () => {
    expect(() =>
      createServerSim({
        games: [game],
        workers: 2 as 1,
      })
    ).toThrow(
      'Invalid sim.workers: 2. Reserved until Task 17; only 1 is accepted.'
    );
  });

  it('rejects a bad snapshot interval', () => {
    expect(() =>
      createServerSim({ games: [game], snapshotEveryTicks: 0 })
    ).toThrow('Invalid sim.snapshotEveryTicks: 0. Must be an integer >= 1.');
  });

  it('rejects a bad match cap', () => {
    expect(() => createServerSim({ games: [game], maxMatches: 1.5 })).toThrow(
      'Invalid sim.maxMatches: 1.5. Must be an integer >= 1.'
    );
  });

  it('rejects resource limits that are not an object', () => {
    expect(() =>
      createServerSim({
        games: [game],
        resourceLimits: null as never,
      })
    ).toThrow('Invalid sim.resourceLimits: must be an object.');
  });

  it('rejects a non-positive resource limit', () => {
    expect(() =>
      createServerSim({
        games: [game],
        resourceLimits: { maxOldGenerationSizeMb: 0 },
      })
    ).toThrow(
      'Invalid sim.resourceLimits.maxOldGenerationSizeMb: must be a finite number > 0.'
    );
  });
});

const SLOTS: SlotConfig[] = [
  { slot: 0, team: 0, kind: 'human', playerId: 'p1' },
  {
    slot: 1,
    team: 1,
    kind: 'bot',
    policy: 'walker',
    level: 0,
    runsOn: 'server',
  },
];

describe('createServerSim close', () => {
  it('ends the match and drops its snapshot before the host closes', async () => {
    const deleted: string[] = [];
    const original = SnapshotStore.prototype.delete;
    SnapshotStore.prototype.delete = function (
      this: SnapshotStore,
      matchId: string
    ): void {
      deleted.push(matchId);
      original.call(this, matchId);
    };
    const delivered: number[] = [];
    let availableAtClose: boolean | null = null;
    try {
      const hook = createServerSim({
        games: [RelayGame],
        mode: 'inProcess',
        snapshotEveryTicks: 1,
      });
      await hook.start();
      const match = hook.openMatch(
        {
          matchId: 'm-close',
          gameId: RelayGame.id,
          seed: 1,
          slots: SLOTS,
          inputDelayTicks: 2,
          maxTickAhead: 5,
          extras: {},
        },
        {
          enqueue() {},
          currentTick: () => 0,
          endMatch: () => true,
          haltRelay() {},
          releaseHold() {},
          emitToPlayer(_playerId, _event, payload) {
            if (
              typeof payload === 'object' &&
              payload !== null &&
              'requestId' in payload &&
              typeof payload.requestId === 'number'
            ) {
              delivered.push(payload.requestId);
            }
          },
          emitServerEvent() {},
          onClosed() {
            availableAtClose = hook.isAvailable();
          },
        }
      );
      match.publishBatch(0, []);
      match.publishBatch(1, []);
      const deadline = Date.now() + 2000;
      while (match.latestSnapshotTick() === undefined) {
        if (Date.now() > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(match.latestSnapshotTick()).toBeDefined();
      match.requestSnapshot('p1', 1);
      const answer = Date.now() + 2000;
      while (delivered.length === 0) {
        if (Date.now() > answer) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(delivered).toEqual([1]);
      const before = delivered.length;
      await hook.close();
      expect(availableAtClose).toBe(true);
      expect(
        deleted.filter((id) => id === 'm-close').length
      ).toBeGreaterThanOrEqual(2);
      match.requestSnapshot('p1', 99);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(delivered.length).toBe(before);
      expect(match.latestSnapshotTick()).toBeUndefined();
    } finally {
      SnapshotStore.prototype.delete = original;
    }
  });
});
