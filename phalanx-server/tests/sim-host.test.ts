import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
import { io, type Socket } from 'socket.io-client';
import { MatchRunner, type AnyGameDefinition } from '@phalanx-engine/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { Phalanx } from '../src/Phalanx.js';
import type { CommandsBatchEvent, PhalanxConfig } from '../src/types/index.js';
import { InProcessSimHost } from '../src/sim/InProcessSimHost.js';
import { postSimOut } from '../src/sim/postTransfer.js';
import { RelayFeedTransport } from '../src/sim/RelayFeedTransport.js';
import type { SimCommand, SimIn, SimOut } from '../src/sim/messages.js';
import { WorkerSimHost, simWorkersSpawned } from '../src/sim/WorkerSimHost.js';
import { holdReleasePath, RELAY_CONFIG_KEYS } from './fixtures/relayGame.js';
import type { SimHost } from '../src/sim/SimHost.js';

const fixtureHref = new URL('./fixtures/relayGame.ts', import.meta.url).href;

const servers: Phalanx[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0, sockets.length)) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  for (const server of servers.splice(0, servers.length)) {
    await server.stop();
  }
});

function relayConfig(
  extra: Partial<PhalanxConfig> = {}
): Partial<PhalanxConfig> {
  return {
    port: 0,
    tickRate: 64,
    countdownSeconds: 0,
    disconnectTicks: 100000,
    timeoutTicks: 10000,
    playersConnectTimeoutMs: 20000,
    readyTimeoutMs: 10000,
    games: [
      {
        module: fixtureHref,
        export: 'RelayGame',
        configKeys: [...RELAY_CONFIG_KEYS],
      },
    ],
    simHost: { mode: 'worker' },
    ...extra,
  };
}

async function startServer(
  extra: Partial<PhalanxConfig> = {}
): Promise<Phalanx> {
  const server = new Phalanx(relayConfig(extra));
  servers.push(server);
  await server.start();
  return server;
}

function connect(port: number): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => reject(error));
  });
}

function onceEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (data: T) => resolve(data));
  });
}

function twoHumans(hostId: string, guestId: string) {
  return {
    gameId: 'relay-fixture',
    simMode: 'server' as const,
    slots: [
      { slot: 0, team: 0, kind: 'human' as const, playerId: hostId },
      { slot: 1, team: 1, kind: 'human' as const, playerId: guestId },
    ],
  };
}

function humanBot(playerId: string, extra: Record<string, number> = {}) {
  return {
    gameId: 'relay-fixture',
    simMode: 'server' as const,
    slots: [
      { slot: 0, team: 0, kind: 'human' as const, playerId },
      {
        slot: 1,
        team: 1,
        kind: 'bot' as const,
        policy: 'walker',
        level: 0,
        runsOn: 'server' as const,
      },
    ],
    ...extra,
  };
}

async function loadFixture(): Promise<AnyGameDefinition> {
  const imported = (await import(fixtureHref)) as {
    RelayGame: AnyGameDefinition;
  };
  return imported.RelayGame;
}

async function openServerMatch(
  port: number,
  playerId: string,
  extra: Record<string, number> = {}
): Promise<{
  socket: Socket;
  matchId: string;
  matchConfig: Record<string, unknown>;
}> {
  const socket = await connect(port);
  const started = onceEvent<{
    matchId: string;
    matchConfig?: Record<string, unknown>;
  }>(socket, 'game-start');
  socket.emit('room-create', {
    playerId,
    username: playerId,
    matchConfig: humanBot(playerId, extra),
  });
  const start = await started;
  return {
    socket,
    matchId: start.matchId,
    matchConfig: start.matchConfig ?? {},
  };
}

describe('SimHost', () => {
  it('does not spawn a worker when games is omitted', async () => {
    const before = simWorkersSpawned();
    const server = new Phalanx({ port: 0 });
    servers.push(server);
    await server.start();
    expect(simWorkersSpawned()).toBe(before);
    const socket = await connect(server.getPort());
    const error = onceEvent<{ message: string }>(socket, 'room-error');
    socket.emit('room-create', {
      playerId: 'solo',
      username: 'solo',
      matchConfig: humanBot('solo'),
    });
    const payload = await error;
    expect(payload.message).toContain('not configured');
  });

  it('detaches the snapshot buffer it posts', async () => {
    const { port1, port2 } = new MessageChannel();
    const original = new Uint8Array([1, 2, 3, 4]).buffer;
    const received = once(port2, 'message') as Promise<[SimOut]>;
    postSimOut(port1, {
      t: 'snapshot',
      matchId: 'm',
      tick: 1,
      bytes: original,
    });
    expect(original.byteLength).toBe(0);
    const [message] = await received;
    expect(message.t).toBe('snapshot');
    if (message.t !== 'snapshot') return;
    expect(new Uint8Array(message.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
    port1.close();
    port2.close();
  });

  it('matches in-process and worker digests, bots and snapshots', async () => {
    const local = new InProcessSimHost(new Map());
    const worker = new WorkerSimHost();
    try {
      const left = await driveHost(local, 'same');
      const right = await driveHost(worker, 'same');
      expect(left.digests).toEqual(right.digests);
      expect(left.bots).toEqual(right.bots);
      expect(left.snap.length).toBeGreaterThan(0);
      expect(Buffer.from(left.snap).equals(Buffer.from(right.snap))).toBe(true);
    } finally {
      await local.close();
      await worker.close();
    }
  });

  it('keeps a client runner on the server hash for 500 ticks', async () => {
    const server = await startServer();
    const serverDigests = new Map<number, string>();
    server.on('sim-digest', (matchId: string, tick: number, digest: string) => {
      serverDigests.set(tick, `${matchId}:${digest}`);
    });
    const { socket, matchId, matchConfig } = await openServerMatch(
      server.getPort(),
      'human'
    );
    const definition = await loadFixture();
    const transport = new RelayFeedTransport();
    const runner = new MatchRunner(
      definition,
      { ...matchConfig, side: 'client' } as never,
      transport,
      { hashEveryTicks: 60 }
    );
    const clientDigests = new Map<number, string>();
    let desync = false;
    let sawBot = false;
    socket.on('desync', () => {
      desync = true;
    });
    runner.onDigest((tick, digest) => {
      clientDigests.set(tick, digest);
      socket.emit('state-hash', { tick, hash: digest });
    });
    runner.start();
    socket.emit('client-ready');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('500 ticks timed out')),
        40000
      );
      socket.on('commands-batch', (batch: CommandsBatchEvent) => {
        if (
          batch.commands.some((command) => command.playerId.startsWith('bot:'))
        ) {
          sawBot = true;
        }
        transport.deliver(batch.tick, batch.commands);
        if (batch.tick >= 499) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await waitFor(
      () =>
        clientDigests.has(480) &&
        [...serverDigests.keys()].some((key) => key === 480),
      5000
    );
    expect(sawBot).toBe(true);
    expect(desync).toBe(false);
    for (const [tick, digest] of clientDigests) {
      expect(serverDigests.get(tick)).toBe(`${matchId}:${digest}`);
    }
    expect(clientDigests.size).toBeGreaterThan(1);
    runner.dispose();
  }, 45000);

  it('restores an on-demand snapshot into a fresh client runner', async () => {
    const server = await startServer();
    const serverDigests = new Map<number, string>();
    server.on(
      'sim-digest',
      (_matchId: string, tick: number, digest: string) => {
        serverDigests.set(tick, digest);
      }
    );
    const { socket, matchConfig } = await openServerMatch(
      server.getPort(),
      'snap'
    );
    socket.emit('client-ready');
    const definition = await loadFixture();
    const batches: CommandsBatchEvent[] = [];
    const snapshotPromise = onceEvent<{
      tick: number;
      bytes: Uint8Array | ArrayBuffer;
      requestId: number;
    }>(socket, 'match-snapshot');
    await new Promise<void>((resolve) => {
      socket.on('commands-batch', (batch: CommandsBatchEvent) => {
        batches.push(batch);
        if (batch.tick === 80) {
          socket.emit('match-snapshot-request', { requestId: 7 });
        }
        if (batch.tick >= 200) resolve();
      });
    });
    const snapshot = await snapshotPromise;
    expect(snapshot.requestId).toBe(7);
    const bytes = snapshotBytes(snapshot.bytes);
    const transport = new RelayFeedTransport();
    const runner = new MatchRunner(
      definition,
      { ...matchConfig, side: 'client' } as never,
      transport,
      { hashEveryTicks: 60 }
    );
    const clientDigests = new Map<number, string>();
    runner.onDigest((tick, digest) => {
      clientDigests.set(tick, digest);
    });
    runner.start();
    runner.restore(bytes);
    for (const batch of batches) {
      if (batch.tick <= snapshot.tick) continue;
      transport.deliver(batch.tick, batch.commands);
    }
    await waitFor(() => serverDigests.has(180) && clientDigests.has(180), 5000);
    expect(clientDigests.get(180)).toBe(serverDigests.get(180));
    runner.dispose();
  }, 20000);

  it('attributes a bad client hash to that player only', async () => {
    const server = await startServer();
    const host = await connect(server.getPort());
    const guest = await connect(server.getPort());
    const created = onceEvent<{ code: string }>(host, 'room-created');
    const hostStart = onceEvent(host, 'game-start');
    const guestStart = onceEvent(guest, 'game-start');
    host.emit('room-create', {
      playerId: 'h1',
      username: 'h1',
      matchConfig: {
        gameId: 'relay-fixture',
        simMode: 'server',
        slots: [
          { slot: 0, team: 0, kind: 'human', playerId: 'h1' },
          { slot: 1, team: 1, kind: 'human', playerId: 'h2' },
        ],
      },
    });
    const room = await created;
    guest.emit('room-join', {
      playerId: 'h2',
      username: 'h2',
      code: room.code,
    });
    await hostStart;
    await guestStart;
    host.emit('client-ready');
    guest.emit('client-ready');
    await onceEvent(host, 'commands-batch');
    let guestDesync = false;
    let hostDesyncs = 0;
    guest.on('desync', () => {
      guestDesync = true;
    });
    host.on('desync', () => {
      hostDesyncs += 1;
    });
    const desync = onceEvent<{ playerId: string; tick: number }>(
      host,
      'desync'
    );
    host.emit('state-hash', { tick: 0, hash: 'not-the-server-digest' });
    const payload = await desync;
    expect(payload).toEqual({ playerId: 'h1', tick: 0 });
    host.emit('state-hash', { tick: 0, hash: 'still-wrong' });
    host.emit('state-hash', { tick: 60, hash: 'also-wrong' });
    const later = onceEvent(host, 'commands-batch');
    await later;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hostDesyncs).toBe(1);
    expect(guestDesync).toBe(false);
  });

  it('ends only the match that throws', async () => {
    const server = await startServer();
    const relay = await openRelay(server.getPort());
    const bad = await openServerMatch(server.getPort(), 'boom', { throwAt: 3 });
    const ended = onceEvent<{ reason: string }>(bad.socket, 'match-end');
    bad.socket.emit('client-ready');
    const sibling = await openServerMatch(server.getPort(), 'ok');
    const siblingBatch = onceEvent(sibling.socket, 'commands-batch');
    sibling.socket.emit('client-ready');
    expect((await ended).reason).toBe('sim-error');
    const relayBefore = relay.batches.length;
    await onceEvent(relay.a, 'commands-batch');
    await siblingBatch;
    expect(relay.batches.length).toBeGreaterThan(relayBefore);
  });

  it('ends only the match that calls process.exit', async () => {
    const server = await startServer();
    const relay = await openRelay(server.getPort());
    const bad = await openServerMatch(server.getPort(), 'exit', { exitAt: 3 });
    const ended = onceEvent<{ reason: string }>(bad.socket, 'match-end');
    bad.socket.emit('client-ready');
    const sibling = await openServerMatch(server.getPort(), 'stay');
    const siblingBatch = onceEvent(sibling.socket, 'commands-batch');
    sibling.socket.emit('client-ready');
    expect((await ended).reason).toBe('sim-crash');
    await onceEvent(relay.a, 'commands-batch');
    await siblingBatch;
  });

  it('reports sim-oom for a tiny worker heap and keeps the relay ticking', async () => {
    const server = await startServer({
      simHost: {
        mode: 'worker',
        resourceLimits: { maxOldGenerationSizeMb: 16 },
      },
    });
    const relay = await openRelay(server.getPort());
    const socket = await connect(server.getPort());
    const ended = onceEvent<{ reason: string }>(socket, 'match-end');
    const started = onceEvent(socket, 'game-start');
    socket.emit('room-create', {
      playerId: 'oom',
      username: 'oom',
      matchConfig: humanBot('oom', { allocMb: 64 }),
    });
    await started;
    socket.emit('client-ready');
    expect((await ended).reason).toBe('sim-oom');
    const before = relay.batches.length;
    await onceEvent(relay.a, 'commands-batch');
    expect(relay.batches.length).toBeGreaterThan(before);
    const next = await connect(server.getPort());
    let sawStart = false;
    next.on('game-start', () => {
      sawStart = true;
    });
    const refused = onceEvent<{ message: string; reason?: string }>(
      next,
      'room-error'
    );
    next.emit('room-create', {
      playerId: 'next',
      username: 'next',
      matchConfig: humanBot('next'),
    });
    expect(await refused).toEqual({
      message: 'Server simulation is unavailable',
      reason: 'sim-unavailable',
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sawStart).toBe(false);
    const stopped = Date.now();
    await server.stop();
    expect(Date.now() - stopped).toBeLessThan(1000);
  }, 20000);

  it('keeps a relay room ticking while a worker tick is heavy', async () => {
    const server = await startServer();
    const relay = await openRelay(server.getPort());
    const heavy = await openServerMatch(server.getPort(), 'heavy', {
      blockMs: 80,
    });
    heavy.socket.emit('client-ready');
    await onceEvent(relay.a, 'commands-batch');
    const startedAt = relay.batches.length;
    await new Promise((resolve) => setTimeout(resolve, 800));
    const gained = relay.batches.length - startedAt;
    expect(gained).toBeGreaterThanOrEqual(20);
  });

  it('ends a match from Phalanx.endMatch and archives once', async () => {
    let archives = 0;
    const server = await startServer({
      simHost: { mode: 'inProcess' },
      onMatchArchived: () => {
        archives += 1;
      },
    });
    const { socket, matchId } = await openServerMatch(server.getPort(), 'end');
    const playing = onceEvent(socket, 'commands-batch');
    socket.emit('client-ready');
    await playing;
    const ended = onceEvent<{ reason: string; winnerTeamId?: number }>(
      socket,
      'match-end'
    );
    expect(
      server.endMatch(matchId, { reason: 'forfeit', winnerTeamId: 0 })
    ).toBe(true);
    const payload = await ended;
    expect(payload.reason).toBe('forfeit');
    expect(payload.winnerTeamId).toBe(0);
    expect(
      server.endMatch(matchId, { reason: 'forfeit', winnerTeamId: 0 })
    ).toBe(false);
    expect(server.endMatch('missing', { reason: 'forfeit' })).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(archives).toBe(1);
  });

  it('keeps bot commands on their tick when the sim is slow', async () => {
    const server = await startServer();
    const serverDigests = new Map<number, string>();
    let lags = 0;
    server.on(
      'sim-digest',
      (_matchId: string, tick: number, digest: string) => {
        serverDigests.set(tick, digest);
      }
    );
    const { socket, matchId, matchConfig } = await openServerMatch(
      server.getPort(),
      'slow',
      { stall: 1 }
    );
    // The worker blocks in tick 0 until this file exists. Writing it
    // from `sim-lag` is what releases the sim, so the lead is forced
    // instead of racing a wall-clock spin against the relay timer.
    const releasePath = holdReleasePath(matchId);
    server.on('sim-lag', () => {
      lags += 1;
      writeFileSync(releasePath, '1');
    });
    const definition = await loadFixture();
    const transport = new RelayFeedTransport();
    const runner = new MatchRunner(
      definition,
      { ...matchConfig, side: 'client' } as never,
      transport,
      { hashEveryTicks: 60 }
    );
    try {
      const clientDigests = new Map<number, string>();
      let sawBot = false;
      let botOnDelayTick = false;
      let lateBot = false;
      runner.onDigest((tick, digest) => {
        clientDigests.set(tick, digest);
      });
      runner.start();
      socket.emit('client-ready');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('slow sim ticks timed out')),
          15000
        );
        socket.on('commands-batch', (batch: CommandsBatchEvent) => {
          for (const command of batch.commands) {
            if (!command.playerId.startsWith('bot:')) continue;
            sawBot = true;
            if (batch.tick === 2) botOnDelayTick = true;
            if (command.tick !== batch.tick) lateBot = true;
          }
          transport.deliver(batch.tick, batch.commands);
          if (batch.tick >= 60) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await waitFor(() => clientDigests.has(60) && serverDigests.has(60), 5000);
      expect(sawBot).toBe(true);
      expect(botOnDelayTick).toBe(true);
      expect(lateBot).toBe(false);
      expect(lags).toBeGreaterThan(0);
      expect(clientDigests.get(60)).toBe(serverDigests.get(60));
    } finally {
      writeFileSync(releasePath, '1');
      runner.dispose();
    }
  }, 20000);

  it('stops the room when the sim reports an outcome', async () => {
    const server = await startServer();
    const { socket } = await openServerMatch(server.getPort(), 'win', {
      winAt: 3,
    });
    const ticks: number[] = [];
    socket.on('commands-batch', (batch: CommandsBatchEvent) => {
      ticks.push(batch.tick);
    });
    const ended = onceEvent<{ reason: string; winnerTeamId?: number }>(
      socket,
      'match-end'
    );
    socket.emit('client-ready');
    const payload = await ended;
    expect(payload.reason).toBe('fixture-win');
    expect(payload.winnerTeamId).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(3);
  });

  it('shutdown waits for an async archive hook on a live server match', async () => {
    let archived = 0;
    let release: () => void = () => {};
    const hook = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = await startServer({
      shutdownGraceMs: 2000,
      onMatchArchived: () => {
        archived += 1;
        return hook;
      },
    });
    const { socket } = await openServerMatch(server.getPort(), 'arch');
    const playing = onceEvent(socket, 'commands-batch');
    socket.emit('client-ready');
    await playing;
    let settled = false;
    const pending = server.shutdown('deploy');
    void pending.then(() => {
      settled = true;
    });
    await waitFor(() => archived === 1, 2000);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);
    release();
    await pending;
    expect(settled).toBe(true);
    expect(archived).toBe(1);
  });

  it('reserves maxMatches on create and does not count the join again', async () => {
    const server = await startServer({
      simHost: { mode: 'worker', maxMatches: 1 },
    });
    const host = await connect(server.getPort());
    const guest = await connect(server.getPort());
    const other = await connect(server.getPort());
    const created = onceEvent<{ code: string }>(host, 'room-created');
    host.emit('room-create', {
      playerId: 'h1',
      username: 'h1',
      matchConfig: twoHumans('h1', 'h2'),
    });
    const room = await created;
    const blocked = onceEvent<{ message: string }>(other, 'room-error');
    other.emit('room-create', {
      playerId: 'other',
      username: 'other',
      matchConfig: humanBot('other'),
    });
    expect((await blocked).message).toBe('Server match capacity reached');
    const hostStart = onceEvent<{ matchId: string }>(host, 'game-start');
    const guestStart = onceEvent(guest, 'game-start');
    guest.emit('room-join', {
      playerId: 'h2',
      username: 'h2',
      code: room.code,
    });
    const started = await hostStart;
    await guestStart;
    const stillFull = onceEvent<{ message: string }>(other, 'room-error');
    other.emit('room-create', {
      playerId: 'other',
      username: 'other',
      matchConfig: humanBot('other'),
    });
    expect((await stillFull).message).toBe('Server match capacity reached');
    const ended = onceEvent(host, 'match-end');
    expect(server.endMatch(started.matchId, { reason: 'forfeit' })).toBe(true);
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const again = onceEvent(other, 'game-start');
    other.emit('room-create', {
      playerId: 'other',
      username: 'other',
      matchConfig: humanBot('other'),
    });
    await again;
  });

  it('releases maxMatches when a waiting server room is cancelled', async () => {
    const server = await startServer({
      simHost: { mode: 'worker', maxMatches: 1 },
    });
    const host = await connect(server.getPort());
    const created = onceEvent<{ code: string }>(host, 'room-created');
    host.emit('room-create', {
      playerId: 'h1',
      username: 'h1',
      matchConfig: twoHumans('h1', 'h2'),
    });
    await created;
    const cancelled = onceEvent(host, 'room-cancelled');
    host.emit('room-cancel');
    await cancelled;
    const next = onceEvent(host, 'game-start');
    host.emit('room-create', {
      playerId: 'h1',
      username: 'h1',
      matchConfig: humanBot('h1'),
    });
    await next;
  });

  it('forfeits an absent human after the stand-in bot expires', async () => {
    const server = await startServer({
      absence: { windowMs: 80, matchBudgetMs: 80 },
      simHost: { mode: 'inProcess' },
    });
    const host = await connect(server.getPort());
    const guest = await connect(server.getPort());
    const created = onceEvent<{ code: string }>(host, 'room-created');
    host.emit('room-create', {
      playerId: 'h1',
      username: 'h1',
      matchConfig: {
        ...twoHumans('h1', 'h2'),
        absencePolicy: 'walker',
      },
    });
    const room = await created;
    const hostStart = onceEvent(host, 'game-start');
    const guestStart = onceEvent(guest, 'game-start');
    guest.emit('room-join', {
      playerId: 'h2',
      username: 'h2',
      code: room.code,
    });
    await hostStart;
    await guestStart;
    host.emit('client-ready');
    guest.emit('client-ready');
    await onceEvent(guest, 'commands-batch');
    const ended = onceEvent<{ reason: string }>(guest, 'match-end');
    host.disconnect();
    expect((await ended).reason).toBe('disconnect');
  });

  it('names each bot command by its slot', async () => {
    const server = await startServer();
    const socket = await connect(server.getPort());
    const started = onceEvent(socket, 'game-start');
    socket.emit('room-create', {
      playerId: 'h',
      username: 'h',
      matchConfig: {
        gameId: 'relay-fixture',
        simMode: 'server',
        slots: [
          { slot: 0, team: 0, kind: 'human', playerId: 'h' },
          {
            slot: 1,
            team: 0,
            kind: 'bot',
            policy: 'walker',
            level: 0,
            runsOn: 'server',
          },
          {
            slot: 2,
            team: 1,
            kind: 'bot',
            policy: 'walker',
            level: 0,
            runsOn: 'server',
          },
        ],
      },
    });
    await started;
    const ids = new Set<string>();
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('bot slots timed out')),
        5000
      );
      socket.on('commands-batch', (batch: CommandsBatchEvent) => {
        for (const command of batch.commands) {
          if (command.playerId.startsWith('bot:')) ids.add(command.playerId);
        }
        if (batch.tick >= 4) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    socket.emit('client-ready');
    await done;
    expect(ids.has('bot:1')).toBe(true);
    expect(ids.has('bot:2')).toBe(true);
    expect(ids.has('bot:0')).toBe(false);
  });

  it('answers each snapshot request to that player only', async () => {
    const server = await startServer({ simHost: { mode: 'inProcess' } });
    const host = await connect(server.getPort());
    const guest = await connect(server.getPort());
    const created = onceEvent<{ code: string }>(host, 'room-created');
    host.emit('room-create', {
      playerId: 'h1',
      username: 'h1',
      matchConfig: twoHumans('h1', 'h2'),
    });
    const room = await created;
    const hostStart = onceEvent(host, 'game-start');
    const guestStart = onceEvent(guest, 'game-start');
    guest.emit('room-join', {
      playerId: 'h2',
      username: 'h2',
      code: room.code,
    });
    await hostStart;
    await guestStart;
    host.emit('client-ready');
    guest.emit('client-ready');
    await onceEvent(host, 'commands-batch');
    const hostSnap = onceEvent<{ requestId: number }>(host, 'match-snapshot');
    const guestSnap = onceEvent<{ requestId: number }>(guest, 'match-snapshot');
    host.emit('match-snapshot-request', { requestId: 1 });
    guest.emit('match-snapshot-request', { requestId: 1 });
    expect((await hostSnap).requestId).toBe(1);
    expect((await guestSnap).requestId).toBe(1);
    let guestExtra = 0;
    guest.on('match-snapshot', () => {
      guestExtra += 1;
    });
    const onlyHost = onceEvent<{ requestId: number }>(host, 'match-snapshot');
    host.emit('match-snapshot-request', { requestId: 9 });
    expect((await onlyHost).requestId).toBe(9);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(guestExtra).toBe(0);
  });

  it('rejects matchConfig keys the game did not allow', async () => {
    const server = await startServer();
    const socket = await connect(server.getPort());
    const error = onceEvent<{ message: string }>(socket, 'room-error');
    socket.emit('room-create', {
      playerId: 'h',
      username: 'h',
      matchConfig: { ...humanBot('h'), injected: 1 },
    });
    expect((await error).message).toBe('matchConfig.injected is not allowed');
  });

  it('closes the host after each sim has ended', async () => {
    const server = await startServer();
    const faults: string[] = [];
    server.on(
      'sim-fault',
      (_matchId: string, _reason: string, message: string) => {
        faults.push(message);
      }
    );
    const { socket } = await openServerMatch(server.getPort(), 'bye');
    const playing = onceEvent(socket, 'commands-batch');
    socket.emit('client-ready');
    await playing;
    const started = Date.now();
    await server.stop();
    expect(Date.now() - started).toBeLessThan(1500);
    expect(faults.some((message) => message.includes('process.exit(0)'))).toBe(
      false
    );
  });
});

async function openRelay(
  port: number
): Promise<{ a: Socket; batches: number[] }> {
  const a = await connect(port);
  const b = await connect(port);
  const batches: number[] = [];
  const startA = onceEvent(a, 'game-start');
  const startB = onceEvent(b, 'game-start');
  a.on('commands-batch', (batch: CommandsBatchEvent) => {
    batches.push(batch.tick);
  });
  a.emit('queue-join', {
    playerId: `relay-a-${String(port)}-${String(batches.length)}`,
    username: 'a',
  });
  b.emit('queue-join', {
    playerId: `relay-b-${String(port)}-${String(Math.random())}`,
    username: 'b',
  });
  await startA;
  await startB;
  a.emit('client-ready');
  b.emit('client-ready');
  return { a, batches };
}

function snapshotBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

async function driveHost(
  host: SimHost,
  matchId: string
): Promise<{ digests: string[]; bots: string[]; snap: Uint8Array }> {
  const received: SimOut[] = [];
  let notify: (() => void) | null = null;
  host.subscribe((message) => {
    if (!('matchId' in message) || message.matchId !== matchId) return;
    received.push(message);
    notify?.();
    notify = null;
  });
  const until = async (ready: () => boolean): Promise<void> => {
    for (;;) {
      if (ready()) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  };
  const config = {
    matchId,
    gameId: 'relay-fixture',
    simVersion: 'relay-1',
    seed: 1,
    side: 'server',
    inputDelayTicks: 2,
    slots: humanBot('human').slots,
  };
  const open: SimIn = {
    t: 'open',
    matchId,
    module: fixtureHref,
    exportName: 'RelayGame',
    config,
    snapshotEveryTicks: 0,
    hashEveryTicks: 1,
  };
  host.post(open);
  await until(() => received.some((message) => message.t === 'opened'));
  const scheduled = new Map<number, SimCommand[]>();
  const digests: string[] = [];
  const bots: string[] = [];
  for (let tick = 0; tick < 20; tick += 1) {
    const before = received.length;
    host.post({
      t: 'batch',
      matchId,
      tick,
      commands: scheduled.get(tick) ?? [],
    });
    await until(() =>
      received
        .slice(before)
        .some((message) => message.t === 'tick' && message.tick === tick)
    );
    for (const message of received.slice(before)) {
      if (message.t === 'digest')
        digests.push(`${String(message.tick)}:${message.digest}`);
      if (message.t !== 'botCommands') continue;
      bots.push(JSON.stringify(message.commands));
      for (const command of message.commands) {
        const list = scheduled.get(command.tick) ?? [];
        list.push(command);
        scheduled.set(command.tick, list);
      }
    }
  }
  const beforeSnap = received.length;
  host.post({ t: 'snapshot', matchId, requestId: 1 });
  await until(() =>
    received.slice(beforeSnap).some((message) => message.t === 'snapshot')
  );
  const snapshot = received
    .slice(beforeSnap)
    .find((message) => message.t === 'snapshot');
  if (snapshot === undefined || snapshot.t !== 'snapshot') {
    throw new Error('missing snapshot');
  }
  return { digests, bots, snap: new Uint8Array(snapshot.bytes) };
}

function waitFor(ready: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (ready()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, 20);
  });
}
