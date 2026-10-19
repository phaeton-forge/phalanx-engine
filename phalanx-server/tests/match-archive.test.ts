import { describe, it, expect, afterEach, vi } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';
import { validateConfig } from '../src/config/validation.js';
import { GameRoom } from '../src/services/GameRoom.js';
import { MatchmakingService } from '../src/services/MatchmakingService.js';
import { PrivateRoomService } from '../src/services/PrivateRoomService.js';
import type {
  GameStartEvent,
  MatchArchive,
  MatchFoundEvent,
  MatchLogChunkEvent,
  MatchLogErrorEvent,
  PhalanxConfig,
  PlayerCommand,
} from '../src/types/index.js';

/**
 * Task 8.1. Real `Phalanx` plus `socket.io-client` on port 0.
 */

interface Started {
  server: Phalanx;
  url: string;
}

interface Opened {
  host: Socket;
  guest: Socket;
  matchId: string;
  seed: number;
  hostId: string;
  guestId: string;
  hostName: string;
  guestName: string;
}

interface SeenArchive {
  archive: MatchArchive;
  afterMatchEnd: boolean;
}

const servers: Phalanx[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
  for (const server of servers.splice(0)) {
    await server.stop();
  }
});

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
    turnTimeoutMs: 60_000,
    matchmakingIntervalMs: 60_000,
    commandHistoryTicks: 'full',
    tickRate: 20,
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

async function nextTurns(count = 4): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

async function waitForArchives(
  seen: SeenArchive[],
  count: number,
  timeoutMs = 4000
): Promise<void> {
  const started = Date.now();
  while (seen.length < count) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`expected ${count} archives, saw ${seen.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function findRoom(server: Phalanx, matchId: string): GameRoom {
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

function pendingArchiveCount(server: Phalanx): number {
  return (server as unknown as { pendingArchives: { size: number } })
    .pendingArchives.size;
}

function services(server: Phalanx): {
  matchmaking: MatchmakingService;
  privateRooms: PrivateRoomService;
} {
  const internal = server as unknown as {
    matchmaking: MatchmakingService | null;
    privateRooms: PrivateRoomService | null;
  };
  if (!internal.matchmaking || !internal.privateRooms) {
    throw new Error('services are not running');
  }
  return {
    matchmaking: internal.matchmaking,
    privateRooms: internal.privateRooms,
  };
}

function serverSocket(
  server: Phalanx,
  socketId: string
): {
  emit: (event: string, ...args: unknown[]) => boolean;
} {
  const internal = server as unknown as {
    io: {
      sockets: {
        sockets: Map<
          string,
          { emit: (event: string, ...args: unknown[]) => boolean }
        >;
      };
    } | null;
  };
  const sock = internal.io?.sockets.sockets.get(socketId);
  if (!sock) throw new Error(`no server socket ${socketId}`);
  return sock;
}

async function openPrivateMatch(
  url: string,
  options: {
    hostId?: string;
    guestId?: string;
    hostName?: string;
    guestName?: string;
    buildId?: string;
    gameType?: string;
    ready?: boolean;
    beforeReady?: () => void;
  } = {}
): Promise<Opened> {
  const hostId = options.hostId ?? 'player1';
  const guestId = options.guestId ?? 'player2';
  const hostName = options.hostName ?? 'Player1';
  const guestName = options.guestName ?? 'Player2';
  const host = await connect(url);
  const guest = await connect(url);
  const created = onceEvent<{ code: string }>(host, 'room-created');
  const found = onceEvent<MatchFoundEvent>(host, 'match-found');
  const guestFound = onceEvent<MatchFoundEvent>(guest, 'match-found');
  const hostStart = onceEvent<GameStartEvent>(host, 'game-start');
  const guestStart = onceEvent<GameStartEvent>(guest, 'game-start');
  host.emit('room-create', {
    playerId: hostId,
    username: hostName,
    ...(options.gameType !== undefined ? { gameType: options.gameType } : {}),
    ...(options.buildId !== undefined ? { buildId: options.buildId } : {}),
  });
  const { code } = await created;
  guest.emit('room-join', {
    playerId: guestId,
    username: guestName,
    code,
    ...(options.buildId !== undefined ? { buildId: options.buildId } : {}),
  });
  const match = await found;
  await guestFound;
  if (options.ready === false) {
    return {
      host,
      guest,
      matchId: match.matchId,
      seed: 0,
      hostId,
      guestId,
      hostName,
      guestName,
    };
  }
  const [started] = await Promise.all([hostStart, guestStart]);
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
  options.beforeReady?.();
  host.emit('client-ready');
  guest.emit('client-ready');
  await bothReady;
  return {
    host,
    guest,
    matchId: match.matchId,
    seed: started.randomSeed ?? 0,
    hostId,
    guestId,
    hostName,
    guestName,
  };
}

async function submitPing(socket: Socket, tick = 0): Promise<void> {
  const batch = onceEvent<{ tick: number }>(socket, 'commands-batch');
  socket.emit('submit-commands', {
    tick,
    commands: [{ type: 'ping', data: { n: tick } }],
  });
  await batch;
}

function expectArchive(
  seen: SeenArchive,
  opened: Opened,
  expected: {
    endReason: string;
    lastTick: number;
    tickRate: number;
    historyMode: number | 'full';
    complete: boolean;
    buildId?: string;
    winnerTeamId?: number;
    gameType?: string;
    /**
     * False when every client has already dropped, so none of them
     * can observe `match-end`. The server still emits it first.
     */
    clientReceived?: boolean;
  }
): void {
  const archive = seen.archive;
  if (expected.clientReceived !== false) {
    expect(seen.afterMatchEnd).toBe(true);
  }
  expect(archive.formatVersion).toBe(1);
  expect(archive.matchId).toBe(opened.matchId);
  expect(archive.seed).toBe(opened.seed);
  expect(archive.endReason).toBe(expected.endReason);
  expect(archive.startedAt).toBeLessThanOrEqual(archive.endedAt);
  expect(archive.startedAt).toBeGreaterThan(0);
  expect(archive.lastTick).toBe(expected.lastTick);
  expect(archive.tickRate).toBe(expected.tickRate);
  expect(archive.historyMode).toBe(expected.historyMode);
  expect(archive.complete).toBe(expected.complete);
  expect(archive.gameType).toBe(expected.gameType ?? 'default');
  expect(archive.teams).toEqual([
    [{ playerId: opened.hostId, username: opened.hostName }],
    [{ playerId: opened.guestId, username: opened.guestName }],
  ]);
  if (expected.buildId === undefined) {
    expect(archive).not.toHaveProperty('buildId');
  } else {
    expect(archive.buildId).toBe(expected.buildId);
  }
  if (expected.winnerTeamId === undefined) {
    expect(archive).not.toHaveProperty('winnerTeamId');
  } else {
    expect(archive.winnerTeamId).toBe(expected.winnerTeamId);
  }
}

function attachArchiveHook(
  records: SeenArchive[],
  flags: { matchEnd: boolean }
): (archive: MatchArchive) => void {
  return (archive: MatchArchive) => {
    records.push({ archive, afterMatchEnd: flags.matchEnd });
  };
}

function watchMatchEnd(socket: Socket, flags: { matchEnd: boolean }): void {
  socket.on('match-end', () => {
    flags.matchEnd = true;
  });
}

describe('onMatchArchived config', () => {
  it('rejects a non-function and leaves the default unset', () => {
    expect(validateConfig({ port: 0 }).onMatchArchived).toBeUndefined();
    const bad: Partial<PhalanxConfig> = { port: 1 };
    Object.assign(bad, { onMatchArchived: 1 });
    expect(() => validateConfig(bad)).toThrow(/onMatchArchived/);
  });
});

describe('archive after the match has started', () => {
  it('archives stop() once, after match-end, and keeps the log', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      tickRate: 17,
      gameTypes: [{ gameType: 'skirmish', tickRate: 17 }],
      onMatchArchived: attachArchiveHook(records, flags),
    });
    const opened = await openPrivateMatch(url, {
      buildId: 'build-a',
      gameType: 'skirmish',
    });
    watchMatchEnd(opened.host, flags);
    await submitPing(opened.host, 0);
    const room = findRoom(server, opened.matchId);
    const { matchmaking, privateRooms } = services(server);

    await server.stop();
    await waitForArchives(records, 1);
    expectArchive(records[0]!, opened, {
      endReason: 'stopped',
      lastTick: 0,
      tickRate: 17,
      historyMode: 'full',
      complete: true,
      buildId: 'build-a',
      gameType: 'skirmish',
    });
    expect(records[0]!.archive.log).toHaveLength(1);
    const logJson = JSON.stringify(records[0]!.archive.log);

    await server.stop();
    await nextTurns();
    expect(records).toHaveLength(1);
    expect(room.takeArchive('stopped')).toBeNull();
    expect(room.getArchiveBuildCount()).toBe(1);
    expect(room.getStoredTickCount()).toBe(0);
    expect(room.getLogRange(0, 100)).toEqual([]);
    expect(room.getOldestLogTick()).toBe(room.getCurrentTick());
    expect(JSON.stringify(records[0]!.archive.log)).toBe(logJson);
    expect(matchmaking.getMatch(opened.matchId)).toBeUndefined();
    expect(privateRooms.getMatch(opened.matchId)).toBeUndefined();
  });

  it('archives shutdown() as stopped and does not add a winner', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      onMatchArchived: attachArchiveHook(records, flags),
    });
    const opened = await openPrivateMatch(url);
    watchMatchEnd(opened.host, flags);
    await submitPing(opened.host, 0);
    await server.shutdown('deploy');
    await waitForArchives(records, 1);
    expectArchive(records[0]!, opened, {
      endReason: 'stopped',
      lastTick: 0,
      tickRate: 20,
      historyMode: 'full',
      complete: true,
    });
    expect(records).toHaveLength(1);
  });

  it('archives desync', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      enableStateHashing: true,
      onMatchArchived: attachArchiveHook(records, flags),
    });
    const opened = await openPrivateMatch(url);
    watchMatchEnd(opened.host, flags);
    await submitPing(opened.host, 0);
    const ended = onceEvent<{ reason: string }>(opened.host, 'match-end');
    opened.host.emit('state-hash', { tick: 0, hash: 'left' });
    opened.guest.emit('state-hash', { tick: 0, hash: 'right' });
    expect((await ended).reason).toBe('desync');
    await waitForArchives(records, 1);
    expectArchive(records[0]!, opened, {
      endReason: 'desync',
      lastTick: 0,
      tickRate: 20,
      historyMode: 'full',
      complete: true,
    });
  });

  it('archives turn-timeout', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      turnTimeoutMs: 800,
      onMatchArchived: attachArchiveHook(records, flags),
    });
    const opened = await openPrivateMatch(url);
    watchMatchEnd(opened.host, flags);
    await submitPing(opened.host, 0);
    await waitForArchives(records, 1, 3000);
    expectArchive(records[0]!, opened, {
      endReason: 'turn-timeout',
      lastTick: 0,
      tickRate: 20,
      historyMode: 'full',
      complete: true,
    });
  });

  it('archives disconnect with winnerTeamId', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      absence: { windowMs: 40, matchBudgetMs: 10_000 },
      onMatchArchived: attachArchiveHook(records, flags),
    });
    const opened = await openPrivateMatch(url);
    watchMatchEnd(opened.guest, flags);
    await submitPing(opened.host, 0);
    opened.host.disconnect();
    await waitForArchives(records, 1);
    expectArchive(records[0]!, opened, {
      endReason: 'disconnect',
      lastTick: 0,
      tickRate: 20,
      historyMode: 'full',
      complete: true,
      winnerTeamId: 1,
    });
  });

  it('archives abandoned without a winner', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      absence: { windowMs: 40, matchBudgetMs: 10_000 },
      onMatchArchived: attachArchiveHook(records, flags),
    });
    const opened = await openPrivateMatch(url);
    watchMatchEnd(opened.host, flags);
    opened.host.disconnect();
    opened.guest.disconnect();
    await waitForArchives(records, 1);
    expectArchive(records[0]!, opened, {
      endReason: 'abandoned',
      lastTick: -1,
      tickRate: 20,
      historyMode: 'full',
      complete: true,
      clientReceived: false,
    });
    expect(records[0]!.archive.log).toEqual([]);
  });

  it('archives endMatch reason and winnerTeamId', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      onMatchArchived: attachArchiveHook(records, flags),
    });
    server.on('player-command', (_playerId, command, ctx) => {
      if (command.type === 'destroy-base') {
        ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
      }
    });
    const opened = await openPrivateMatch(url);
    watchMatchEnd(opened.host, flags);
    await submitPing(opened.host, 0);
    opened.host.emit('player-command', {
      type: 'destroy-base',
      tick: 0,
      playerId: opened.hostId,
      data: {},
    });
    await waitForArchives(records, 1);
    expectArchive(records[0]!, opened, {
      endReason: 'base-destroyed',
      lastTick: 0,
      tickRate: 20,
      historyMode: 'full',
      complete: true,
      winnerTeamId: 1,
    });
    expect(
      records[0]!.archive.log.every((entry) =>
        entry.commands.every((command) => command.type !== 'destroy-base')
      )
    ).toBe(true);
  });

  it('sets startedAt at startGame, before the archive is built', async () => {
    const records: SeenArchive[] = [];
    const flags = { matchEnd: false };
    const { server, url } = await startServer({
      onMatchArchived: attachArchiveHook(records, flags),
    });
    let beforeReady = 0;
    const opened = await openPrivateMatch(url, {
      beforeReady: () => {
        beforeReady = Date.now();
      },
    });
    const afterReady = Date.now();
    watchMatchEnd(opened.host, flags);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await server.stop();
    await waitForArchives(records, 1);
    const archive = records[0]!.archive;
    expect(beforeReady).toBeGreaterThan(0);
    expect(archive.startedAt).toBeGreaterThanOrEqual(beforeReady);
    expect(archive.startedAt).toBeLessThanOrEqual(afterReady);
    expect(archive.endedAt).toBeGreaterThan(afterReady);
    expect(archive.endedAt).toBeGreaterThanOrEqual(archive.startedAt);
  });

  it('calls the hook captured when the archive was built', async () => {
    let built = 0;
    let replaced = 0;
    const { server, url } = await startServer({
      onMatchArchived: () => {
        built += 1;
      },
    });
    server.on('match-ended', () => {
      (
        server as unknown as {
          config: { onMatchArchived?: PhalanxConfig['onMatchArchived'] };
        }
      ).config.onMatchArchived = () => {
        replaced += 1;
      };
    });
    await openPrivateMatch(url);
    await server.stop();
    await nextTurns(6);
    expect(built).toBe(1);
    expect(replaced).toBe(0);
  });
});

describe('no archive before the match starts', () => {
  it('does not archive build-mismatch', async () => {
    const records: SeenArchive[] = [];
    const { server, url } = await startServer({
      requireBuildId: true,
      onMatchArchived: (archive) => {
        records.push({ archive, afterMatchEnd: false });
      },
    });
    const host = await connect(url);
    const guest = await connect(url);
    const created = onceEvent<{ code: string }>(host, 'room-created');
    const hostError = onceEvent<{ reason: string }>(host, 'match-error');
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
    expect((await hostError).reason).toBe('build-mismatch');
    await nextTurns();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(records).toEqual([]);
    expect(server.getActiveMatches()).toEqual([]);
  });

  it('does not archive players-not-connected', async () => {
    const records: SeenArchive[] = [];
    const { url } = await startServer({
      readyTimeoutMs: 30_000,
      playersConnectTimeoutMs: 80,
      onMatchArchived: (archive) => {
        records.push({ archive, afterMatchEnd: false });
      },
    });
    const opened = await openPrivateMatch(url, { ready: false });
    const ended = onceEvent<{ reason: string }>(opened.host, 'match-end');
    opened.guest.disconnect();
    expect((await ended).reason).toBe('players-not-connected');
    await nextTurns();
    expect(records).toEqual([]);
  });

  it('does not archive ready-timeout', async () => {
    const records: SeenArchive[] = [];
    const { url } = await startServer({
      readyTimeoutMs: 80,
      onMatchArchived: (archive) => {
        records.push({ archive, afterMatchEnd: false });
      },
    });
    const opened = await openPrivateMatch(url, { ready: false });
    const ended = onceEvent<{ reason: string }>(opened.host, 'match-end');
    expect((await ended).reason).toBe('ready-timeout');
    await nextTurns();
    expect(records).toEqual([]);
  });

  it('does not archive stop() during countdown', async () => {
    const records: SeenArchive[] = [];
    const { server, url } = await startServer({
      countdownSeconds: 30,
      onMatchArchived: (archive) => {
        records.push({ archive, afterMatchEnd: false });
      },
    });
    const host = await connect(url);
    const guest = await connect(url);
    const created = onceEvent<{ code: string }>(host, 'room-created');
    const countdown = onceEvent<{ seconds: number }>(host, 'countdown');
    host.emit('room-create', { playerId: 'player1', username: 'Player1' });
    const { code } = await created;
    guest.emit('room-join', { playerId: 'player2', username: 'Player2', code });
    await countdown;
    const ended = onceEvent<{ reason: string }>(host, 'match-end');
    await server.stop();
    expect((await ended).reason).toBe('stopped');
    await nextTurns();
    expect(records).toEqual([]);
  });

  it('does not archive shutdown() while waiting for ready', async () => {
    const records: SeenArchive[] = [];
    const { server, url } = await startServer({
      onMatchArchived: (archive) => {
        records.push({ archive, afterMatchEnd: false });
      },
    });
    const opened = await openPrivateMatch(url, { ready: false });
    const ended = onceEvent<{ reason: string }>(opened.host, 'match-end');
    await server.shutdown('deploy');
    expect((await ended).reason).toBe('stopped');
    await nextTurns();
    expect(records).toEqual([]);
  });
});

describe('history release', () => {
  it('drops history without building when the hook is absent', async () => {
    for (const historyMode of ['full', 200] as const) {
      const { server, url } = await startServer({
        commandHistoryTicks: historyMode,
      });
      const opened = await openPrivateMatch(url);
      await submitPing(opened.host, 0);
      const room = findRoom(server, opened.matchId);
      expect(room.getStoredTickCount()).toBeGreaterThan(0);
      const { matchmaking, privateRooms } = services(server);
      await server.stop();
      expect(room.getArchiveBuildCount()).toBe(0);
      expect(room.getStoredTickCount()).toBe(0);
      expect(room.getLogRange(0, 1000)).toEqual([]);
      expect(room.getOldestLogTick()).toBe(room.getCurrentTick());
      expect(matchmaking.getMatch(opened.matchId)).toBeUndefined();
      expect(privateRooms.getMatch(opened.matchId)).toBeUndefined();
    }
  });

  it('ends an in-flight match-log with not-found when the match ends', async () => {
    const records: SeenArchive[] = [];
    const { server, url } = await startServer({
      onMatchArchived: (archive) => {
        records.push({ archive, afterMatchEnd: true });
      },
    });
    const opened = await openPrivateMatch(url);
    await playEventTicks(opened.host, 4500, 100);
    const room = findRoom(server, opened.matchId);
    const remote = serverSocket(server, opened.host.id);
    const original = remote.emit.bind(remote);
    const errors: MatchLogErrorEvent[] = [];
    const chunks: MatchLogChunkEvent[] = [];
    opened.host.on('match-log-error', (error: MatchLogErrorEvent) => {
      errors.push(error);
    });
    opened.host.on('match-log-chunk', (chunk: MatchLogChunkEvent) => {
      chunks.push(chunk);
    });
    let stopped = false;
    remote.emit = (event: string, ...args: unknown[]) => {
      const sent = original(event, ...args);
      if (event === 'match-log-chunk' && !stopped) {
        stopped = true;
        room.stop();
      }
      return sent;
    };
    opened.host.emit('match-log', { matchId: opened.matchId, fromTick: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((chunk) => chunk.done)).toBe(false);
    expect(errors.some((error) => error.reason === 'not-found')).toBe(true);
    expect(room.getStoredTickCount()).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]!.archive.log.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('hook isolation', () => {
  async function survivingMatch(
    hook: PhalanxConfig['onMatchArchived']
  ): Promise<Phalanx> {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    let server!: Phalanx;
    try {
      const started = await startServer({
        tickMode: 'continuous',
        tickRate: 32,
        timeoutTicks: 100_000,
        disconnectTicks: 100_000,
        onMatchArchived: hook,
      });
      server = started.server;
      const url = started.url;
      server.on('player-command', (_playerId, command, ctx) => {
        if (command.type === 'destroy-base') {
          ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
        }
      });
      const first = await openPrivateMatch(url, {
        hostId: 'p1',
        guestId: 'p2',
        hostName: 'P1',
        guestName: 'P2',
      });
      const second = await openPrivateMatch(url, {
        hostId: 'p3',
        guestId: 'p4',
        hostName: 'P3',
        guestName: 'P4',
      });
      const ticks: number[] = [];
      second.host.on('commands-batch', (batch: { tick: number }) => {
        ticks.push(batch.tick);
      });
      const sync = await onceEvent<{ tick: number }>(second.host, 'tick-sync');
      first.host.emit('player-command', {
        type: 'destroy-base',
        tick: 0,
        playerId: 'p1',
        data: {},
      });
      await nextTurns(6);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          second.host.off('tick-sync', onSync);
          reject(new Error('second match stopped ticking'));
        }, 2000);
        const onSync = (event: { tick: number }) => {
          if (event.tick <= sync.tick + 2) return;
          clearTimeout(timer);
          second.host.off('tick-sync', onSync);
          resolve();
        };
        second.host.on('tick-sync', onSync);
      });
      expect(ticks.some((tick) => tick > sync.tick)).toBe(true);
      expect(server.getActiveMatches().map((match) => match.id)).toContain(
        second.matchId
      );
      const third = await openPrivateMatch(url, {
        hostId: 'p5',
        guestId: 'p6',
        hostName: 'P5',
        guestName: 'P6',
      });
      expect(Number.isInteger(third.seed)).toBe(true);
      expect(server.getActiveMatches().map((match) => match.id)).toContain(
        third.matchId
      );
    } finally {
      process.off('unhandledRejection', onRejection);
    }
    expect(rejections).toEqual([]);
    return server;
  }

  it('keeps the relay up when the hook throws', async () => {
    const server = await survivingMatch(() => {
      throw new Error('archive failed');
    });
    expect(pendingArchiveCount(server)).toBe(0);
  });

  it('keeps the relay up when the hook rejects', async () => {
    await survivingMatch(() => Promise.reject(new Error('archive failed')));
  });
});

describe('shutdown waits for archive hooks', () => {
  it('calls a hung hook and does not wait when shutdownGraceMs is 0', async () => {
    let calls = 0;
    const { server, url } = await startServer({
      shutdownGraceMs: 0,
      onMatchArchived: () => {
        calls += 1;
        return new Promise(() => {});
      },
    });
    await openPrivateMatch(url);
    const started = Date.now();
    await server.shutdown('deploy');
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('drains a grace-period hook and a hook queued inside stop', async () => {
    const grace = 1500;
    const releases: Array<() => void> = [];
    const seen: { matchId: string; endReason: string }[] = [];
    const { server, url } = await startServer({
      shutdownGraceMs: grace,
      turnTimeoutMs: 60_000,
      onMatchArchived: (archive) => {
        seen.push({ matchId: archive.matchId, endReason: archive.endReason });
        return new Promise<void>((resolve) => {
          releases.push(resolve);
        });
      },
    });
    server.on('player-command', (_playerId, command, ctx) => {
      if (command.type === 'destroy-base') {
        ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
      }
    });
    const first = await openPrivateMatch(url, {
      hostId: 'p1',
      guestId: 'p2',
      hostName: 'P1',
      guestName: 'P2',
    });
    const second = await openPrivateMatch(url, {
      hostId: 'p3',
      guestId: 'p4',
      hostName: 'P3',
      guestName: 'P4',
    });

    const pending = server.shutdown('deploy');
    first.host.emit('player-command', {
      type: 'destroy-base',
      tick: 0,
      playerId: 'p1',
      data: {},
    });

    const firstDeadline = Date.now() + grace - 100;
    while (seen.length < 1 && Date.now() < firstDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(seen).toEqual([
      { matchId: first.matchId, endReason: 'base-destroyed' },
    ]);
    expect(server.getActiveMatches().map((match) => match.id)).toContain(
      second.matchId
    );

    const bothDeadline = Date.now() + grace + 2000;
    while (seen.length < 2 && Date.now() < bothDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(seen.map((entry) => entry.endReason).sort()).toEqual([
      'base-destroyed',
      'stopped',
    ]);
    expect(seen.map((entry) => entry.matchId).sort()).toEqual(
      [first.matchId, second.matchId].sort()
    );

    const drainStarted = Date.now();
    for (const release of releases) release();
    await pending;
    expect(Date.now() - drainStarted).toBeLessThan(500);
    expect(pendingArchiveCount(server)).toBe(0);
  });

  it('resolves a hung hook within shutdownGraceMs after stop', async () => {
    const grace = 400;
    let calls = 0;
    const { server, url } = await startServer({
      shutdownGraceMs: grace,
      turnTimeoutMs: 60_000,
      onMatchArchived: () => {
        calls += 1;
        return new Promise(() => {});
      },
    });
    await openPrivateMatch(url);
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });

    const stop = server.stop.bind(server);
    let stopDone = false;
    server.stop = async () => {
      await stop();
      stopDone = true;
    };

    let settled = false;
    const pending = server.shutdown('deploy');
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(grace - 1);
    expect(settled).toBe(false);
    expect(stopDone).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 10 && (calls === 0 || !stopDone); i++) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    expect(stopDone).toBe(true);
    expect(calls).toBe(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(grace - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });
});

describe('archive log bytes', () => {
  it('matches match-log plus the tail, and a full 9000-tick log', async () => {
    const records: SeenArchive[] = [];
    const { server, url } = await startServer({
      onMatchArchived: (archive) => {
        records.push({ archive, afterMatchEnd: true });
      },
    });
    const opened = await openPrivateMatch(url);
    const head = await playEventTicks(opened.host, 9000, 50);
    const chunks = await requestLog(opened.host, opened.matchId, 0);
    const logged = chunks.flatMap((chunk) => chunk.entries);

    const tail: { tick: number; commands: PlayerCommand[] }[] = [];
    const tailDone = new Promise<void>((resolve) => {
      const onBatch = (batch: { tick: number; commands: PlayerCommand[] }) => {
        if (batch.commands.length > 0) tail.push(batch);
        if (batch.tick === 9049) {
          opened.host.off('commands-batch', onBatch);
          resolve();
        }
      };
      opened.host.on('commands-batch', onBatch);
    });
    for (let tick = 9000; tick < 9050; tick++) {
      const commands =
        tick % 50 === 0 ? [{ type: 'ping', data: { n: tick } }] : [];
      opened.host.emit('submit-commands', { tick, commands });
    }
    await tailDone;

    const room = findRoom(server, opened.matchId);
    const flags = { matchEnd: false };
    watchMatchEnd(opened.host, flags);
    await server.stop();
    await waitForArchives(records, 1);
    const archive = records[0]!.archive;
    expect(records[0]!.afterMatchEnd).toBe(true);
    expect(archive.complete).toBe(true);
    const combined = JSON.stringify([...logged, ...tail]);
    const allBatches = JSON.stringify([...head, ...tail]);
    expect(JSON.stringify(archive.log)).toBe(combined);
    expect(JSON.stringify(archive.log)).toBe(allBatches);
    const buildMs = room.getLastArchiveBuildMs();
    const jsonKb = Buffer.byteLength(JSON.stringify(archive), 'utf8') / 1024;
    console.log(
      `[match-archive] 9000-tick build ${buildMs.toFixed(3)} ms, JSON ${jsonKb.toFixed(3)} KB`
    );
    expect(buildMs).toBeGreaterThanOrEqual(0);
    expect(jsonKb).toBeGreaterThan(0);
  }, 120_000);

  it('marks a numeric window incomplete only after it drops ticks', async () => {
    const longRecords: SeenArchive[] = [];
    const longServer = await startServer({
      commandHistoryTicks: 100,
      onMatchArchived: (archive) => {
        longRecords.push({ archive, afterMatchEnd: true });
      },
    });
    const longMatch = await openPrivateMatch(longServer.url);
    await playEventTicks(longMatch.host, 250, 50);
    const longRoom = findRoom(longServer.server, longMatch.matchId);
    expect(longRoom.getOldestLogTick()).toBeGreaterThan(0);
    const stored = longRoom.getLogRange(0, longRoom.getCurrentTick() - 1);
    await longServer.server.stop();
    await waitForArchives(longRecords, 1);
    expect(longRecords[0]!.archive.complete).toBe(false);
    expect(longRecords[0]!.archive.historyMode).toBe(100);
    expect(JSON.stringify(longRecords[0]!.archive.log)).toBe(
      JSON.stringify(stored)
    );
    expect(
      longRecords[0]!.archive.log.every((entry) => entry.commands.length > 0)
    ).toBe(true);

    const shortRecords: SeenArchive[] = [];
    const shortServer = await startServer({
      commandHistoryTicks: 100,
      onMatchArchived: (archive) => {
        shortRecords.push({ archive, afterMatchEnd: true });
      },
    });
    const shortMatch = await openPrivateMatch(shortServer.url);
    const batches = await playEventTicks(shortMatch.host, 40, 10);
    const shortRoom = findRoom(shortServer.server, shortMatch.matchId);
    expect(shortRoom.getOldestLogTick()).toBe(0);
    await shortServer.server.stop();
    await waitForArchives(shortRecords, 1);
    expect(shortRecords[0]!.archive.complete).toBe(true);
    expect(JSON.stringify(shortRecords[0]!.archive.log)).toBe(
      JSON.stringify(batches)
    );
  }, 60_000);
});

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
  fromTick: number
): Promise<MatchLogChunkEvent[]> {
  return new Promise((resolve, reject) => {
    const chunks: MatchLogChunkEvent[] = [];
    const onChunk = (chunk: MatchLogChunkEvent) => {
      if (chunk.matchId !== matchId) return;
      chunks.push(chunk);
      if (chunk.done) {
        cleanup();
        resolve(chunks);
      }
    };
    const onError = (error: MatchLogErrorEvent) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('match-log-chunk', onChunk);
      socket.off('match-log-error', onError);
    };
    socket.on('match-log-chunk', onChunk);
    socket.on('match-log-error', onError);
    socket.emit('match-log', { matchId, fromTick });
  });
}
