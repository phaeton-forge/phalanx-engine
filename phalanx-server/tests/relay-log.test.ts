import { describe, it, expect, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';
import { validateConfig } from '../src/config/validation.js';
import { GameRoom } from '../src/services/GameRoom.js';
import { MatchmakingService } from '../src/services/MatchmakingService.js';
import { PrivateRoomService } from '../src/services/PrivateRoomService.js';
import type {
  MatchFoundEvent,
  MatchLogChunkEvent,
  MatchLogErrorEvent,
  PlayerCommand,
  PhalanxConfig,
} from '../src/types/index.js';

/**
 * Task 8 relay log. Real `Phalanx` plus `socket.io-client`.
 * `port: 0` asks the OS for an ephemeral port; the URL is read from
 * the listening address after `start()`.
 */

interface Started {
  server: Phalanx;
  url: string;
}

const servers: Phalanx[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
  for (const server of servers.splice(0)) {
    await server.stop();
  }
});

/**
 * The Socket.IO socket the server emits on. `io` is private; the cast
 * is only so a test can see emits that a disconnected client would miss.
 */
function serverSocket(
  server: Phalanx,
  socketId: string
): {
  disconnected: boolean;
  disconnect: () => unknown;
  emit: (event: string, ...args: unknown[]) => boolean;
} {
  const internal = server as unknown as {
    io: {
      sockets: {
        sockets: Map<
          string,
          {
            disconnected: boolean;
            disconnect: () => unknown;
            emit: (event: string, ...args: unknown[]) => boolean;
          }
        >;
      };
    } | null;
  };
  const sock = internal.io?.sockets.sockets.get(socketId);
  if (!sock) throw new Error(`no server socket ${socketId}`);
  return sock;
}

function findRoom(server: Phalanx, matchId: string): GameRoom {
  // Production `findMatch` is private. Tests use the same services.
  const internal = server as unknown as {
    matchmaking: MatchmakingService | null;
    privateRooms: PrivateRoomService | null;
  };
  const room =
    internal.matchmaking?.getMatch(matchId) ??
    internal.privateRooms?.getMatch(matchId);
  if (!room) throw new Error(`no room ${matchId}`);
  return room;
}

function listeningUrl(server: Phalanx): string {
  return `http://127.0.0.1:${String(server.getPort())}`;
}

async function startServer(
  overrides: Partial<PhalanxConfig> = {}
): Promise<Started> {
  const server = new Phalanx({
    port: 0,
    tickMode: 'event',
    countdownSeconds: 0,
    readyTimeoutMs: 5000,
    playersConnectTimeoutMs: 5000,
    matchmakingIntervalMs: 30,
    commandHistoryTicks: 'full',
    cors: { origin: '*' },
    ...overrides,
  });
  await server.start();
  servers.push(server);
  return { server, url: listeningUrl(server) };
}

function connect(url: string): Promise<Socket> {
  const socket = io(url, { forceNew: true, transports: ['websocket'] });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err: Error) => reject(err));
  });
}

function onceEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

async function openPrivateMatch(
  url: string,
  buildIds?: { host?: string; guest?: string }
): Promise<{ host: Socket; guest: Socket; matchId: string }> {
  const host = await connect(url);
  const guest = await connect(url);
  const created = onceEvent<{ code: string }>(host, 'room-created');
  const found = onceEvent<MatchFoundEvent>(host, 'match-found');
  const guestFound = onceEvent<MatchFoundEvent>(guest, 'match-found');
  const started = Promise.all([
    onceEvent(host, 'game-start'),
    onceEvent(guest, 'game-start'),
  ]);
  host.emit('room-create', {
    playerId: 'player1',
    username: 'Player1',
    ...(buildIds && 'host' in buildIds ? { buildId: buildIds.host } : {}),
  });
  const { code } = await created;
  guest.emit('room-join', {
    playerId: 'player2',
    username: 'Player2',
    code,
    ...(buildIds && 'guest' in buildIds ? { buildId: buildIds.guest } : {}),
  });
  const match = await found;
  await guestFound;
  await started;
  const bothReady = new Promise<void>((resolve) => {
    const seen = new Set<string>();
    const onReady = (event: { playerId: string }) => {
      seen.add(event.playerId);
      if (seen.size < 2) return;
      host.off('player-ready', onReady);
      resolve();
    };
    host.on('player-ready', onReady);
  });
  host.emit('client-ready');
  guest.emit('client-ready');
  await bothReady;
  return { host, guest, matchId: match.matchId };
}

async function playEventTicks(
  socket: Socket,
  count: number,
  every: number
): Promise<{ tick: number; commands: PlayerCommand[] }[]> {
  const batches: { tick: number; commands: PlayerCommand[] }[] = [];
  const last = count - 1;
  const done = new Promise<void>((resolve) => {
    const onBatch = (batch: { tick: number; commands: PlayerCommand[] }) => {
      if (batch.commands.length > 0) {
        batches.push({ tick: batch.tick, commands: batch.commands });
      }
      if (batch.tick === last) {
        socket.off('commands-batch', onBatch);
        resolve();
      }
    };
    socket.on('commands-batch', onBatch);
  });
  for (let tick = 0; tick < count; tick++) {
    const commands =
      tick % every === 0 ? [{ type: 'ping', data: { n: tick } }] : [];
    socket.emit('submit-commands', { tick, commands });
  }
  await done;
  return batches;
}

function requestLog(
  socket: Socket,
  matchId: string,
  fromTick: number,
  maxTicks?: number,
  requestId?: string
): Promise<MatchLogChunkEvent[]> {
  return new Promise((resolve, reject) => {
    const chunks: MatchLogChunkEvent[] = [];
    const onChunk = (chunk: MatchLogChunkEvent) => {
      if (chunk.matchId !== matchId) return;
      if (requestId !== undefined && chunk.requestId !== requestId) return;
      chunks.push(chunk);
      if (chunk.done) {
        cleanup();
        resolve(chunks);
      }
    };
    const onError = (error: MatchLogErrorEvent) => {
      if (error.matchId !== undefined && error.matchId !== matchId) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('match-log-chunk', onChunk);
      socket.off('match-log-error', onError);
    };
    socket.on('match-log-chunk', onChunk);
    socket.on('match-log-error', onError);
    socket.emit('match-log', {
      matchId,
      fromTick,
      ...(maxTicks !== undefined ? { maxTicks } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
  });
}

function expectLogError(
  socket: Socket,
  payload: unknown
): Promise<MatchLogErrorEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for match-log-error'));
    }, 2000);
    let chunks = 0;
    const onChunk = () => {
      chunks += 1;
    };
    const onError = (error: MatchLogErrorEvent) => {
      cleanup();
      if (chunks > 0) {
        reject(new Error('match-log-chunk was sent with the error'));
        return;
      }
      resolve(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('match-log-chunk', onChunk);
      socket.off('match-log-error', onError);
    };
    socket.on('match-log-chunk', onChunk);
    socket.on('match-log-error', onError);
    socket.emit('match-log', payload);
  });
}

function assertChunkJoints(
  chunks: MatchLogChunkEvent[],
  fromTick: number,
  endTick: number
): void {
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0]!.fromTick).toBe(fromTick);
  expect(chunks[chunks.length - 1]!.toTick).toBe(endTick);
  expect(chunks[chunks.length - 1]!.done).toBe(true);
  const seen: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    expect(chunk.toTick - chunk.fromTick + 1).toBeLessThanOrEqual(2000);
    expect(chunk.toTick).toBeGreaterThanOrEqual(chunk.fromTick);
    expect(chunk.done).toBe(i === chunks.length - 1);
    if (i > 0) {
      expect(chunk.fromTick).toBe(chunks[i - 1]!.toTick + 1);
    }
    for (const entry of chunk.entries) {
      expect(entry.commands.length).toBeGreaterThan(0);
      expect(entry.tick).toBeGreaterThanOrEqual(chunk.fromTick);
      expect(entry.tick).toBeLessThanOrEqual(chunk.toTick);
      seen.push(entry.tick);
    }
  }
  expect(new Set(seen).size).toBe(seen.length);
}

describe('command history config', () => {
  it('keeps the default window and accepts the new opt-in values', () => {
    const defaults = validateConfig({ port: 1 });
    expect(defaults.commandHistoryTicks).toBe(200);
    expect(defaults.requireBuildId).toBeUndefined();
    expect(defaults.shutdownGraceMs).toBeUndefined();
    expect(defaults.handleSignals).toBeUndefined();

    expect(
      validateConfig({ port: 1, commandHistoryTicks: 'full' })
        .commandHistoryTicks
    ).toBe('full');
    expect(
      validateConfig({ port: 1, shutdownGraceMs: 0 }).shutdownGraceMs
    ).toBe(0);

    expect(() => validateConfig({ port: 1, commandHistoryTicks: 0 })).toThrow(
      /commandHistoryTicks/
    );
    expect(() => validateConfig({ port: 1, commandHistoryTicks: 1.5 })).toThrow(
      /commandHistoryTicks/
    );
    expect(() =>
      validateConfig({
        port: 1,
        commandHistoryTicks: 'FULL' as 'full',
      })
    ).toThrow(/commandHistoryTicks/);
    expect(() => validateConfig({ port: 1, shutdownGraceMs: -1 })).toThrow(
      /shutdownGraceMs/
    );
    expect(() => validateConfig({ port: 1, shutdownGraceMs: 1.5 })).toThrow(
      /shutdownGraceMs/
    );
  });
});

describe('full command log', () => {
  it('stores only non-empty ticks across 9000 ticks and matches commands-batch', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    const batches = await playEventTicks(host, 9000, 50);
    const room = findRoom(server, matchId);

    expect(room.getCurrentTick()).toBe(9000);
    expect(room.getStoredTickCount()).toBe(batches.length);
    expect(room.getStoredTickCount()).toBe(180);
    expect(room.getLogRange(0, 8999)).toHaveLength(180);
    expect(room.getOldestLogTick()).toBe(0);

    const chunks = await requestLog(host, matchId, 0);
    assertChunkJoints(chunks, 0, 8999);
    const entries = chunks.flatMap((chunk) => chunk.entries);
    expect(JSON.stringify(entries)).toBe(JSON.stringify(batches));
    // Sparse log: one small command every 50 ticks. Bound, not a snapshot
    // of one JSON encoding.
    expect(Buffer.byteLength(JSON.stringify(entries), 'utf8')).toBeLessThan(
      20_000
    );
  }, 120_000);

  it('matches commands-batch in continuous mode, including sort order', async () => {
    const { server, url } = await startServer({
      tickMode: 'continuous',
      tickRate: 128,
      timeoutTicks: 1000,
      disconnectTicks: 100000,
    });
    const host = await connect(url);
    const guest = await connect(url);
    const created = onceEvent<{ code: string }>(host, 'room-created');
    host.emit('room-create', { playerId: 'player1', username: 'Player1' });
    const { code } = await created;
    const found = onceEvent<MatchFoundEvent>(host, 'match-found');
    const started = Promise.all([
      onceEvent(host, 'game-start'),
      onceEvent(guest, 'game-start'),
    ]);
    guest.emit('room-join', {
      playerId: 'player2',
      username: 'Player2',
      code,
    });
    const match = await found;
    await started;

    const batches: { tick: number; commands: PlayerCommand[] }[] = [];
    host.on(
      'commands-batch',
      (batch: { tick: number; commands: PlayerCommand[] }) => {
        if (batch.commands.length > 0) batches.push(batch);
      }
    );

    const firstTick = onceEvent<{ tick: number }>(host, 'tick-sync');
    host.emit('client-ready');
    guest.emit('client-ready');
    const { tick } = await firstTick;
    host.emit('submit-commands', {
      tick,
      commands: [{ type: 'move', data: { n: 1 } }],
    });
    guest.emit('submit-commands', {
      tick,
      commands: [{ type: 'stop', data: { n: 2 } }],
    });

    await new Promise<void>((resolve) => {
      const onSync = (event: { tick: number }) => {
        if (event.tick >= tick + 3) {
          host.off('tick-sync', onSync);
          resolve();
        }
      };
      host.on('tick-sync', onSync);
    });

    const chunks = await requestLog(host, match.matchId, 0);
    const entries = chunks.flatMap((chunk) => chunk.entries);
    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).toBe(JSON.stringify(batches));
    const players = entries[0]!.commands.map((command) => command.playerId);
    expect(players).toEqual(['player1', 'player2']);
    expect(findRoom(server, match.matchId).getStoredTickCount()).toBe(
      entries.length
    );
  });

  it('chunks on the 2000-tick boundaries', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    await playEventTicks(host, 4100, 100);
    const end = findRoom(server, matchId).getCurrentTick() - 1;
    expect(end).toBe(4099);

    const whole = await requestLog(host, matchId, 0);
    assertChunkJoints(whole, 0, end);
    expect(whole[0]!.toTick).toBe(1999);
    expect(whole[1]!.fromTick).toBe(2000);

    const at1999 = await requestLog(host, matchId, 1999);
    assertChunkJoints(at1999, 1999, end);
    expect(at1999[0]!.toTick).toBe(3998);

    const at2000 = await requestLog(host, matchId, 2000);
    assertChunkJoints(at2000, 2000, end);
    expect(at2000[0]!.toTick).toBe(3999);

    const at2001 = await requestLog(host, matchId, 2001);
    assertChunkJoints(at2001, 2001, end);
    expect(at2001[0]!.toTick).toBe(4000);

    const one = await requestLog(host, matchId, 10, 1);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      fromTick: 10,
      toTick: 10,
      done: true,
    });

    const span2000 = await requestLog(host, matchId, 0, 2000);
    expect(span2000).toHaveLength(1);
    expect(span2000[0]).toMatchObject({
      fromTick: 0,
      toTick: 1999,
      done: true,
    });

    const span2001 = await requestLog(host, matchId, 0, 2001);
    assertChunkJoints(span2001, 0, 2000);
    expect(span2001).toHaveLength(2);
    expect(span2001[1]).toMatchObject({
      fromTick: 2000,
      toTick: 2000,
      done: true,
    });

    const empty = await requestLog(host, matchId, end + 1);
    expect(empty).toEqual([
      {
        matchId,
        fromTick: end + 1,
        toTick: end,
        entries: [],
        done: true,
      },
    ]);
  }, 60_000);

  it('resumes a log after the socket drops mid-stream without gaps or duplicates', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    const batches = await playEventTicks(host, 2500, 25);

    const firstChunks: MatchLogChunkEvent[] = [];
    await new Promise<void>((resolve) => {
      const onChunk = (chunk: MatchLogChunkEvent) => {
        host.off('match-log-chunk', onChunk);
        firstChunks.push(chunk);
        host.disconnect();
        resolve();
      };
      host.on('match-log-chunk', onChunk);
      host.emit('match-log', { matchId, fromTick: 0 });
    });
    expect(firstChunks).toHaveLength(1);
    expect(firstChunks[0]!.done).toBe(false);
    const resumeFrom = firstChunks[0]!.toTick + 1;

    const again = await connect(url);
    const status = onceEvent<{ success: boolean }>(again, 'reconnect-status');
    again.emit('reconnect-match', { playerId: 'player1', matchId });
    expect((await status).success).toBe(true);

    const rest = await requestLog(again, matchId, resumeFrom);
    const entries = [
      ...firstChunks.flatMap((chunk) => chunk.entries),
      ...rest.flatMap((chunk) => chunk.entries),
    ];
    const ticks = entries.map((entry) => entry.tick);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(JSON.stringify(entries)).toBe(JSON.stringify(batches));
    expect(rest[rest.length - 1]!.toTick).toBe(
      findRoom(server, matchId).getCurrentTick() - 1
    );
  }, 60_000);

  it('stops after match-log-cancel and a new read matches commands-batch', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    const batches = await playEventTicks(host, 2100, 50);
    const remote = serverSocket(server, host.id);
    const seen: MatchLogChunkEvent[] = [];
    const original = remote.emit.bind(remote);
    // Cancel inside the first emit, before `setImmediate` queues the next
    // chunk. A client round-trip would already be too late.
    remote.emit = (event: string, ...args: unknown[]) => {
      if (event === 'match-log-chunk') {
        const chunk = args[0] as MatchLogChunkEvent;
        seen.push(chunk);
        if (chunk.requestId === 'a' && seen.length === 1) {
          const cancel = (
            remote as unknown as {
              listeners: (name: string) => ((payload: unknown) => void)[];
            }
          ).listeners('match-log-cancel');
          cancel[0]?.({ requestId: 'a' });
        }
      }
      return original(event, ...args);
    };

    host.emit('match-log', { matchId, fromTick: 0, requestId: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen.filter((chunk) => chunk.requestId === 'a')).toHaveLength(1);

    const chunks = await requestLog(host, matchId, 0, undefined, 'b');
    expect(JSON.stringify(chunks.flatMap((item) => item.entries))).toBe(
      JSON.stringify(batches)
    );
  }, 60_000);

  it('replaces an in-flight match-log and the new stream matches commands-batch', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    const batches = await playEventTicks(host, 2100, 50);
    const remote = serverSocket(server, host.id);
    const seen: MatchLogChunkEvent[] = [];
    const original = remote.emit.bind(remote);
    let replaced = false;
    remote.emit = (event: string, ...args: unknown[]) => {
      if (event === 'match-log-chunk') {
        const chunk = args[0] as MatchLogChunkEvent;
        seen.push(chunk);
        if (chunk.requestId === 'a' && !replaced) {
          replaced = true;
          // A second request in this same turn invalidates `a`.
          (
            server as unknown as {
              handleMatchLog(socket: object, payload: unknown): void;
            }
          ).handleMatchLog(remote, {
            matchId,
            fromTick: 0,
            requestId: 'b',
          });
        }
      }
      return original(event, ...args);
    };

    host.emit('match-log', { matchId, fromTick: 0, requestId: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const streamA = seen.filter((chunk) => chunk.requestId === 'a');
    const streamB = seen.filter((chunk) => chunk.requestId === 'b');
    expect(streamA).toHaveLength(1);
    expect(streamA[0]!.done).toBe(false);
    expect(streamB[streamB.length - 1]!.done).toBe(true);
    expect(JSON.stringify(streamB.flatMap((chunk) => chunk.entries))).toBe(
      JSON.stringify(batches)
    );
  }, 60_000);

  it('a cancel for the replaced request leaves the new stream running', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    await playEventTicks(host, 2100, 50);
    const remote = serverSocket(server, host.id);
    const seen: MatchLogChunkEvent[] = [];
    const original = remote.emit.bind(remote);
    remote.emit = (event: string, ...args: unknown[]) => {
      if (event === 'match-log-chunk') {
        seen.push(args[0] as MatchLogChunkEvent);
      }
      return original(event, ...args);
    };

    const phalanx = server as unknown as {
      handleMatchLog(socket: object, payload: unknown): void;
    };
    // All three happen before `setImmediate`, so B is still mid-stream
    // when the cancel for A arrives.
    phalanx.handleMatchLog(remote, { matchId, fromTick: 0, requestId: 'a' });
    phalanx.handleMatchLog(remote, { matchId, fromTick: 0, requestId: 'b' });
    const cancel = (
      remote as unknown as {
        listeners: (name: string) => ((payload: unknown) => void)[];
      }
    ).listeners('match-log-cancel');
    expect(cancel.length).toBeGreaterThan(0);
    cancel[0]!({ requestId: 'a' });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const streamB = seen.filter((chunk) => chunk.requestId === 'b');
    expect(streamB.length).toBeGreaterThan(1);
    expect(streamB[streamB.length - 1]!.done).toBe(true);
  }, 60_000);

  it('stops streaming when the requester disconnects', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    await playEventTicks(host, 2001, 2001);
    const remote = serverSocket(server, host.id);
    let chunkEmits = 0;
    const original = remote.emit.bind(remote);
    remote.emit = (event: string, ...args: unknown[]) => {
      if (event === 'match-log-chunk') {
        chunkEmits += 1;
        if (chunkEmits === 1) remote.disconnect();
      }
      return original(event, ...args);
    };

    host.emit('match-log', { matchId, fromTick: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(remote.disconnected).toBe(true);
    expect(chunkEmits).toBe(1);
  }, 60_000);

  it('sends the next chunk on a later turn', async () => {
    const { server, url } = await startServer();
    const { host, matchId } = await openPrivateMatch(url);
    await playEventTicks(host, 2001, 2001);
    const remote = serverSocket(server, host.id);
    let chunkEmits = 0;
    let yieldedBeforeSecond = false;
    const original = remote.emit.bind(remote);
    remote.emit = (event: string, ...args: unknown[]) => {
      if (event === 'match-log-chunk') {
        chunkEmits += 1;
        if (chunkEmits === 1) {
          setImmediate(() => {
            yieldedBeforeSecond = chunkEmits === 1;
          });
        }
      }
      return original(event, ...args);
    };

    const chunks = await requestLog(host, matchId, 0);
    expect(chunks.length).toBeGreaterThan(1);
    expect(yieldedBeforeSecond).toBe(true);
  }, 60_000);
});

describe('match-log refusals', () => {
  it('refuses a non-member and does not send chunks', async () => {
    const { url } = await startServer();
    const first = await openPrivateMatch(url);
    const outsider = await connect(url);
    const created = onceEvent<{ code: string }>(outsider, 'room-created');
    outsider.emit('room-create', {
      playerId: 'player3',
      username: 'Player3',
    });
    const { code } = await created;
    const other = await connect(url);
    const found = onceEvent<MatchFoundEvent>(other, 'match-found');
    other.emit('room-join', {
      playerId: 'player4',
      username: 'Player4',
      code,
    });
    const second = await found;

    const fromOtherMatch = await expectLogError(other, {
      matchId: first.matchId,
      fromTick: 0,
    });
    expect(fromOtherMatch).toEqual({
      matchId: first.matchId,
      reason: 'not-member',
    });

    const stranger = await connect(url);
    const fromStranger = await expectLogError(stranger, {
      matchId: first.matchId,
      fromTick: 0,
    });
    expect(fromStranger.reason).toBe('not-member');

    const missing = await expectLogError(first.host, {
      matchId: 'match-does-not-exist',
      fromTick: 0,
    });
    expect(missing.reason).toBe('not-found');
    expect(second.matchId).not.toBe(first.matchId);
  });

  it('reports truncated numeric history and invalid requests', async () => {
    const { server, url } = await startServer({ commandHistoryTicks: 100 });
    const { host, matchId } = await openPrivateMatch(url);
    await playEventTicks(host, 150, 10);
    const room = findRoom(server, matchId);
    expect(room.getStoredTickCount()).toBe(101);
    expect(room.getOldestLogTick()).toBe(49);
    expect(
      room.getLogRange(49, 149).some((entry) => entry.commands.length === 0)
    ).toBe(false);

    const truncated = await expectLogError(host, { matchId, fromTick: 0 });
    expect(truncated).toEqual({ matchId, reason: 'truncated' });

    const oldest = await requestLog(host, matchId, room.getOldestLogTick());
    expect(oldest[oldest.length - 1]!.done).toBe(true);
    expect(oldest[0]!.fromTick).toBe(49);

    for (const fromTick of [-1, 1.5, Number.NaN]) {
      const error = await expectLogError(host, { matchId, fromTick });
      expect(error.reason).toBe('invalid');
    }
    for (const maxTicks of [0, -1, 1.2]) {
      const error = await expectLogError(host, {
        matchId,
        fromTick: 49,
        maxTicks,
      });
      expect(error.reason).toBe('invalid');
      expect(error.matchId).toBe(matchId);
    }

    const blank = await expectLogError(host, { matchId: '', fromTick: 0 });
    expect(blank).toEqual({ reason: 'invalid' });
    expect(blank.matchId).toBeUndefined();

    const missingId = await expectLogError(host, { fromTick: 0 });
    expect(missingId).toEqual({ reason: 'invalid' });
    expect(missingId.matchId).toBeUndefined();
  });
});

describe('reconnect-state with full history', () => {
  it('uses the same 200-tick window and payload keys as numeric history', async () => {
    async function snapshot(history: PhalanxConfig['commandHistoryTicks']) {
      const { url } = await startServer({ commandHistoryTicks: history });
      const { host, guest, matchId } = await openPrivateMatch(url);
      await playEventTicks(host, 250, 10);
      const disconnected = onceEvent(host, 'player-disconnected');
      guest.disconnect();
      await disconnected;
      const again = await connect(url);
      const statePromise = onceEvent<{
        matchId: string;
        currentTick: number;
        state: string;
        recentCommands: { tick: number; commands: PlayerCommand[] }[];
      }>(again, 'reconnect-state');
      again.emit('reconnect-match', { playerId: 'player2', matchId });
      return statePromise;
    }

    const numeric = await snapshot(200);
    const full = await snapshot('full');

    expect(Object.keys(full).sort()).toEqual(Object.keys(numeric).sort());
    expect(full.currentTick).toBe(numeric.currentTick);
    expect(full.state).toBe(numeric.state);
    expect(full.recentCommands).toEqual(numeric.recentCommands);
    expect(full.recentCommands).toHaveLength(200);
    expect(full.recentCommands[0]!.tick).toBe(full.currentTick - 200);
    expect(
      full.recentCommands.some((entry) => entry.commands.length === 0)
    ).toBe(true);
  });
});

describe('match buildId', () => {
  it('starts when every player has the same buildId', async () => {
    const { server, url } = await startServer({ requireBuildId: true });
    const { matchId } = await openPrivateMatch(url, {
      host: 'build-a',
      guest: 'build-a',
    });
    expect(findRoom(server, matchId).getBuildId()).toBe('build-a');
    expect(server.getActiveMatches().map((match) => match.id)).toContain(
      matchId
    );
  });

  it('rejects a mismatch before match-found when requireBuildId is set', async () => {
    const { server, url } = await startServer({ requireBuildId: true });
    const host = await connect(url);
    const guest = await connect(url);
    const created = onceEvent<{ code: string }>(host, 'room-created');
    let matchFound = false;
    let matchEnd = false;
    host.on('match-found', () => {
      matchFound = true;
    });
    guest.on('match-found', () => {
      matchFound = true;
    });
    host.on('match-end', () => {
      matchEnd = true;
    });
    guest.on('match-end', () => {
      matchEnd = true;
    });
    const ended = new Promise<string>((resolve) => {
      server.on('match-ended', (_id: string, reason: string) =>
        resolve(reason)
      );
    });
    const hostError = onceEvent<{ matchId: string; reason: string }>(
      host,
      'match-error'
    );
    const guestError = onceEvent<{ matchId: string; reason: string }>(
      guest,
      'match-error'
    );

    host.emit('room-create', {
      playerId: 'player1',
      username: 'Player1',
      buildId: 'build-a',
    });
    const { code } = await created;
    guest.emit('room-join', {
      playerId: 'player2',
      username: 'Player2',
      code,
      buildId: 'build-b',
    });

    const [left, right, reason] = await Promise.all([
      hostError,
      guestError,
      ended,
    ]);
    expect(left).toEqual({ matchId: right.matchId, reason: 'build-mismatch' });
    expect(right.reason).toBe('build-mismatch');
    expect(reason).toBe('build-mismatch');
    expect(matchFound).toBe(false);
    expect(matchEnd).toBe(false);
    expect(server.getActiveMatches()).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(matchFound).toBe(false);
  });

  it('treats an invalid buildId as absent and still starts when the check is off', async () => {
    const { server, url } = await startServer({ requireBuildId: false });
    const host = await connect(url);
    const guest = await connect(url);
    const created = onceEvent<{ code: string }>(host, 'room-created');
    host.emit('room-create', {
      playerId: 'player1',
      username: 'Player1',
      buildId: 'host-build',
    });
    const { code } = await created;
    const found = onceEvent<MatchFoundEvent>(host, 'match-found');
    const started = onceEvent(host, 'game-start');
    guest.emit('room-join', {
      playerId: 'player2',
      username: 'Player2',
      code,
      buildId: 'x'.repeat(129),
    });
    const match = await found;
    await started;
    const room = findRoom(server, match.matchId);
    expect(room.getBuildId()).toBe('host-build');
    expect(server.getActiveMatches().map((item) => item.id)).toContain(
      match.matchId
    );
  });

  it('rejects a player with no buildId when requireBuildId is set', async () => {
    const { server, url } = await startServer({ requireBuildId: true });

    async function rejected(
      hostId: string,
      guestId: string,
      hostBuild: string | undefined
    ): Promise<void> {
      const host = await connect(url);
      const guest = await connect(url);
      const created = onceEvent<{ code: string }>(host, 'room-created');
      const hostError = onceEvent<{ matchId: string; reason: string }>(
        host,
        'match-error'
      );
      const guestError = onceEvent<{ matchId: string; reason: string }>(
        guest,
        'match-error'
      );
      let matchFound = false;
      host.on('match-found', () => {
        matchFound = true;
      });
      guest.on('match-found', () => {
        matchFound = true;
      });
      host.emit('room-create', {
        playerId: hostId,
        username: hostId,
        ...(hostBuild !== undefined ? { buildId: hostBuild } : {}),
      });
      const { code } = await created;
      guest.emit('room-join', {
        playerId: guestId,
        username: guestId,
        code,
      });
      const [left, right] = await Promise.all([hostError, guestError]);
      expect(left.reason).toBe('build-mismatch');
      expect(right).toEqual({
        matchId: left.matchId,
        reason: 'build-mismatch',
      });
      expect(matchFound).toBe(false);
      expect(server.getActiveMatches()).toEqual([]);
    }

    await rejected('player1', 'player2', 'build-a');
    await rejected('player3', 'player4', undefined);
  });

  it('accepts a buildId of length 128 and ignores 129', async () => {
    const id128 = 'b'.repeat(128);
    const strict = await startServer({ requireBuildId: true });
    const started = await openPrivateMatch(strict.url, {
      host: id128,
      guest: id128,
    });
    expect(findRoom(strict.server, started.matchId).getBuildId()).toBe(id128);

    const loose = await startServer({
      requireBuildId: false,
    });
    const ignored = await openPrivateMatch(loose.url, {
      guest: 'x'.repeat(129),
    });
    expect(findRoom(loose.server, ignored.matchId).getBuildId()).toBe(
      undefined
    );
  });

  it('carries buildId through the matchmaking queue', async () => {
    const { server, url } = await startServer({
      requireBuildId: true,
      matchmakingIntervalMs: 20,
    });
    const left = await connect(url);
    const right = await connect(url);
    const found = onceEvent<MatchFoundEvent>(left, 'match-found');
    left.emit('queue-join', {
      playerId: 'player1',
      username: 'Player1',
      buildId: 'queue-build',
    });
    right.emit('queue-join', {
      playerId: 'player2',
      username: 'Player2',
      buildId: 'queue-build',
    });
    const match = await found;
    expect(findRoom(server, match.matchId).getBuildId()).toBe('queue-build');
  });
});
