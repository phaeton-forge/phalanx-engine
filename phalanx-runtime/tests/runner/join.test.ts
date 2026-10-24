import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CommandsBatch,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import {
  BotHost,
  LocalTransport,
  MatchRunner,
  decodeSnapshot,
  type Digest,
  type LogEntry,
} from '../../src/index.js';
import type {
  Transport,
  TransportCatchUp,
  TransportJoin,
} from '../../src/transport/Transport.js';
import { RelayGame, type RelayConfig } from '../server/fixtures/relayGame.js';

function config(side: 'client' | 'server'): RelayConfig {
  return {
    matchId: 'join',
    gameId: RelayGame.id,
    simVersion: RelayGame.simVersion,
    seed: 11,
    side,
    inputDelayTicks: 2,
    slots: [
      { slot: 0, team: 0, kind: 'human', playerId: 'p1' },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'walker',
        level: 0,
        runsOn: 'server',
      },
    ],
  };
}

class FakeTransport implements Transport {
  public readonly kind = 'server-peer' as const;
  public readonly hashes: [number, Digest][] = [];
  public resyncCalls = 0;
  public resyncReply: Promise<TransportCatchUp> = new Promise(() => {});
  private readonly ticks = new Set<TickHandler>();
  private readonly desyncs = new Set<(tick: number) => void>();

  public constructor(private readonly joined: TransportJoin) {}

  public onTick(handler: TickHandler): Unsubscribe {
    this.ticks.add(handler);
    return () => this.ticks.delete(handler);
  }

  public onFrame(): Unsubscribe {
    return () => {};
  }

  public submit(): void {}

  public join(): Promise<TransportJoin> {
    return Promise.resolve(this.joined);
  }

  public submitHash(tick: number, digest: Digest): void {
    this.hashes.push([tick, digest]);
  }

  public onDesync(handler: (tick: number) => void): Unsubscribe {
    this.desyncs.add(handler);
    return () => this.desyncs.delete(handler);
  }

  public requestResync(): Promise<TransportCatchUp> {
    this.resyncCalls += 1;
    return this.resyncReply;
  }

  public tick(tick: number, batch?: CommandsBatch): void {
    for (const handler of [...this.ticks]) {
      handler(tick, batch ?? { tick, commands: {} });
    }
  }

  public desync(tick: number): void {
    for (const handler of [...this.desyncs]) handler(tick);
  }

  public get desyncListeners(): number {
    return this.desyncs.size;
  }
}

interface ServerRun {
  readonly runner: MatchRunner<typeof RelayGame>;
  readonly transport: LocalTransport;
}

const runners: MatchRunner<typeof RelayGame>[] = [];

function serverRun(ticks: number): ServerRun {
  const transport = LocalTransport.stepped();
  const runner = new MatchRunner(RelayGame, config('server'), transport);
  runners.push(runner);
  runner.start();
  transport.step(ticks);
  return { runner, transport };
}

async function join(joined: TransportJoin): Promise<{
  runner: MatchRunner<typeof RelayGame>;
  transport: FakeTransport;
}> {
  const transport = new FakeTransport(joined);
  const runner = await MatchRunner.join(RelayGame, transport);
  runners.push(runner);
  return { runner, transport };
}

function log(server: ServerRun, afterTick: number): readonly LogEntry[] {
  return server.runner.log.entriesAfter(afterTick);
}

afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  vi.restoreAllMocks();
});

describe('MatchRunner.join', () => {
  it('rejects a transport without join()', async () => {
    const transport = new FakeTransport({ config: {}, localSlots: [] });
    const plain: Transport = {
      kind: transport.kind,
      onTick: (handler) => transport.onTick(handler),
      onFrame: () => () => {},
      submit: () => {},
    };
    await expect(MatchRunner.join(RelayGame, plain)).rejects.toThrow(
      'MatchRunner.join: transport does not support join()'
    );
  });

  it('starts a fresh match without catch-up', async () => {
    const { runner, transport } = await join({
      config: config('client'),
      localSlots: [0],
    });
    expect(runner.status).toBe('running');
    expect(runner.tick).toBe(-1);
    transport.tick(0);
    transport.tick(1);
    expect(runner.tick).toBe(1);
  });

  it('restores a snapshot, ignores bot state and checkpoint, replays the log', async () => {
    const server = serverRun(30);
    const bytes = server.runner.snapshot();
    const decoded = decodeSnapshot(bytes);
    expect(decoded.botState?.byteLength ?? 0).toBeGreaterThan(0);
    expect(decoded.inputCheckpoint?.byteLength ?? 0).toBeGreaterThan(0);
    server.transport.step(20);
    const botRestore = vi.spyOn(BotHost.prototype, 'restore');
    const { runner, transport } = await join({
      config: config('client'),
      localSlots: [0],
      catchUp: { snapshot: bytes, log: log(server, 29), currentTick: 50 },
    });
    expect(botRestore).not.toHaveBeenCalled();
    expect(runner.tick).toBe(49);
    expect(runner.sim.x).toBe(server.runner.sim.x);
    expect(runner.digest()).toBe(server.runner.digest());
    expect(runner.status).toBe('running');
    server.transport.step(1);
    const live = server.runner.log
      .entriesAfter(49)
      .filter((entry) => entry.tick === 50);
    transport.tick(50, {
      tick: 50,
      commands: {
        'bot:1': live.map((entry) => ({
          type: entry.type,
          tick: 50,
          playerId: entry.playerId,
          data: entry.data,
        })),
      },
    });
    expect(runner.tick).toBe(50);
    expect(runner.digest()).toBe(server.runner.digest());
  });

  it('replays the log from tick 0 without a snapshot', async () => {
    const server = serverRun(40);
    const { runner } = await join({
      config: config('client'),
      localSlots: [0],
      catchUp: { log: log(server, -1), currentTick: 40 },
    });
    expect(runner.tick).toBe(39);
    expect(runner.sim.x).toBe(server.runner.sim.x);
    expect(runner.digest()).toBe(server.runner.digest());
  });

  it('runs one resync at a time and ignores the server bot state', async () => {
    const server = serverRun(30);
    const { runner, transport } = await join({
      config: config('client'),
      localSlots: [0],
      catchUp: { log: log(server, -1), currentTick: 30 },
    });
    expect(transport.desyncListeners).toBe(1);
    runner.sim.x += 1000;
    expect(runner.digest()).not.toBe(server.runner.digest());

    let reply: (catchUp: TransportCatchUp) => void = () => {};
    transport.resyncReply = new Promise((resolve) => {
      reply = resolve;
    });
    transport.desync(29);
    transport.desync(29);
    transport.desync(29);
    expect(transport.resyncCalls).toBe(1);

    const bytes = server.runner.snapshot();
    expect(decodeSnapshot(bytes).botState?.byteLength ?? 0).toBeGreaterThan(0);
    server.transport.step(10);
    const botRestore = vi.spyOn(BotHost.prototype, 'restore');
    reply({ snapshot: bytes, log: log(server, 29), currentTick: 40 });
    await vi.waitFor(() => {
      expect(runner.tick).toBe(39);
    });
    expect(botRestore).not.toHaveBeenCalled();
    expect(runner.digest()).toBe(server.runner.digest());

    transport.resyncReply = new Promise(() => {});
    transport.desync(39);
    expect(transport.resyncCalls).toBe(2);
    runner.dispose();
    expect(transport.desyncListeners).toBe(0);
  });
});
