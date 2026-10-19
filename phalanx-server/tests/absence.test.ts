import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { Server as SocketIOServer } from 'socket.io';
import { GameRoom } from '../src/services/GameRoom.js';
import { Phalanx } from '../src/Phalanx.js';
import { validateConfig } from '../src/config/validation.js';
import { DEFAULT_ABSENCE, DEFAULT_CONFIG } from '../src/config/defaults.js';
import type {
  AbsenceConfig,
  MatchFoundEvent,
  PhalanxConfig,
  PlayerAbsentEvent,
  PlayerCommand,
  PlayerCommandContext,
  QueuedPlayer,
  TickMode,
} from '../src/types/index.js';

/**
 * Original timer, captured before any `vi.useFakeTimers()` call so socket
 * tests can flush I/O while GameRoom timers stay fake.
 */
const realSetTimeout = setTimeout;

function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    realSetTimeout(resolve, ms);
  });
}

interface LogEntry {
  event: string;
  payload: unknown;
}

interface RoomOptions {
  teams: QueuedPlayer[][];
  absence?: AbsenceConfig;
  tickMode?: TickMode;
  turnTimeoutMs?: number;
  timeoutTicks?: number;
  disconnectTicks?: number;
  /** When false, the emitter reports "no listeners" (EventEmitter's false). */
  listeners?: boolean;
  onCommand?: (
    playerId: string,
    command: PlayerCommand,
    ctx: PlayerCommandContext
  ) => void;
}

interface Harness {
  room: GameRoom;
  log: LogEntry[];
}

function qp(playerId: string, socketId: string): QueuedPlayer {
  return { playerId, username: playerId, socketId, joinedAt: 0 };
}

function isPlayerCommand(value: unknown): value is PlayerCommand {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    'tick' in value &&
    typeof value.tick === 'number' &&
    'playerId' in value &&
    typeof value.playerId === 'string' &&
    'data' in value
  );
}

function isCommandContext(value: unknown): value is PlayerCommandContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'matchId' in value &&
    typeof value.matchId === 'string' &&
    'endMatch' in value &&
    typeof value.endMatch === 'function'
  );
}

function createRoom(options: RoomOptions): Harness {
  const log: LogEntry[] = [];
  const sockets = new Map<
    string,
    {
      id: string;
      data: Record<string, unknown>;
      emit: (event: string, payload: unknown) => void;
      join: () => Promise<void>;
      to: () => { emit: (event: string, payload: unknown) => void };
    }
  >();
  for (const team of options.teams) {
    for (const player of team) {
      sockets.set(player.socketId, {
        id: player.socketId,
        data: {},
        emit: (event: string, payload: unknown) => {
          log.push({ event, payload });
        },
        join: () => Promise.resolve(),
        to: () => ({
          emit: (event: string, payload: unknown) => {
            log.push({ event, payload });
          },
        }),
      });
    }
  }
  // Unit tests only call `io.to().emit` and `io.sockets.sockets.get`.
  const ioServer = {
    to: () => ({
      emit: (event: string, payload: unknown) => {
        log.push({ event, payload });
      },
    }),
    sockets: { sockets },
  } as unknown as SocketIOServer;

  const partial: Partial<PhalanxConfig> = {
    port: 3010,
    countdownSeconds: 0,
    readyTimeoutMs: 60_000,
    tickRate: 20,
  };
  if (options.absence) partial.absence = options.absence;
  if (options.tickMode) partial.tickMode = options.tickMode;
  if (options.turnTimeoutMs !== undefined) {
    partial.turnTimeoutMs = options.turnTimeoutMs;
  }
  if (options.timeoutTicks !== undefined) {
    partial.timeoutTicks = options.timeoutTicks;
  }
  if (options.disconnectTicks !== undefined) {
    partial.disconnectTicks = options.disconnectTicks;
  } else if (options.timeoutTicks === undefined) {
    // Keep the opponent from tripping disconnectTicks during long advances.
    partial.timeoutTicks = 1_000_000;
    partial.disconnectTicks = 1_000_000;
  }
  const config = validateConfig(partial);
  const room = new GameRoom(
    'match-1',
    ioServer,
    config,
    options.teams,
    (event: string, ...args: unknown[]) => {
      log.push({ event, payload: args });
      if (event === 'player-command' && options.onCommand) {
        const playerId = args[0];
        const command = args[1];
        const ctx = args[2];
        if (
          typeof playerId === 'string' &&
          isPlayerCommand(command) &&
          isCommandContext(ctx)
        ) {
          options.onCommand(playerId, command, ctx);
        }
      }
      return options.listeners === false ? false : true;
    }
  );
  return { room, log };
}

function reachPlaying(room: GameRoom, playerIds: string[]): void {
  room.start();
  for (const playerId of playerIds) {
    room.handlePlayerReady(playerId);
  }
}

function events(log: LogEntry[], name: string): LogEntry[] {
  return log.filter((entry) => entry.event === name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function matchEndPayload(entry: LogEntry | undefined): {
  reason: string;
  winnerTeamId?: number;
} {
  if (
    !entry ||
    !isRecord(entry.payload) ||
    typeof entry.payload.reason !== 'string'
  ) {
    throw new Error('expected match-end payload');
  }
  const winner = entry.payload.winnerTeamId;
  if (winner !== undefined && typeof winner !== 'number') {
    throw new Error('winnerTeamId must be a number');
  }
  return winner === undefined
    ? { reason: entry.payload.reason }
    : { reason: entry.payload.reason, winnerTeamId: winner };
}

const P1 = qp('p1', 'sock-p1');
const P2 = qp('p2', 'sock-p2');
const DUEL: QueuedPlayer[][] = [[P1], [P2]];

describe('absence config', () => {
  it('leaves the timer off unless absence is set', () => {
    expect(DEFAULT_CONFIG).not.toHaveProperty('absence');
    expect(DEFAULT_ABSENCE).toEqual({
      windowMs: 120000,
      matchBudgetMs: 180000,
    });
    const config = validateConfig({});
    expect(config.absence).toBeUndefined();
    expect(validateConfig({ port: 0 }).port).toBe(0);
  });

  it('requires positive integers and allows a window longer than the budget', () => {
    expect(() =>
      validateConfig({ absence: { windowMs: 0, matchBudgetMs: 1 } })
    ).toThrow(/windowMs/);
    expect(() =>
      validateConfig({ absence: { windowMs: 1.5, matchBudgetMs: 2 } })
    ).toThrow(/windowMs/);
    expect(() =>
      validateConfig({ absence: { windowMs: 1, matchBudgetMs: 0 } })
    ).toThrow(/matchBudgetMs/);
    expect(() =>
      validateConfig({ absence: { windowMs: 5000, matchBudgetMs: 1000 } })
    ).not.toThrow();
  });
});

describe('GameRoom absence timer', () => {
  let harness: Harness | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    harness?.room.stop();
    harness = undefined;
    vi.useRealTimers();
  });

  function duel(
    absence?: AbsenceConfig,
    extra: Partial<RoomOptions> = {}
  ): Harness {
    harness = createRoom({
      teams: DUEL,
      ...(absence ? { absence } : {}),
      ...extra,
    });
    reachPlaying(harness.room, ['p1', 'p2']);
    return harness;
  }

  it('does nothing during playing when absence is omitted', () => {
    const { room, log } = duel();
    room.handleDisconnect('sock-p1');
    vi.advanceTimersByTime(180_001);
    expect(events(log, 'player-absent')).toHaveLength(0);
    expect(room.getAbsences()).toEqual([]);
    expect(room.getMatchInfo().state).toBe('playing');
    const disconnected = events(log, 'player-disconnected').at(-1);
    expect(disconnected?.payload).toEqual({
      playerId: 'p1',
      matchId: 'match-1',
      gracePeriodMs: 30_000,
    });
  });

  it('emits player-absent and getAbsences tracks the remaining time', () => {
    const { room, log } = duel(DEFAULT_ABSENCE);
    expect(room.getAbsences()).toEqual([]);
    room.handleDisconnect('sock-p1');
    expect(events(log, 'player-absent').at(-1)?.payload).toEqual({
      playerId: 'p1',
      deadlineMs: 120_000,
      budgetLeftMs: 180_000,
    });
    expect(room.getAbsences()).toEqual([
      { playerId: 'p1', deadlineMs: 120_000, budgetLeftMs: 180_000 },
    ]);
    vi.advanceTimersByTime(10_000);
    expect(room.getAbsences()).toEqual([
      { playerId: 'p1', deadlineMs: 110_000, budgetLeftMs: 170_000 },
    ]);
  });

  it('stops the timer on return and charges the elapsed time', () => {
    const { room, log } = duel(DEFAULT_ABSENCE);
    room.handleDisconnect('sock-p1');
    vi.advanceTimersByTime(100_000);
    expect(room.handleReconnect('p1', 'sock-p1b')).toBe(true);
    expect(room.getAbsences()).toEqual([]);
    expect(room.getMatchInfo().state).toBe('playing');
    vi.advanceTimersByTime(80_000);
    expect(events(log, 'match-end')).toHaveLength(0);

    room.handleDisconnect('sock-p1b');
    expect(room.getAbsences()).toEqual([
      { playerId: 'p1', deadlineMs: 80_000, budgetLeftMs: 80_000 },
    ]);
    vi.advanceTimersByTime(79_999);
    expect(room.getMatchInfo().state).toBe('playing');
    vi.advanceTimersByTime(1);
    expect(room.getMatchInfo().state).toBe('finished');
    expect(matchEndPayload(events(log, 'match-end').at(-1))).toEqual({
      reason: 'disconnect',
      winnerTeamId: 1,
    });
    const names = log.map((entry) => entry.event);
    const endAt = names.lastIndexOf('match-end');
    const endedAt = names.lastIndexOf('match-ended');
    expect(endAt).toBeGreaterThanOrEqual(0);
    expect(endedAt).toBeGreaterThan(endAt);
    const ended = log[endedAt];
    expect(ended?.payload).toEqual(['match-1', 'disconnect']);
  });

  it('ends as abandoned when every human is already gone', () => {
    const { room, log } = duel(DEFAULT_ABSENCE);
    room.handleDisconnect('sock-p2');
    room.handleDisconnect('sock-p1');
    expect(room.getAbsences().map((row) => row.playerId)).toEqual(['p1', 'p2']);
    vi.advanceTimersByTime(120_000);
    expect(matchEndPayload(events(log, 'match-end').at(-1))).toEqual({
      reason: 'abandoned',
    });
    expect(events(log, 'match-end')).toHaveLength(1);
    expect(room.getMatchInfo().state).toBe('finished');
  });

  it('caps the deadline at the remaining budget', () => {
    const { room } = duel({ windowMs: 5000, matchBudgetMs: 1000 });
    room.handleDisconnect('sock-p1');
    expect(room.getAbsences()).toEqual([
      { playerId: 'p1', deadlineMs: 1000, budgetLeftMs: 1000 },
    ]);
  });

  it('expires a spent budget on a zero-delay timer, not inside disconnect', () => {
    const { room, log } = duel({ windowMs: 5000, matchBudgetMs: 1000 });
    const started = Date.now();
    room.handleDisconnect('sock-p1');
    vi.setSystemTime(started + 1000);
    expect(room.handleReconnect('p1', 'sock-p1')).toBe(true);
    expect(room.getAbsences()).toEqual([]);
    room.handleDisconnect('sock-p1');
    expect(room.getMatchInfo().state).toBe('playing');
    expect(room.getAbsences()[0]?.deadlineMs).toBe(0);
    vi.advanceTimersByTime(0);
    expect(room.getMatchInfo().state).toBe('finished');
    expect(matchEndPayload(events(log, 'match-end').at(-1)).reason).toBe(
      'disconnect'
    );
  });

  it('starts one timer from disconnectTicks and ignores the later socket drop', () => {
    const { room, log } = duel(DEFAULT_ABSENCE, {
      timeoutTicks: 40,
      disconnectTicks: 100,
    });
    const keepAlive = setInterval(() => {
      room.updatePlayerActivity('p2');
    }, 1000);
    vi.advanceTimersByTime(5000);
    expect(room.getAbsences()).toEqual([
      { playerId: 'p1', deadlineMs: 120_000, budgetLeftMs: 180_000 },
    ]);
    const timeout = events(log, 'player-timeout').find(
      (entry) => isRecord(entry.payload) && !Array.isArray(entry.payload)
    );
    expect(timeout?.payload).toMatchObject({ playerId: 'p1' });
    expect(timeout?.payload).not.toHaveProperty('deadlineMs');
    expect(timeout?.payload).not.toHaveProperty('gracePeriodMs');
    const p1 = room.getMatchInfo().players.find((player) => player.id === 'p1');
    expect(p1?.connected).toBe(false);
    vi.advanceTimersByTime(10_000);
    const before = room.getAbsences()[0]?.deadlineMs;
    expect(before).toBe(110_000);
    room.handleDisconnect('sock-p1');
    expect(room.getAbsences()).toHaveLength(1);
    expect(room.getAbsences()[0]?.deadlineMs).toBe(before);
    expect(events(log, 'player-absent')).toHaveLength(1);
    clearInterval(keepAlive);
  });

  it('treats a later message as a return only when absence is enabled', () => {
    const enabled = duel(DEFAULT_ABSENCE, {
      timeoutTicks: 40,
      disconnectTicks: 100,
    });
    const keepAlive = setInterval(() => {
      enabled.room.updatePlayerActivity('p2');
    }, 1000);
    vi.advanceTimersByTime(5000);
    expect(
      enabled.room.getMatchInfo().players.find((player) => player.id === 'p1')
        ?.connected
    ).toBe(false);
    enabled.room.updatePlayerActivity('p1');
    expect(
      enabled.room.getMatchInfo().players.find((player) => player.id === 'p1')
        ?.connected
    ).toBe(true);
    expect(enabled.room.getAbsences()).toEqual([]);
    expect(events(enabled.log, 'player-reconnected').length).toBeGreaterThan(0);
    vi.advanceTimersByTime(120_000);
    expect(enabled.room.getMatchInfo().state).toBe('playing');
    clearInterval(keepAlive);
    enabled.room.stop();

    const disabled = createRoom({
      teams: DUEL,
      timeoutTicks: 40,
      disconnectTicks: 100,
    });
    harness = disabled;
    reachPlaying(disabled.room, ['p1', 'p2']);
    const keepOther = setInterval(() => {
      disabled.room.updatePlayerActivity('p2');
    }, 1000);
    vi.advanceTimersByTime(5000);
    disabled.room.updatePlayerActivity('p1');
    expect(
      disabled.room.getMatchInfo().players.find((player) => player.id === 'p1')
        ?.connected
    ).toBe(false);
    expect(events(disabled.log, 'player-absent')).toHaveLength(0);
    expect(events(disabled.log, 'player-reconnected')).toHaveLength(0);
    clearInterval(keepOther);
  });

  it('clears timers on stop so they cannot fire afterwards', () => {
    const { room, log } = duel(DEFAULT_ABSENCE);
    room.handleDisconnect('sock-p1');
    expect(room.getAbsences()).toHaveLength(1);
    room.stop();
    expect(room.getAbsences()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    const ends = events(log, 'match-end').length;
    vi.advanceTimersByTime(180_000);
    expect(events(log, 'match-end')).toHaveLength(ends);
    expect(matchEndPayload(events(log, 'match-end').at(-1)).reason).toBe(
      'stopped'
    );
    expect(room.getAbsences()).toEqual([]);
  });

  it('does not start a timer after the match is finished or while paused', () => {
    const paused = duel(DEFAULT_ABSENCE);
    expect(paused.room.pause('p2')).toBe(true);
    paused.room.handleDisconnect('sock-p1');
    expect(paused.room.getAbsences()).toEqual([]);
    vi.advanceTimersByTime(180_000);
    expect(paused.room.getMatchInfo().state).toBe('paused');
    paused.room.stop();
    const absentBefore = events(paused.log, 'player-absent').length;
    paused.room.handleDisconnect('sock-p2');
    expect(events(paused.log, 'player-absent')).toHaveLength(absentBefore);

    const running = createRoom({ teams: DUEL, absence: DEFAULT_ABSENCE });
    harness = running;
    reachPlaying(running.room, ['p1', 'p2']);
    running.room.handleDisconnect('sock-p1');
    expect(running.room.pause('p2')).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(running.room.getMatchInfo().state).toBe('finished');
    expect(matchEndPayload(events(running.log, 'match-end').at(-1))).toEqual({
      reason: 'disconnect',
      winnerTeamId: 1,
    });
  });

  it('starts the absence timer on resume after a disconnect during pause', () => {
    const { room, log } = duel({ windowMs: 120_000, matchBudgetMs: 8000 });
    room.handleDisconnect('sock-p1');
    vi.setSystemTime(Date.now() + 3000);
    expect(room.handleReconnect('p1', 'sock-p1')).toBe(true);
    expect(room.pause('p2')).toBe(true);
    const absentBefore = events(log, 'player-absent').length;
    room.handleDisconnect('sock-p1');
    expect(room.getAbsences()).toEqual([]);
    expect(events(log, 'player-absent')).toHaveLength(absentBefore);
    expect(room.resume('p2')).toBe(true);
    expect(room.getMatchInfo().state).toBe('playing');
    expect(room.getAbsences()).toEqual([
      { playerId: 'p1', deadlineMs: 5000, budgetLeftMs: 5000 },
    ]);
    vi.advanceTimersByTime(5000);
    expect(room.getMatchInfo().state).toBe('finished');
    expect(matchEndPayload(events(log, 'match-end').at(-1))).toEqual({
      reason: 'disconnect',
      winnerTeamId: 1,
    });
  });

  it('stops a running timer when the absent player messages during pause', () => {
    const running = duel(DEFAULT_ABSENCE);
    running.room.handleDisconnect('sock-p1');
    expect(running.room.pause('p2')).toBe(true);
    running.room.updatePlayerActivity('p1');
    expect(running.room.getAbsences()).toEqual([]);
    expect(
      running.room.getMatchInfo().players.find((player) => player.id === 'p1')
        ?.connected
    ).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(running.room.getMatchInfo().state).toBe('paused');
    expect(
      events(running.log, 'match-end').some(
        (entry) =>
          isRecord(entry.payload) && entry.payload.reason === 'disconnect'
      )
    ).toBe(false);
    running.room.stop();

    const quiet = createRoom({ teams: DUEL, absence: DEFAULT_ABSENCE });
    harness = quiet;
    reachPlaying(quiet.room, ['p1', 'p2']);
    expect(quiet.room.pause('p2')).toBe(true);
    quiet.room.handleDisconnect('sock-p1');
    quiet.room.updatePlayerActivity('p1');
    expect(quiet.room.getAbsences()).toEqual([]);
    expect(
      quiet.room.getMatchInfo().players.find((player) => player.id === 'p1')
        ?.connected
    ).toBe(false);
  });

  it('in event mode starts the timer only from a socket drop', () => {
    const { room, log } = duel(DEFAULT_ABSENCE, {
      tickMode: 'event',
      turnTimeoutMs: 10_000_000,
      timeoutTicks: 40,
      disconnectTicks: 100,
    });
    vi.advanceTimersByTime(180_000);
    expect(events(log, 'player-absent')).toHaveLength(0);
    expect(room.getMatchInfo().state).toBe('playing');
    const moved = room.receivePlayerCommands('p2', 0, [
      { type: 'move', tick: 0, playerId: 'p2', data: { x: 1 } },
    ]);
    expect(moved.accepted).toBe(true);
    room.handleDisconnect('sock-p1');
    expect(room.getAbsences()).toHaveLength(1);
    vi.advanceTimersByTime(120_000);
    const names = log.map((entry) => entry.event);
    const endAt = names.lastIndexOf('match-end');
    const lastBatch = names.lastIndexOf('commands-batch');
    expect(lastBatch).toBeGreaterThanOrEqual(0);
    expect(lastBatch).toBeLessThan(endAt);
    expect(names.slice(endAt + 1)).not.toContain('commands-batch');
  });

  it('notifies a custom policy instead of ending the match', () => {
    const calls: string[] = [];
    const { room } = duel(DEFAULT_ABSENCE);
    room.setAbsencePolicy({
      onAbsent: (playerId: string) => {
        calls.push(`absent:${playerId}`);
      },
      onReturn: (playerId: string) => {
        calls.push(`return:${playerId}`);
      },
      onExpire: (playerId: string) => {
        calls.push(`expire:${playerId}`);
      },
    });
    room.handleDisconnect('sock-p1');
    room.handleReconnect('p1', 'sock-p1');
    room.handleDisconnect('sock-p1');
    vi.advanceTimersByTime(120_000);
    expect(calls).toEqual(['absent:p1', 'return:p1', 'absent:p1', 'expire:p1']);
    expect(room.getMatchInfo().state).toBe('playing');
  });

  it('reports onReturn when stop or endMatch clears an absence', () => {
    const stopped: string[] = [];
    const stopping = duel(DEFAULT_ABSENCE);
    stopping.room.setAbsencePolicy({
      onAbsent: () => {},
      onReturn: (playerId: string) => {
        stopped.push(playerId);
      },
      onExpire: () => {},
    });
    stopping.room.handleDisconnect('sock-p1');
    stopping.room.stop();
    expect(stopped).toEqual(['p1']);
    expect(stopping.room.getAbsences()).toEqual([]);

    const ended: string[] = [];
    const ending = createRoom({
      teams: DUEL,
      absence: DEFAULT_ABSENCE,
      onCommand: (_playerId, command, ctx) => {
        if (command.type === 'destroy-base') {
          ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
        }
      },
    });
    harness = ending;
    reachPlaying(ending.room, ['p1', 'p2']);
    ending.room.setAbsencePolicy({
      onAbsent: () => {},
      onReturn: (playerId: string) => {
        ended.push(playerId);
      },
      onExpire: () => {},
    });
    ending.room.handleDisconnect('sock-p1');
    expect(
      ending.room.handleCommand('p2', {
        type: 'destroy-base',
        tick: 0,
        playerId: 'p2',
        data: {},
      })
    ).toBe(false);
    expect(ended).toEqual(['p1']);
    expect(ending.room.getMatchInfo().state).toBe('finished');
  });
});

describe('absence over real sockets', () => {
  const clients: Socket[] = [];
  let server: Phalanx | undefined;

  function track(client: Socket): Socket {
    clients.push(client);
    return client;
  }

  async function connect(client: Socket): Promise<void> {
    await new Promise<void>((resolve) => {
      client.on('connect', () => resolve());
      client.connect();
    });
  }

  function once<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => {
      socket.once(event, (data: T) => resolve(data));
    });
  }

  async function cleanup(): Promise<void> {
    vi.useRealTimers();
    for (const client of clients) {
      client.disconnect();
    }
    clients.length = 0;
    if (server) {
      await server.stop();
      server = undefined;
    }
  }

  afterEach(async () => {
    await cleanup();
  });

  async function twoPlayerMatch(config: Partial<PhalanxConfig>): Promise<{
    client1: Socket;
    client2: Socket;
    matchId: string;
    team2: number;
  }> {
    server = new Phalanx({
      port: 0,
      countdownSeconds: 0,
      matchmakingIntervalMs: 50,
      gameMode: '1v1',
      ...config,
    });
    await server.start();
    const url = `http://127.0.0.1:${String(server!.getPort())}`;
    const client1 = track(io(url, { forceNew: true, autoConnect: false }));
    const client2 = track(io(url, { forceNew: true, autoConnect: false }));
    const found1 = once<MatchFoundEvent>(client1, 'match-found');
    const found2 = once<MatchFoundEvent>(client2, 'match-found');
    const playing = new Promise<void>((resolve) => {
      server?.on('match-started', () => resolve());
    });
    client1.on('game-start', () => {
      client1.emit('client-ready');
    });
    client2.on('game-start', () => {
      client2.emit('client-ready');
    });
    await connect(client1);
    await connect(client2);
    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });
    const [match1, match2] = await Promise.all([found1, found2]);
    await playing;
    return {
      client1,
      client2,
      matchId: match1.matchId,
      team2: match2.teamId,
    };
  }

  it('socket drop, player-absent, then match-end with the opponent team', async () => {
    const { client1, client2, team2 } = await twoPlayerMatch({
      tickMode: 'event',
      turnTimeoutMs: 1_000_000,
      absence: DEFAULT_ABSENCE,
    });
    const order: string[] = [];
    let absent: PlayerAbsentEvent | undefined;
    let ended: { reason?: string; winnerTeamId?: number } | undefined;
    client2.on('player-absent', (payload: PlayerAbsentEvent) => {
      order.push('player-absent');
      absent = payload;
    });
    client2.on(
      'match-end',
      (payload: { reason?: string; winnerTeamId?: number }) => {
        order.push('match-end');
        ended = payload;
      }
    );
    client2.on('commands-batch', () => {
      order.push('commands-batch');
    });
    const batched = once<{ commands: PlayerCommand[] }>(
      client2,
      'commands-batch'
    );
    client2.emit('submit-commands', {
      tick: 0,
      commands: [{ type: 'move', data: { x: 1 } }],
    });
    await batched;

    vi.useFakeTimers();
    client1.disconnect();
    await realDelay(300);
    if (!absent) {
      await vi.advanceTimersByTimeAsync(1000);
      await realDelay(200);
    }
    expect(absent).toEqual({
      playerId: 'player1',
      deadlineMs: 120_000,
      budgetLeftMs: 180_000,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await realDelay(300);
    expect(ended).toEqual({
      reason: 'disconnect',
      winnerTeamId: team2,
    });
    const endAt = order.indexOf('match-end');
    const lastBatch = order.lastIndexOf('commands-batch');
    expect(lastBatch).toBeGreaterThanOrEqual(0);
    expect(lastBatch).toBeLessThan(endAt);
    expect(order.slice(endAt + 1)).not.toContain('commands-batch');
    expect(server?.getActiveMatches()).toEqual([]);
  });

  it('keeps the match going when the player returns before the window', async () => {
    const { client1, client2, matchId } = await twoPlayerMatch({
      tickMode: 'event',
      turnTimeoutMs: 1_000_000,
      absence: { windowMs: 3000, matchBudgetMs: 10_000 },
    });
    const absent = once<PlayerAbsentEvent>(client2, 'player-absent');
    let ended = false;
    client2.on('match-end', () => {
      ended = true;
    });
    client1.disconnect();
    await expect(absent).resolves.toMatchObject({ playerId: 'player1' });

    const returned = track(
      io(`http://127.0.0.1:${String(server!.getPort())}`, {
        forceNew: true,
        autoConnect: false,
      })
    );
    await connect(returned);
    const status = once<{ success: boolean }>(returned, 'reconnect-status');
    returned.emit('reconnect-match', { playerId: 'player1', matchId });
    await expect(status).resolves.toEqual({ success: true });

    await realDelay(3500);
    expect(ended).toBe(false);
    expect(server?.getActiveMatches()).toHaveLength(1);
    const batched = once<{ commands: PlayerCommand[] }>(
      client2,
      'commands-batch'
    );
    returned.emit('submit-commands', {
      tick: 0,
      commands: [{ type: 'move', data: { x: 1 } }],
    });
    const batch = await batched;
    expect(batch.commands.some((command) => command.type === 'move')).toBe(
      true
    );
  });

  it('continuous mode ends the match after a socket drop', async () => {
    const { client1, client2, team2 } = await twoPlayerMatch({
      timeoutTicks: 1_000_000,
      disconnectTicks: 1_000_000,
      absence: { windowMs: 1500, matchBudgetMs: 10_000 },
    });
    const absent = once<PlayerAbsentEvent>(client2, 'player-absent');
    const ended = once<{ reason?: string; winnerTeamId?: number }>(
      client2,
      'match-end'
    );
    client1.disconnect();
    await expect(absent).resolves.toMatchObject({
      playerId: 'player1',
      deadlineMs: 1500,
      budgetLeftMs: 10_000,
    });
    await expect(ended).resolves.toEqual({
      reason: 'disconnect',
      winnerTeamId: team2,
    });
    expect(server?.getActiveMatches()).toEqual([]);
  });
});
