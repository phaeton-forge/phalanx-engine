import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalTransport,
  MatchRunner,
  onDigestFallback,
  type Digest,
} from '../../src/index.js';
import { TinyGame, type TinyConfig } from '../fixtures/tinyGame.js';
import { resetXxh64ForTests, xxh64WasmHex } from '../../src/state/xxh64Wasm.js';

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

  it('delivers queued digests in tick order from flush', () => {
    const { runner, transport, seen } = open();
    transport.step(3);
    expect(runner.tick).toBe(2);
    expect(seen).toEqual([]);
    runner.flush();
    expect(seen.map((entry) => entry.tick)).toEqual([0, 1, 2]);
    expect(seen.every((entry) => entry.at === 2)).toBe(true);
  });

  it('fails the match when onDigest throws, with no unhandled rejection', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      const transport = LocalTransport.stepped();
      const runner = new MatchRunner(TinyGame, config(), transport, {
        hashEveryTicks: 1,
      });
      live.push(runner);
      const errors: { tick: number; message: string }[] = [];
      runner.onDigest(() => {
        throw new Error('digest boom');
      });
      runner.onError((error, tick) => {
        errors.push({
          tick,
          message: error instanceof Error ? error.message : 'not an error',
        });
      });
      runner.start();
      transport.step(3);
      expect(runner.tick).toBe(2);
      await runner.whenIdle();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(errors).toEqual([{ tick: 0, message: 'digest boom' }]);
      expect(runner.status).toBe('failed');
      expect(runner.tick).toBe(2);
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('fails the match when submitHash throws', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      const transport = LocalTransport.stepped();
      // LocalTransport leaves submitHash unset. The runner calls it when present.
      const hashing = transport as LocalTransport & {
        submitHash(tick: number, digest: Digest): void;
      };
      hashing.submitHash = () => {
        throw new Error('submit boom');
      };
      const runner = new MatchRunner(TinyGame, config(), transport, {
        hashEveryTicks: 1,
      });
      live.push(runner);
      const errors: { tick: number; message: string }[] = [];
      runner.onError((error, tick) => {
        errors.push({
          tick,
          message: error instanceof Error ? error.message : 'not an error',
        });
      });
      runner.start();
      transport.step(1);
      await runner.whenIdle();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(errors).toEqual([{ tick: 0, message: 'submit boom' }]);
      expect(runner.status).toBe('failed');
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('does not fall back to BigInt after start', () => {
    resetXxh64ForTests();
    const reasons: string[] = [];
    const unsubscribe = onDigestFallback((reason) => {
      reasons.push(reason);
    });
    try {
      const { runner, transport, seen } = open();
      transport.step(1);
      runner.flush();
      expect(seen).toHaveLength(1);
      expect(reasons).toEqual([]);
      expect(xxh64WasmHex(new Uint8Array())).toBe('ef46db3751d8e999');
      expect(reasons).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('drops a pending digest on dispose', async () => {
    const { runner, transport, seen } = open();
    transport.step(2);
    runner.dispose();
    await runner.whenIdle();
    expect(seen).toEqual([]);
  });
});
