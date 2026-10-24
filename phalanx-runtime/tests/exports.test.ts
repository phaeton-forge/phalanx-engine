import { describe, expect, it } from 'vitest';
import * as runtime from '../src/index.js';
import * as advanced from '../src/advanced/index.js';
import * as net from '../src/net/index.js';
import type { Transport } from '../src/transport/Transport.js';

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
  'SYSTEM_PLAYER_ID',
  'botPlayerId',
  'isBotPlayerId',
  'NotImplementedError',
  // game
  'defineGame',
  'defineCommands',
  'rejectCommand',
  'isCommandRejection',
  // state
  'BinaryStateWriter',
  'BinaryStateReader',
  'encodeSnapshot',
  'decodeSnapshot',
  'digestBytes',
  'initDigest',
  'onDigestFallback',
  'canonicalConfigBytes',
  'configHash',
  'checkSnapshotCompatibility',
  'SnapshotRejectedError',
  'SnapshotRoundTripError',
  // world
  'defineComponent',
  'saveWorld',
  'restoreWorld',
  'spawn',
  'despawn',
  'each',
  'bindWorldSingletons',
  // runner
  'MatchRunner',
  'ReplayPlayer',
  'runLocalMatch',
  'botSlotSeed',
  'CommandLog',
  'BotHost',
  // transport
  'LocalTransport',
  // persistence
  'MemoryMatchStore',
  'IndexedDbMatchStore',
  'MatchResumeError',
  // host
  'DebugDataProvider',
  'attachDebug',
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
  'writeModuleSections',
  'readModuleSections',
] as const;

describe('public exports', () => {
  it.each(VALUE_EXPORTS)('exports %s', (name) => {
    expect(runtime[name]).toBeDefined();
  });

  it('exports nothing undocumented', () => {
    expect(Object.keys(runtime).sort()).toEqual([...VALUE_EXPORTS].sort());
  });

  it.each(STATE_HELPERS)('StateHelpers.%s is a function', (name) => {
    expect(typeof advanced.StateHelpers[name]).toBe('function');
  });

  it('StateHelpers members match the snapshot', () => {
    expect(Object.keys(advanced.StateHelpers).sort()).toEqual(
      [...STATE_HELPERS].sort()
    );
  });

  it('keeps low-level helpers off the root export', () => {
    expect('StateHelpers' in runtime).toBe(false);
    expect('WorldScope' in runtime).toBe(false);
    expect('spawnWithId' in runtime).toBe(false);
    expect(typeof advanced.spawnWithId).toBe('function');
    expect(typeof advanced.PoolManager).toBe('function');
    expect(typeof advanced.SoAComponentStore).toBe('function');
    expect(typeof advanced.TickFrameManager).toBe('function');
    expect(typeof advanced.DebugPanel).toBe('function');
    expect('setWorldModuleHost' in advanced).toBe(false);
    expect('setEntityIdCounter' in advanced).toBe(false);
    expect('nextEntityId' in advanced).toBe(false);
    expect(advanced.TYPED_ARRAY_CONSTRUCTORS.i64).toBe(BigInt64Array);
    expect('rebuildBroadphaseFromTransforms' in advanced).toBe(false);
    expect('WorldScope' in advanced).toBe(false);
  });

  it('has the approved constants', () => {
    expect(runtime.ENGINE_SNAPSHOT_FORMAT).toBe(3);
    expect(runtime.SNAPSHOT_MAGIC).toBe('PHXS');
    expect(runtime.DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS).toBe(1000);
    expect(runtime.DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS).toBe(300);
  });
});

describe('net subpath', () => {
  it('exports only ServerPeerTransport', () => {
    expect(Object.keys(net).sort()).toEqual(['ServerPeerTransport']);
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
  it('StateHelpers keeps engine sections and omits module saves', () => {
    expect('writeAbilities' in advanced.StateHelpers).toBe(false);
    expect('readAbilities' in advanced.StateHelpers).toBe(false);
    expect('writeBroadphase' in advanced.StateHelpers).toBe(false);
    expect('readBroadphase' in advanced.StateHelpers).toBe(false);
    expect('rebuildBroadphaseFromTransforms' in advanced.StateHelpers).toBe(
      false
    );
  });

  it('Task 06: runner, log, bot host, local transport', () => {
    expect(new runtime.CommandLog().lastTick).toBe(-1);
    const transport = new runtime.LocalTransport({ tickRate: 10 });
    expect(transport.kind).toBe('local');
    expect(transport.isStepped).toBe(false);
    expect(transport.tickRate).toBe(10);
    transport.dispose();
    const stepped = runtime.LocalTransport.stepped();
    expect(stepped.isStepped).toBe(true);
    stepped.dispose();
    expect(runtime.BotHost).toBeTypeOf('function');
    expect(runtime.MatchRunner).toBeTypeOf('function');
  });

  it('Task 12: join rejects a transport without join()', async () => {
    await expect(
      runtime.MatchRunner.join({} as runtime.AnyGameDefinition, {} as Transport)
    ).rejects.toThrow('MatchRunner.join: transport does not support join()');
  });

  it('errors are plain Error subclasses', () => {
    expect(new runtime.SnapshotRejectedError('x').message).toBe(
      'snapshot rejected: x'
    );
    expect(new runtime.SnapshotRoundTripError('units').section).toBe('units');
  });
});
