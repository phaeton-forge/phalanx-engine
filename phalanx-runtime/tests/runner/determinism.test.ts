import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalTransport,
  MatchRunner,
  ReplayPlayer,
  type Digest,
} from '../../src/index.js';
import { TinyGame, type TinyConfig } from '../fixtures/tinyGame.js';

const LAST = 600;
const SAMPLES = [3, 59, 200, 377] as const;

function config(seed = 11): TinyConfig {
  return {
    matchId: 'det',
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed,
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
}

function run(seed = 11): {
  runner: MatchRunner<typeof TinyGame>;
  transport: LocalTransport;
  digests: Map<number, Digest>;
  snaps: Map<number, Uint8Array>;
} {
  const transport = LocalTransport.stepped();
  const runner = new MatchRunner(TinyGame, config(seed), transport, {
    hashEveryTicks: 1,
  });
  const digests = new Map<number, Digest>();
  const snaps = new Map<number, Uint8Array>();
  runner.onDigest((tick, digest) => {
    digests.set(tick, digest);
    if ((SAMPLES as readonly number[]).includes(tick)) {
      snaps.set(tick, runner.snapshot());
    }
  });
  runner.start();
  for (let tick = 0; tick <= LAST; tick += 1) {
    transport.step(1);
    runner.flush();
  }
  return { runner, transport, digests, snaps };
}

describe('two-bot determinism', () => {
  const live: MatchRunner<typeof TinyGame>[] = [];

  afterEach(() => {
    while (live.length > 0) live.pop()?.dispose();
  });

  it('matches restore, fast-forward and replay on every sampled tick', async () => {
    const first = run();
    live.push(first.runner);
    expect(first.runner.tick).toBe(LAST);
    expect(first.digests.size).toBe(LAST + 1);

    for (const sample of SAMPLES) {
      const bytes = first.snaps.get(sample);
      if (bytes === undefined) throw new Error(`missing snapshot ${sample}`);
      const transport = LocalTransport.stepped();
      const restored = new MatchRunner(TinyGame, config(), transport, {
        hashEveryTicks: 1,
      });
      live.push(restored);
      const seen = new Map<number, Digest>();
      restored.onDigest((tick, digest) => {
        seen.set(tick, digest);
      });
      restored.restore(bytes);
      expect(restored.digest()).toBe(first.digests.get(sample));
      restored.start();
      transport.step(LAST - sample);
      restored.flush();
      expect(restored.tick).toBe(LAST);
      expect(restored.digest()).toBe(first.digests.get(LAST));
      for (let tick = sample + 1; tick <= LAST; tick += 1) {
        expect(seen.get(tick)).toBe(first.digests.get(tick));
      }

      const forwardTransport = LocalTransport.stepped();
      const forwarded = new MatchRunner(TinyGame, config(), forwardTransport, {
        hashEveryTicks: 1,
      });
      live.push(forwarded);
      const forwardedSeen = new Map<number, Digest>();
      forwarded.onDigest((tick, digest) => {
        forwardedSeen.set(tick, digest);
      });
      forwarded.restore(bytes);
      const tail = first.runner.log.entriesAfter(sample);
      await forwarded.fastForward(tail, { budgetMs: 50, throughTick: LAST });
      forwarded.flush();
      expect(forwarded.digest()).toBe(first.digests.get(LAST));
      for (let tick = sample + 1; tick <= LAST; tick += 1) {
        expect(forwardedSeen.get(tick)).toBe(first.digests.get(tick));
      }
    }

    const player = ReplayPlayer.from(TinyGame, first.runner.toReplay());
    const replayed = new Map<number, Digest>();
    player.onTick((tick) => {
      replayed.set(tick, player.digest());
    });
    await player.play({ budgetMs: 50 });
    expect(player.tick).toBe(LAST);
    expect(player.digest()).toBe(first.digests.get(LAST));
    for (let tick = 0; tick <= LAST; tick += 1) {
      expect(replayed.get(tick)).toBe(first.digests.get(tick));
    }
  });

  it('keeps two runners in one process from interfering', () => {
    const solo = run(3);
    live.push(solo.runner);
    const leftTransport = LocalTransport.stepped();
    const rightTransport = LocalTransport.stepped();
    const left = new MatchRunner(TinyGame, config(3), leftTransport, {
      hashEveryTicks: 1,
    });
    const right = new MatchRunner(TinyGame, config(3), rightTransport, {
      hashEveryTicks: 1,
    });
    live.push(left, right);
    const leftDigests = new Map<number, Digest>();
    const rightDigests = new Map<number, Digest>();
    left.onDigest((tick, digest) => {
      leftDigests.set(tick, digest);
    });
    right.onDigest((tick, digest) => {
      rightDigests.set(tick, digest);
    });
    left.start();
    right.start();
    for (let tick = 0; tick <= LAST; tick += 1) {
      leftTransport.step(1);
      rightTransport.step(1);
      left.flush();
      right.flush();
      expect(leftDigests.get(tick)).toBe(solo.digests.get(tick));
      expect(rightDigests.get(tick)).toBe(solo.digests.get(tick));
      expect(left.sim.entityIds()[0]).toBe(right.sim.entityIds()[0]);
    }
    expect(left.sim.entityIds()[0]).toBe(solo.runner.sim.entityIds()[0]);
  });
});
