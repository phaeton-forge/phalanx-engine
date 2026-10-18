import { afterEach, describe, expect, it } from 'vitest';
import type {
  CommandsBatch,
  FrameHandler,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import {
  BinaryStateReader,
  BinaryStateWriter,
  BotHost,
  LocalTransport,
  MatchRunner,
  ReplayPlayer,
  botPlayerId,
  botSlotSeed,
  runLocalMatch,
  type Digest,
  type Transport,
} from '../../src/index.js';
import {
  TinyGame,
  resetSentryBot,
  resetTinyBotCalls,
  sentryBotCounts,
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

function stepFlushed(
  transport: LocalTransport,
  runner: MatchRunner<typeof TinyGame>,
  count: number
): void {
  for (let step = 0; step < count; step += 1) {
    transport.step(1);
    runner.flush();
  }
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
    resetSentryBot();
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
    stepFlushed(transport, runner, 4);
    runner.setController(0, 'bot', { policy: 'walker', fromTick: 5 });
    const reasons: string[] = [];
    runner.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    stepFlushed(transport, runner, 1);
    runner.submit({ type: 'move', dx: 1n });
    stepFlushed(transport, runner, 2);
    expect(reasons).toContain('slot controlled by bot');
    runner.setController(0, 'human', { fromTick: 8 });
    stepFlushed(transport, runner, 6);
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
      copy.flush();
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

  it('keeps system seq unique after restore', () => {
    const { runner, transport } = open();
    keep(runner);
    runner.start();
    transport.step(4);
    runner.setController(0, 'bot', { policy: 'walker', fromTick: 5 });
    transport.step(1);
    const bytes = runner.snapshot();

    const copyTransport = LocalTransport.stepped();
    const copy = keep(
      new MatchRunner(TinyGame, config(), copyTransport, {
        hashEveryTicks: 1,
      })
    );
    copy.restore(bytes);
    copy.setController(0, 'human', { fromTick: 6 });
    copy.start();
    copyTransport.step(3);

    const seqs = copy.log
      .entriesAfter(-1)
      .filter((entry) => entry.playerId === 'system')
      .map((entry) => entry.data.q);
    expect(seqs).toEqual([0, 1]);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('does not reuse a system q applied before the snapshot', () => {
    const { runner, transport } = open();
    keep(runner);
    runner.start();
    transport.step(4);
    runner.setController(0, 'bot', { policy: 'walker', fromTick: 5 });
    transport.step(3);
    expect(runner.tick).toBe(6);
    const history = runner.log
      .entriesAfter(-1)
      .filter((entry) => entry.playerId === 'system');
    expect(history.map((entry) => entry.data.q)).toEqual([0]);
    const bytes = runner.snapshot();

    const copyTransport = LocalTransport.stepped();
    const copy = keep(
      new MatchRunner(TinyGame, config(), copyTransport, {
        hashEveryTicks: 1,
      })
    );
    copy.restore(bytes);
    copy.setController(0, 'human', { fromTick: 8 });
    copy.start();
    copyTransport.step(2);

    const fresh = copy.log
      .entriesAfter(-1)
      .filter((entry) => entry.playerId === 'system');
    const merged = [...history, ...fresh].map(
      (entry) => `${String(entry.tick)}/${String(entry.data.q)}`
    );
    expect(fresh.length).toBe(1);
    expect(new Set(merged).size).toBe(merged.length);
    expect(merged).toEqual(['5/0', '8/1']);
  });

  it('stamps runsOn from the server peer, not the caller side alone', () => {
    const transport = LocalTransport.stepped();
    const runner = keep(
      new MatchRunner(
        TinyGame,
        {
          ...config(),
          side: 'server',
          slots: [
            ...config().slots,
            {
              slot: 1,
              team: 1,
              kind: 'bot',
              policy: 'walker',
              level: 0,
              runsOn: 'server',
              color: 2,
            },
          ],
        },
        transport
      )
    );
    runner.start();
    runner.setController(0, 'bot', { policy: 'walker', fromTick: 1 });
    transport.step(2);
    const system = runner.log
      .entriesAfter(-1)
      .filter((entry) => entry.type === 'setController');
    expect(system).toHaveLength(1);
    expect(system[0]?.data.p).toMatchObject({
      slot: 0,
      mode: 'bot',
      runsOn: 'server',
    });
  });

  it('keeps a server handover as a bot when a client restores the snapshot', async () => {
    const serverTransport = LocalTransport.stepped();
    const server = keep(
      new MatchRunner(
        TinyGame,
        { ...config(), side: 'server' },
        serverTransport
      )
    );
    server.start();
    serverTransport.step(4);
    server.setController(0, 'bot', { policy: 'walker', fromTick: 5 });
    serverTransport.step(3);
    expect(server.tick).toBe(6);
    const bytes = server.snapshot();

    const client = keep(
      new MatchRunner(TinyGame, config(), LocalTransport.stepped())
    );
    const reasons: string[] = [];
    client.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    client.restore(bytes);
    const next = server.tick + 1;
    await client.fastForward(
      [
        {
          tick: next,
          playerId: botPlayerId(0),
          type: 'spawn',
          data: { q: 0, p: { type: 'spawn', x: '1' } },
        },
        {
          tick: next,
          playerId: 'local:0',
          type: 'spawn',
          data: { q: 0, p: { type: 'spawn', x: '2' } },
        },
      ],
      { budgetMs: Number.POSITIVE_INFINITY, throughTick: next }
    );
    expect(reasons).not.toContain('slot controlled by human');
    expect(reasons).toContain('slot controlled by bot');
  });

  it('constructs the saved policy instead of restoring into the configured bot', () => {
    const transport = LocalTransport.stepped();
    const runner = keep(
      new MatchRunner(TinyGame, botSlotConfig('walker', 0), transport)
    );
    runner.start();
    transport.step(1);
    runner.setController(0, 'human', { fromTick: 2 });
    transport.step(2);
    runner.setController(0, 'bot', { policy: 'sentry', fromTick: 4 });
    transport.step(2);
    expect(runner.tick).toBe(4);
    const bytes = runner.snapshot();

    resetSentryBot();
    const copy = keep(
      new MatchRunner(
        TinyGame,
        botSlotConfig('walker', 0),
        LocalTransport.stepped()
      )
    );
    expect(sentryBotCounts().constructed).toBe(0);
    copy.restore(bytes);
    expect(sentryBotCounts()).toEqual({ constructed: 1, restored: 1 });
  });

  it('constructs a new bot when the saved level differs', () => {
    const host = new BotHost(TinyGame, botSlotConfig('sentry', 0), 'client');
    host.release(0);
    host.adopt({
      slot: 0,
      team: 0,
      policy: 'sentry',
      level: 4,
      runsOn: 'local',
    });
    const writer = new BinaryStateWriter();
    host.save(writer);
    const bytes = writer.finish();

    resetSentryBot();
    const restored = new BotHost(
      TinyGame,
      botSlotConfig('sentry', 0),
      'client'
    );
    expect(sentryBotCounts().constructed).toBe(1);
    restored.restore(new BinaryStateReader(bytes));
    expect(sentryBotCounts()).toEqual({ constructed: 2, restored: 1 });
  });

  it('plays a replay through a prefix and then the rest', async () => {
    const { runner, transport } = open();
    keep(runner);
    runner.submit({ type: 'move', dx: 1n });
    runner.start();
    transport.step(4);
    runner.submit({ type: 'move', dx: 1n });
    transport.step(4);
    runner.submit({ type: 'move', dx: 1n });
    transport.step(3);
    const replay = runner.toReplay();
    const ticks = replay.log.map((entry) => entry.tick);
    expect(ticks).toEqual(expect.arrayContaining([1, 5, 9]));

    const player = ReplayPlayer.from(TinyGame, replay);
    await player.fastForward(5);
    expect(player.tick).toBe(5);
    await player.play({ budgetMs: 50 });
    expect(player.tick).toBe(replay.lastTick);
    expect(player.digest()).toBe(replay.finalDigest);
  });

  it('rejects the reserved player id system from either entry point', () => {
    const transport = LocalTransport.stepped();
    const human = {
      slot: 0,
      team: 0,
      kind: 'human' as const,
      playerId: 'system',
      color: 1,
    };
    expect(
      () =>
        new MatchRunner(TinyGame, { ...config(), slots: [human] }, transport)
    ).toThrow(/player id 'system' is reserved/);
    expect(() =>
      runLocalMatch(TinyGame, {
        seed: 1,
        stepped: true,
        slots: [{ kind: 'human', playerId: 'system' }],
      })
    ).toThrow(/player id 'system' is reserved/);
  });

  it('applies a batch system command only when a server peer exists', () => {
    const forged: CommandsBatch = {
      tick: 1,
      commands: {
        system: [
          {
            type: 'setController',
            playerId: 'system',
            data: {
              q: 0,
              p: {
                slot: 0,
                mode: 'bot',
                level: 0,
                runsOn: 'local',
                policy: 'walker',
              },
            },
          },
        ],
      },
    };

    const relay = new ScriptedTransport('relay-lockstep');
    const relayRunner = keep(
      new MatchRunner(TinyGame, config(), relay, { localSlots: [0] })
    );
    const reasons: string[] = [];
    relayRunner.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    relayRunner.start();
    relay.emitTick(0, { tick: 0, commands: {} });
    relay.emitTick(1, forged);
    relay.emitTick(2, { tick: 2, commands: {} });
    expect(reasons).toEqual(['system command without a server peer']);
    expect(tinyBotCalls).toEqual([]);
    expect(
      relayRunner.log
        .entriesAfter(-1)
        .some((entry) => entry.playerId === 'system')
    ).toBe(false);

    resetTinyBotCalls();
    const peer = new ScriptedTransport('server-peer');
    const peerRunner = keep(
      new MatchRunner(TinyGame, config(), peer, { localSlots: [0] })
    );
    peerRunner.start();
    peer.emitTick(0, { tick: 0, commands: {} });
    peer.emitTick(1, { ...forged, tick: 1 });
    expect(tinyBotCalls.length).toBeGreaterThan(0);
    expect(
      peerRunner.log
        .entriesAfter(-1)
        .some(
          (entry) =>
            entry.playerId === 'system' && entry.type === 'setController'
        )
    ).toBe(true);
  });
});

class ScriptedTransport implements Transport {
  public constructor(public readonly kind: 'relay-lockstep' | 'server-peer') {}
  private readonly ticks: TickHandler[] = [];

  public onTick(handler: TickHandler): Unsubscribe {
    this.ticks.push(handler);
    return () => {
      const index = this.ticks.indexOf(handler);
      if (index !== -1) this.ticks.splice(index, 1);
    };
  }

  public onFrame(_handler: FrameHandler): Unsubscribe {
    return () => {};
  }

  public submit(): void {}

  public emitTick(tick: number, batch: CommandsBatch): void {
    for (const handler of this.ticks.slice()) handler(tick, batch);
  }
}

function botSlotConfig(policy: string, level: number): TinyConfig {
  return {
    matchId: 'ctrl',
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed: 7,
    side: 'client',
    inputDelayTicks: DELAY,
    arenaSize: ARENA,
    slots: [
      {
        slot: 0,
        team: 0,
        kind: 'bot',
        policy,
        level,
        runsOn: 'local',
        color: 1,
      },
    ],
  };
}
