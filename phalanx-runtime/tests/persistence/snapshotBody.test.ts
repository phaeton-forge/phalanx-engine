import { describe, expect, it } from 'vitest';
import {
  defineCommands,
  defineGame,
  LocalTransport,
  MatchRunner,
  MemoryMatchStore,
} from '../../src/index.js';
import { createPersistBenchGame } from '../fixtures/persistBenchGame.js';

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

describe('sealed snapshot body', () => {
  it.each([150, 500])(
    'encode after later ticks still matches the seal (%i units)',
    async (unitCount) => {
      const game = createPersistBenchGame(unitCount);
      const store = new MemoryMatchStore();
      const matchId = `body-${String(unitCount)}`;
      const transport = LocalTransport.stepped({
        store,
        snapshotEveryTicks: 300,
        pauseWhenHidden: false,
      });
      const runner = new MatchRunner(
        game,
        {
          matchId,
          seed: 77,
          side: 'client',
          inputDelayTicks: 1,
          slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
        },
        transport,
        { localSlots: [0] }
      );
      runner.start();
      while (runner.tick < 300) transport.step(1);
      expect(runner.tick).toBe(300);
      expect(runner.lastTickPersistedSnapshot).toBe(true);
      const ref = runner.snapshot();
      for (let step = 0; step < 120; step += 1) transport.step(1);
      const later = runner.snapshot();
      expect(sameBytes(ref, later)).toBe(false);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
      runner.stop();
      await runner.whenPersisted();
      const loaded = await store.load(matchId);
      expect(loaded?.snapshot?.tick).toBe(300);
      const stored = loaded?.snapshot?.bytes;
      expect(stored).toBeInstanceOf(Uint8Array);
      if (stored === undefined) return;
      expect(sameBytes(stored, ref)).toBe(true);
      expect(sameBytes(stored, later)).toBe(false);
      const liveTick = runner.tick;
      const liveDigest = runner.digest();
      const resumed = await MatchRunner.resumeLocal(game, store, matchId);
      expect(resumed).not.toBeNull();
      if (resumed === null) return;
      expect(resumed.tick).toBe(liveTick);
      expect(resumed.digest()).toBe(liveDigest);
      resumed.dispose();
      runner.dispose();
    },
    120_000
  );
});

describe('shared snapshot body', () => {
  it('saves the world once when the hash tick is the snapshot tick', () => {
    let saves = 0;
    const game = defineGame({
      id: 'once',
      simVersion: 'once-1',
      tickRate: 10,
      commands: defineCommands({ hold: {} }),
      onCommand: { hold() {} },
      checkOutcome: () => null,
      save: {
        formatVersion: 1,
        handler: () => ({
          save: () => {
            saves += 1;
          },
          restore: () => {},
        }),
      },
    });
    const store = new MemoryMatchStore();
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 60,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(
      game,
      {
        matchId: 'once',
        seed: 1,
        side: 'client',
        inputDelayTicks: 1,
        slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
      },
      transport
    );
    runner.start();
    transport.step(1);
    expect(runner.tick).toBe(0);
    expect(saves).toBe(1);
    transport.step(60);
    expect(runner.tick).toBe(60);
    expect(runner.lastTickPersistedSnapshot).toBe(true);
    expect(saves).toBe(2);
    runner.dispose();
  });

  it('does not save a snapshot body for a tick catch-up already stored', async () => {
    let saves = 0;
    const game = defineGame({
      id: 'catch-up-save',
      simVersion: 'catch-1',
      tickRate: 10,
      commands: defineCommands({ hold: {} }),
      onCommand: { hold() {} },
      checkOutcome: () => null,
      save: {
        formatVersion: 1,
        handler: () => ({
          save: () => {
            saves += 1;
          },
          restore: () => {},
        }),
      },
    });
    const store = new MemoryMatchStore();
    const transport = LocalTransport.stepped({
      store,
      snapshotEveryTicks: 300,
      pauseWhenHidden: false,
    });
    const runner = new MatchRunner(
      game,
      {
        matchId: 'catch-up-save',
        seed: 1,
        side: 'client',
        inputDelayTicks: 1,
        slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
      },
      transport
    );
    runner.start();
    transport.step(121);
    expect(runner.tick).toBe(120);
    runner.dispose();
    await runner.whenPersisted();
    const before = saves;
    const resumed = await MatchRunner.resumeLocal(
      game,
      store,
      'catch-up-save',
      {
        snapshotEveryTicks: 60,
        pauseWhenHidden: false,
        hashEveryTicks: 60,
      }
    );
    expect(resumed).not.toBeNull();
    resumed?.dispose();
    // Hash ticks 0, 60, and 120. The resumed interval would also snapshot
    // 60 and 120, and skipThrough must not save those bodies again.
    expect(saves - before).toBe(3);
  });
});
