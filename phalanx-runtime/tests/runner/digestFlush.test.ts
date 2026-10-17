import { afterEach, describe, expect, it } from 'vitest';
import { LocalTransport, MatchRunner, type Digest } from '../../src/index.js';
import { TinyGame, type TinyConfig } from '../fixtures/tinyGame.js';

function config(): TinyConfig {
  return {
    matchId: 'flush',
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed: 11,
    side: 'client',
    inputDelayTicks: 2,
    arenaSize: 2_000_000_000,
    slots: [
      { slot: 0, team: 0, kind: 'human', playerId: 'local:0', color: 1 },
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
}

describe('deferred periodic digest', () => {
  const live: MatchRunner<typeof TinyGame>[] = [];

  afterEach(() => {
    while (live.length > 0) live.pop()?.dispose();
  });

  function open(): {
    runner: MatchRunner<typeof TinyGame>;
    transport: LocalTransport;
    seen: { tick: number; digest: Digest; at: number }[];
  } {
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(TinyGame, config(), transport, {
      hashEveryTicks: 1,
    });
    live.push(runner);
    const seen: { tick: number; digest: Digest; at: number }[] = [];
    runner.onDigest((tick, digest) => {
      seen.push({ tick, digest, at: runner.tick });
    });
    runner.start();
    return { runner, transport, seen };
  }

  it('leaves the digest unpublished until flush', () => {
    const { runner, transport, seen } = open();
    transport.step(1);
    expect(runner.tick).toBe(0);
    expect(seen).toEqual([]);
    runner.flush();
    expect(seen).toEqual([{ tick: 0, digest: runner.digest(), at: 0 }]);
  });

  it('delivers queued digests in tick order from whenIdle', async () => {
    const { runner, transport, seen } = open();
    transport.step(3);
    expect(seen).toEqual([]);
    await runner.whenIdle();
    expect(seen.map((entry) => entry.tick)).toEqual([0, 1, 2]);
    expect(seen.every((entry) => entry.at === 2)).toBe(true);
    const early = seen[0];
    if (early === undefined) throw new Error('missing tick 0 digest');
    expect(early.digest).not.toBe(runner.digest());
  });

  it('keeps two runners from publishing each other', () => {
    const left = open();
    const right = open();
    left.transport.step(1);
    right.transport.step(1);
    left.runner.flush();
    expect(left.seen).toHaveLength(1);
    expect(right.seen).toEqual([]);
    right.runner.flush();
    expect(left.seen[0]?.digest).toBe(right.seen[0]?.digest);
    expect(left.seen[0]?.tick).toBe(0);
    expect(right.seen[0]?.tick).toBe(0);
  });

  it('drops a pending digest on dispose', async () => {
    const { runner, transport, seen } = open();
    transport.step(2);
    runner.dispose();
    await runner.whenIdle();
    expect(seen).toEqual([]);
  });
});
