import { describe, expect, it } from 'vitest';
import * as runtime from '../src/index.js';

const VALUE_EXPORTS = [
  // constants & helpers
  'ENGINE_SNAPSHOT_FORMAT',
  'SNAPSHOT_MAGIC',
  'REPLAY_FORMAT',
  'DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS',
  'DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS',
  'DEFAULT_HASH_EVERY_TICKS',
  'DEFAULT_INPUT_DELAY_TICKS',
  'BOT_PLAYER_ID_PREFIX',
  'botPlayerId',
  'isBotPlayerId',
  'NotImplementedError',
  // game
  'defineGame',
  'rejectCommand',
  'isCommandRejection',
  // state
  'BinaryStateWriter',
  'BinaryStateReader',
  'encodeSnapshot',
  'decodeSnapshot',
  'digestBytes',
  'canonicalConfigBytes',
  'configHash',
  'checkSnapshotCompatibility',
  'SnapshotRejectedError',
  'SnapshotRoundTripError',
  // helpers
  'StateHelpers',
  // runner
  'MatchRunner',
  'CommandLog',
  'BotHost',
  'WorldScope',
  // transport
  'LocalTransport',
] as const;

const STATE_HELPERS = [
  'writeSoAStore',
  'readSoAStore',
  'writeSoAStores',
  'readSoAStores',
  'writeEntityIds',
  'readEntityIds',
  'spawnWithId',
  'writePools',
  'readPools',
  'writeRandom',
  'readRandom',
  'writeBroadphase',
  'readBroadphase',
  'rebuildPhysics',
  'writeAbilities',
  'readAbilities',
] as const;

function expectTask(fn: () => unknown, task: number): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(runtime.NotImplementedError);
    expect((error as runtime.NotImplementedError).task).toBe(task);
    expect((error as Error).message).toMatch(
      new RegExp(
        `^not implemented: .+ \\(Task ${String(task).padStart(2, '0')}\\)$`
      )
    );
    return;
  }
  throw new Error('expected a NotImplementedError');
}

describe('public exports', () => {
  it.each(VALUE_EXPORTS)('exports %s', (name) => {
    expect(runtime[name]).toBeDefined();
  });

  it('exports nothing undocumented', () => {
    expect(Object.keys(runtime).sort()).toEqual([...VALUE_EXPORTS].sort());
  });

  it.each(STATE_HELPERS)('StateHelpers.%s is a function', (name) => {
    expect(typeof runtime.StateHelpers[name]).toBe('function');
  });

  it('has the approved constants', () => {
    expect(runtime.ENGINE_SNAPSHOT_FORMAT).toBe(1);
    expect(runtime.SNAPSHOT_MAGIC).toBe('PHXS');
    expect(runtime.DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS).toBe(1000);
    expect(runtime.DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS).toBe(300);
  });
});

describe('bot player ids', () => {
  it('formats and recognises bot:<slot>', () => {
    expect(runtime.botPlayerId(3)).toBe('bot:3');
    expect(runtime.isBotPlayerId('bot:3')).toBe(true);
    expect(runtime.isBotPlayerId('bot:03')).toBe(false);
    expect(runtime.isBotPlayerId('player-1')).toBe(false);
    expect(() => runtime.botPlayerId(-1)).toThrow(/non-negative integer/);
  });
});

describe('command rejections', () => {
  it('builds and detects rejections', () => {
    const rejection = runtime.rejectCommand('cell occupied');
    expect(rejection).toEqual({ rejected: true, reason: 'cell occupied' });
    expect(runtime.isCommandRejection(rejection)).toBe(true);
    expect(runtime.isCommandRejection({ type: 'move' })).toBe(false);
    expect(runtime.isCommandRejection(null)).toBe(false);
  });
});

describe('canonical state bytes', () => {
  it('Task 02: writer, digest, snapshot and version policy run', () => {
    const writer = new runtime.BinaryStateWriter();
    writer.u8(1);
    const bytes = writer.finish();
    const reader = new runtime.BinaryStateReader(bytes);
    expect(reader.u8()).toBe(1);
    reader.done();

    expect(runtime.digestBytes(new Uint8Array(0))).toBe('ef46db3751d8e999');
    const configHash = runtime.configHash({ seed: 1 });
    const snapshot = runtime.encodeSnapshot(
      {
        engineFormat: runtime.ENGINE_SNAPSHOT_FORMAT,
        gameId: 'g',
        simVersion: 'g-1',
        formatVersion: 1,
        configHash,
        tick: 0,
      },
      bytes
    );
    const decoded = runtime.decodeSnapshot(snapshot);
    expect(decoded.header.digest).toBe(runtime.digestBytes(bytes));
    expect(decoded.botState).toBeNull();
    expect(decoded.inputCheckpoint).toBeNull();
    expect(
      runtime.checkSnapshotCompatibility(decoded.header, {
        engineFormat: runtime.ENGINE_SNAPSHOT_FORMAT,
        gameId: 'g',
        simVersion: 'g-1',
        formatVersion: 1,
        configHash,
      }).decision
    ).toBe('accept');
  });
});

describe('skeletons name their implementing task', () => {
  it('Task 05: ability helpers are still a skeleton', () => {
    const w = {} as runtime.StateWriter;
    const r = {} as runtime.StateReader;
    const world = {} as Parameters<
      typeof runtime.StateHelpers.rebuildPhysics
    >[0];
    expectTask(() => runtime.StateHelpers.writeAbilities(w, world), 5);
    expectTask(() => runtime.StateHelpers.readAbilities(r, world), 5);
  });

  it('Task 06: runner, log, bot host, scope, local transport', () => {
    expectTask(() => new runtime.CommandLog(), 6);
    expectTask(() => new runtime.WorldScope(), 6);
    expectTask(() => new runtime.LocalTransport({ tickRate: 10 }), 6);
    expectTask(() => runtime.LocalTransport.manual(), 6);
  });

  it('Task 12: network join', () => {
    expectTask(
      () =>
        runtime.MatchRunner.join(
          {} as runtime.AnyGameDefinition,
          {} as runtime.Transport
        ),
      12
    );
  });

  it('errors are plain Error subclasses', () => {
    expect(new runtime.SnapshotRejectedError('x').message).toBe(
      'snapshot rejected: x'
    );
    expect(new runtime.SnapshotRoundTripError('units').section).toBe('units');
  });
});
