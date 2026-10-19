import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_SNAPSHOT_FORMAT,
  LocalTransport,
  MatchRunner,
  decodeSnapshot,
} from '../../src/index.js';
import { ArenaGame, type ArenaConfig } from '../fixtures/arenaGame.js';
import { TinyGame, type TinyConfig } from '../fixtures/tinyGame.js';
import {
  createSkirmishGame,
  type SkirmishSession,
} from '../../../integration/src/facade/v65.js';

/**
 * Full `runner.snapshot()` bytes, including the header digest.
 * Format 3 adds the `modules` container. There is no byte compatibility
 * with format 2. `UPDATE_GOLDEN=1` rewrites the files; a normal run
 * compares byte for byte.
 */
const DIR = dirname(fileURLToPath(import.meta.url));
const TICKS = [3, 59, 200, 377] as const;
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

function pathFor(name: string, tick: number): string {
  return join(DIR, `${name}-${String(tick)}.bin`);
}

function remember(name: string, snaps: ReadonlyMap<number, Uint8Array>): void {
  for (const tick of TICKS) {
    const bytes = snaps.get(tick);
    if (bytes === undefined) throw new Error(`missing ${name} tick ${tick}`);
    expect(ENGINE_SNAPSHOT_FORMAT).toBe(3);
    expect(decodeSnapshot(bytes).header.engineFormat).toBe(3);
    const file = pathFor(name, tick);
    if (UPDATE) {
      writeFileSync(file, bytes);
      continue;
    }
    if (!existsSync(file)) {
      throw new Error(`missing golden ${file}; run with UPDATE_GOLDEN=1`);
    }
    const stored = new Uint8Array(readFileSync(file));
    expect(bytes.byteLength).toBe(stored.byteLength);
    expect(bytes).toEqual(stored);
  }
}

function collect(
  step: () => void,
  snapshotAt: (tick: number) => Uint8Array,
  onTick: (handler: (tick: number) => void) => void
): Map<number, Uint8Array> {
  const snaps = new Map<number, Uint8Array>();
  const wanted = new Set<number>(TICKS);
  onTick((tick) => {
    if (!wanted.has(tick)) return;
    snaps.set(tick, snapshotAt(tick));
  });
  step();
  return snaps;
}

describe('snapshot goldens', () => {
  it('tiny bytes match the recorded snapshots', () => {
    const config: TinyConfig = {
      matchId: 'golden-tiny',
      gameId: 'tiny',
      simVersion: 'tiny-1',
      seed: 11,
      side: 'client',
      inputDelayTicks: 2,
      arenaSize: 2_000_000_000,
      slots: [
        {
          slot: 0,
          team: 0,
          kind: 'bot',
          policy: 'walker',
          level: 0,
          runsOn: 'local',
          color: 1,
        },
        {
          slot: 1,
          team: 1,
          kind: 'bot',
          policy: 'walker',
          level: 1,
          runsOn: 'local',
          color: 2,
        },
      ],
    };
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(TinyGame, config, transport, {
      hashEveryTicks: 1_000_000,
    });
    runner.start();
    const snaps = collect(
      () => {
        transport.step(TICKS[TICKS.length - 1]! + 1);
      },
      () => runner.snapshot(),
      (handler) => {
        runner.onTick(handler);
      }
    );
    runner.dispose();
    remember('tiny', snaps);
  });

  it('arena bytes match the recorded snapshots', () => {
    const config: ArenaConfig = {
      matchId: 'golden-arena',
      gameId: 'arena',
      simVersion: 'arena-1',
      seed: 11,
      side: 'client',
      inputDelayTicks: 2,
      slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
    };
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(ArenaGame, config, transport, {
      hashEveryTicks: 1_000_000,
    });
    runner.start();
    const snaps = collect(
      () => {
        transport.step(TICKS[TICKS.length - 1]! + 1);
      },
      () => runner.snapshot(),
      (handler) => {
        runner.onTick(handler);
      }
    );
    runner.dispose();
    remember('arena', snaps);
  });

  it('skirmish at 500 entities matches the recorded snapshots', () => {
    const session: SkirmishSession = {
      currentPeer: 'a',
      spawnOnRestore: false,
      suppressThrow: false,
      throwBot: false,
      poolProbe: false,
      dirtyAfterRestore: false,
      breakBotRestore: false,
      corruptOnRestore: false,
      injectTick: -1,
      bots: {},
      bound: {},
      controls: [],
    };
    const game = createSkirmishGame(session, {
      armySize: 500,
      slotCount: 2,
    });
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(
      game,
      {
        matchId: 'golden-skirmish',
        gameId: 'skirmish',
        simVersion: 'skirmish-1',
        seed: 1234,
        side: 'client',
        inputDelayTicks: 1,
        tickLimit: 1_000_000,
        armySize: 500,
        slots: [
          { slot: 0, team: 0, kind: 'human', playerId: 'local:0' },
          {
            slot: 1,
            team: 1,
            kind: 'bot',
            policy: 'aggressive',
            level: 1,
            runsOn: 'local',
          },
        ],
      },
      transport,
      { hashEveryTicks: 1_000_000 }
    );
    runner.start();
    const snaps = collect(
      () => {
        transport.step(TICKS[TICKS.length - 1]! + 1);
      },
      () => runner.snapshot(),
      (handler) => {
        runner.onTick(handler);
      }
    );
    runner.dispose();
    remember('skirmish500', snaps);
  }, 180_000);
});
