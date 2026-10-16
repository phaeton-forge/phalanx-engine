import { afterEach, describe, expect, it } from 'vitest';
import { DeterministicRandom } from '@phalanx-engine/math';
import {
  LocalTransport,
  MatchRunner,
  ReplayPlayer,
  botSlotSeed,
  type Digest,
} from '../../src/index.js';
import {
  TinyGame,
  resetTinyBotCalls,
  tinyBotCalls,
  type TinyConfig,
} from '../fixtures/tinyGame.js';

const DELAY = 2;
const ARENA = 2_000_000_000;

function config(seed = 7): TinyConfig {
  return {
    matchId: 'ctrl',
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed,
    side: 'client',
    inputDelayTicks: DELAY,
    arenaSize: ARENA,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0', color: 1 }],
  };
}

function open(seed = 7): {
  runner: MatchRunner<typeof TinyGame>;
  transport: LocalTransport;
} {
  const transport = LocalTransport.stepped();
  const runner = new MatchRunner(TinyGame, config(seed), transport, {
    hashEveryTicks: 1,
  });
  return { runner, transport };
}

describe('setController', () => {
  const live: MatchRunner<typeof TinyGame>[] = [];

  afterEach(() => {
    resetTinyBotCalls();
    while (live.length > 0) live.pop()?.dispose();
  });

  function keep(
    runner: MatchRunner<typeof TinyGame>
  ): MatchRunner<typeof TinyGame> {
    live.push(runner);
    return runner;
  }

  it('rejects unknown slots, duplicate modes and a fromTick outside the delay', () => {
    const { runner, transport } = open();
    keep(runner);
    const reasons: string[] = [];
    runner.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    runner.setController(4, 'bot', { policy: 'walker' });
    runner.setController(0, 'human');
    runner.setController(0, 'bot', { policy: 'walker', fromTick: 50 });
    runner.start();
    transport.step(1);
    expect(reasons).toEqual([
      'unknown slot',
      'slot is already human',
      'fromTick out of range',
    ]);
    expect(
      runner.log
        .entriesAfter(-1)
        .some((entry) => entry.type === 'setController')
    ).toBe(false);
  });

  it('hands a human slot to a bot and back, and restore matches', async () => {
    const { runner, transport } = open();
    keep(runner);
    const digests = new Map<number, Digest>();
    const snaps = new Map<number, Uint8Array>();
    runner.onTick((tick) => {
      digests.set(tick, runner.digest());
    });
    runner.onDigest((tick, digest) => {
      digests.set(tick, digest);
      if (tick >= 4 && tick <= 9) snaps.set(tick, runner.snapshot());
    });
    runner.start();
    transport.step(4);
    runner.setController(0, 'bot', { policy: 'walker', fromTick: 5 });
    const reasons: string[] = [];
    runner.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    transport.step(1);
    runner.submit({ type: 'move', dx: 1n });
    transport.step(2);
    expect(reasons).toContain('slot controlled by bot');
    runner.setController(0, 'human', { fromTick: 8 });
    transport.step(6);
    expect(runner.tick).toBe(12);

    const botMoves = tinyBotCalls.filter(
      (call) => call.tick >= 5 && call.tick < 8
    );
    expect(botMoves.length).toBeGreaterThan(0);
    const first = botMoves[0]?.commands[0];
    if (first === undefined || first.type !== 'spawn') {
      throw new Error('expected the handover bot to spawn');
    }
    const roll = new DeterministicRandom(botSlotSeed(7, 0)).int(3);
    expect(first.x).toBe(BigInt(roll + 2));

    for (const [tick, bytes] of snaps) {
      const copyTransport = LocalTransport.stepped();
      const copy = keep(
        new MatchRunner(TinyGame, config(), copyTransport, {
          hashEveryTicks: 1,
        })
      );
      const seen = new Map<number, Digest>();
      copy.onDigest((at, digest) => {
        seen.set(at, digest);
      });
      copy.restore(bytes);
      expect(copy.digest()).toBe(digests.get(tick));
      await copy.fastForward(runner.log.entriesAfter(tick), {
        budgetMs: 50,
        throughTick: 12,
      });
      for (let at = tick + 1; at <= 12; at += 1) {
        expect(seen.get(at)).toBe(digests.get(at));
      }
    }

    const replay = runner.toReplay();
    const player = ReplayPlayer.from(TinyGame, replay);
    const replayDigests = new Map<number, Digest>();
    player.onTick((tick) => {
      replayDigests.set(tick, player.digest());
    });
    await player.fastForward(12);
    expect(player.tick).toBe(12);
    expect(player.digest()).toBe(digests.get(12));
    expect(replayDigests.get(6)).toBe(digests.get(6));
    expect(replayDigests.get(10)).toBe(digests.get(10));
  });
});
