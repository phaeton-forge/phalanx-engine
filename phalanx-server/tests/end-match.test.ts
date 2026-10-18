import { afterEach, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { GameRoom } from '../src/services/GameRoom.js';
import { Phalanx } from '../src/Phalanx.js';
import { validateConfig } from '../src/config/validation.js';
import type {
  MatchFoundEvent,
  PhalanxConfig,
  PlayerCommand,
  PlayerCommandContext,
  QueuedPlayer,
  TickMode,
} from '../src/types/index.js';

interface LogEntry {
  event: string;
  payload: unknown;
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

function createRoom(
  teams: QueuedPlayer[][],
  options: {
    tickMode?: TickMode;
    listeners?: boolean;
    onCommand?: (
      playerId: string,
      command: PlayerCommand,
      ctx: PlayerCommandContext
    ) => void;
  } = {}
): { room: GameRoom; log: LogEntry[] } {
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
  for (const team of teams) {
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
  // Only `io.to().emit` and `io.sockets.sockets.get` are used.
  const ioServer = {
    to: () => ({
      emit: (event: string, payload: unknown) => {
        log.push({ event, payload });
      },
    }),
    sockets: { sockets },
  } as unknown as SocketIOServer;
  const partial: Partial<PhalanxConfig> = {
    port: 3011,
    countdownSeconds: 0,
    readyTimeoutMs: 60_000,
    timeoutTicks: 1_000_000,
    disconnectTicks: 1_000_000,
    turnTimeoutMs: 10_000_000,
  };
  if (options.tickMode) partial.tickMode = options.tickMode;
  const room = new GameRoom(
    'match-1',
    ioServer,
    validateConfig(partial),
    teams,
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
  for (const playerId of playerIds) room.handlePlayerReady(playerId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function matchEnds(
  log: LogEntry[]
): Array<{ reason: string; winnerTeamId?: number }> {
  return log
    .filter((entry) => entry.event === 'match-end')
    .map((entry) => {
      if (
        !isRecord(entry.payload) ||
        typeof entry.payload.reason !== 'string'
      ) {
        throw new Error('expected match-end');
      }
      const winner = entry.payload.winnerTeamId;
      return typeof winner === 'number'
        ? { reason: entry.payload.reason, winnerTeamId: winner }
        : { reason: entry.payload.reason };
    });
}

const P1 = qp('p1', 'sock-p1');
const P2 = qp('p2', 'sock-p2');
const P3 = qp('p3', 'sock-p3');
const P4 = qp('p4', 'sock-p4');

describe('GameRoom.endMatch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an explicit winnerTeamId and ignores a second call', () => {
    vi.useFakeTimers();
    const { room, log } = createRoom([[P1], [P2]]);
    reachPlaying(room, ['p1', 'p2']);
    expect(
      room.endMatch({
        reason: 'base-destroyed',
        winnerTeamId: 0,
        loserIds: ['p1'],
      })
    ).toBe(true);
    expect(matchEnds(log)).toEqual([
      { reason: 'base-destroyed', winnerTeamId: 0 },
    ]);
    const names = log.map((entry) => entry.event);
    expect(names.indexOf('match-end')).toBeLessThan(
      names.indexOf('match-ended')
    );
    expect(log.find((entry) => entry.event === 'match-ended')?.payload).toEqual(
      ['match-1', 'base-destroyed']
    );
    expect(room.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 })).toBe(
      false
    );
    expect(matchEnds(log)).toHaveLength(1);
    expect(room.getMatchInfo().state).toBe('finished');
    room.stop();
  });

  it('derives the winner from loserIds when one team remains', () => {
    vi.useFakeTimers();
    const { room, log } = createRoom([
      [P1, P2],
      [P3, P4],
    ]);
    reachPlaying(room, ['p1', 'p2', 'p3', 'p4']);
    expect(room.endMatch({ reason: 'disconnect', loserIds: ['p1'] })).toBe(
      true
    );
    expect(matchEnds(log)).toEqual([{ reason: 'disconnect', winnerTeamId: 1 }]);
    room.stop();
  });

  it('omits winnerTeamId for FFA and for abandoned', () => {
    vi.useFakeTimers();
    const ffa = createRoom([[P1], [P2], [P3], [P4]]);
    reachPlaying(ffa.room, ['p1', 'p2', 'p3', 'p4']);
    expect(ffa.room.endMatch({ reason: 'resign', loserIds: ['p1'] })).toBe(
      true
    );
    expect(
      ffa.log.find((entry) => entry.event === 'match-end')?.payload
    ).toEqual({ reason: 'resign' });
    ffa.room.stop();

    const abandoned = createRoom([[P1], [P2]]);
    reachPlaying(abandoned.room, ['p1', 'p2']);
    expect(
      abandoned.room.endMatch({
        reason: 'abandoned',
        winnerTeamId: 0,
        loserIds: ['p1'],
      })
    ).toBe(true);
    expect(matchEnds(abandoned.log)).toEqual([{ reason: 'abandoned' }]);
    abandoned.room.stop();
  });

  it('returns false on an unknown winnerTeamId and leaves the match playing', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { room, log } = createRoom([[P1], [P2]], {
      onCommand: (_playerId, command, ctx) => {
        if (command.type === 'destroy-base') {
          expect(
            ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 9 })
          ).toBe(false);
        }
      },
    });
    reachPlaying(room, ['p1', 'p2']);
    expect(room.endMatch({ reason: 'base-destroyed', winnerTeamId: 9 })).toBe(
      false
    );
    expect(
      room.handleCommand('p1', {
        type: 'destroy-base',
        tick: 0,
        playerId: 'p1',
        data: {},
      })
    ).toBe(true);
    expect(room.getMatchInfo().state).toBe('playing');
    expect(matchEnds(log)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'endMatch: winnerTeamId 9 does not exist'
    );
    warn.mockRestore();
    room.stop();
  });

  it('drops the player-command that ends the match', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const { room, log } = createRoom([[P1], [P2]], {
      onCommand: (_playerId, command, ctx) => {
        seen.push(command.type);
        if (command.type === 'destroy-base') {
          ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
        }
      },
    });
    reachPlaying(room, ['p1', 'p2']);
    const accepted = room.handleCommand('p1', {
      type: 'destroy-base',
      tick: 0,
      playerId: 'p1',
      data: {},
    });
    expect(accepted).toBe(false);
    expect(seen).toEqual(['destroy-base']);
    expect(room.getMatchInfo().state).toBe('finished');
    expect(matchEnds(log)).toEqual([
      { reason: 'base-destroyed', winnerTeamId: 1 },
    ]);
    vi.advanceTimersByTime(500);
    expect(log.some((entry) => entry.event === 'commands-batch')).toBe(false);
    room.stop();
  });

  it('drops a submit-commands batch when the hook ends the match', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const { room, log } = createRoom([[P1], [P2]], {
      tickMode: 'event',
      onCommand: (_playerId, command, ctx) => {
        seen.push(command.type);
        if (command.type === 'destroy-base') {
          ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
        }
      },
    });
    reachPlaying(room, ['p1', 'p2']);
    const result = room.receivePlayerCommands('p1', 0, [
      { type: 'destroy-base', tick: 0, playerId: 'p1', data: {} },
      { type: 'later', tick: 0, playerId: 'p1', data: {} },
    ]);
    expect(result.accepted).toBe(false);
    expect(seen).toEqual(['destroy-base']);
    expect(room.getCommandsForTick(0)).toBeNull();
    expect(log.some((entry) => entry.event === 'commands-batch')).toBe(false);
    expect(room.getMatchInfo().state).toBe('finished');
    room.stop();
  });

  it('still broadcasts submit-commands when the hook does not end the match', () => {
    vi.useFakeTimers();
    const { room, log } = createRoom([[P1], [P2]], {
      tickMode: 'event',
      listeners: false,
    });
    reachPlaying(room, ['p1', 'p2']);
    const result = room.receivePlayerCommands('p1', 0, [
      { type: 'move', tick: 0, playerId: 'p1', data: { x: 1 } },
    ]);
    expect(result.accepted).toBe(true);
    expect(log.some((entry) => entry.event === 'commands-batch')).toBe(true);
    expect(
      room.handleCommand('p1', {
        type: 'move',
        tick: 0,
        playerId: 'p1',
        data: {},
      })
    ).toBe(false);
    room.stop();
  });
});

describe('endMatch through the player-command socket hook', () => {
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

  afterEach(async () => {
    vi.useRealTimers();
    for (const client of clients) client.disconnect();
    clients.length = 0;
    if (server) {
      await server.stop();
      server = undefined;
    }
  });

  async function playingMatch(tickMode: TickMode): Promise<{
    client1: Socket;
    client2: Socket;
  }> {
    server = new Phalanx({
      port: 0,
      countdownSeconds: 0,
      matchmakingIntervalMs: 50,
      gameMode: '1v1',
      tickMode,
      turnTimeoutMs: 1_000_000,
      maxTickBehind: 1000,
      maxTickAhead: 1000,
    });
    server.on('player-command', (_playerId, command, ctx) => {
      if (command.type === 'destroy-base') {
        ctx.endMatch({ reason: 'base-destroyed', winnerTeamId: 1 });
      }
    });
    await server.start();
    const httpServer = (server as unknown as { httpServer: HttpServer | null })
      .httpServer;
    const address = httpServer?.address();
    if (!address || typeof address !== 'object') {
      throw new Error('Phalanx is not listening');
    }
    const url = `http://127.0.0.1:${address.port}`;
    const client1 = track(io(url, { forceNew: true, autoConnect: false }));
    const client2 = track(io(url, { forceNew: true, autoConnect: false }));
    const found1 = once<MatchFoundEvent>(client1, 'match-found');
    const found2 = once<MatchFoundEvent>(client2, 'match-found');
    const playing = new Promise<void>((resolve) => {
      server?.on('match-started', () => resolve());
    });
    client1.on('game-start', () => client1.emit('client-ready'));
    client2.on('game-start', () => client2.emit('client-ready'));
    await connect(client1);
    await connect(client2);
    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });
    await Promise.all([found1, found2]);
    await playing;
    return { client1, client2 };
  }

  it('player-command does not enter a commands-batch', async () => {
    const { client1, client2 } = await playingMatch('continuous');
    const batches: Array<{ commands: PlayerCommand[] }> = [];
    client2.on('commands-batch', (batch: { commands: PlayerCommand[] }) => {
      batches.push(batch);
    });
    const ended = once<{ reason: string; winnerTeamId?: number }>(
      client2,
      'match-end'
    );
    const sync = await once<{ tick: number }>(client2, 'tick-sync');
    const ack = once<{ accepted: boolean }>(client1, 'command-ack');
    client1.emit('player-command', {
      type: 'destroy-base',
      tick: sync.tick,
      playerId: 'player1',
      data: {},
    });
    await expect(ack).resolves.toMatchObject({ accepted: false });
    await expect(ended).resolves.toEqual({
      reason: 'base-destroyed',
      winnerTeamId: 1,
    });
    const countAtEnd = batches.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(batches.length).toBe(countAtEnd);
    expect(
      batches.every((batch) =>
        batch.commands.every((command) => command.type !== 'destroy-base')
      )
    ).toBe(true);
    expect(server?.getActiveMatches()).toEqual([]);
  });

  it('submit-commands does not enter a commands-batch', async () => {
    const { client1, client2 } = await playingMatch('event');
    const order: string[] = [];
    client2.on('commands-batch', (batch: { commands: PlayerCommand[] }) => {
      if (batch.commands.some((command) => command.type === 'destroy-base')) {
        order.push('commands-batch');
      }
    });
    client2.on('match-end', () => {
      order.push('match-end');
    });
    const ended = once<{ reason: string; winnerTeamId?: number }>(
      client2,
      'match-end'
    );
    const ack = once<{ accepted: boolean }>(client1, 'submit-commands-ack');
    client1.emit('submit-commands', {
      tick: 0,
      commands: [{ type: 'destroy-base', data: {} }],
    });
    await expect(ack).resolves.toMatchObject({ accepted: false });
    await expect(ended).resolves.toEqual({
      reason: 'base-destroyed',
      winnerTeamId: 1,
    });
    expect(order).toEqual(['match-end']);
    expect(server?.getActiveMatches()).toEqual([]);
  });

  it('drops a late bot command instead of filing it on a later tick', () => {
    vi.useFakeTimers();
    const { room, log } = createRoom([[P1], [P2]]);
    reachPlaying(room, ['p1', 'p2']);
    vi.advanceTimersByTime(250);
    expect(room.getCurrentTick()).toBeGreaterThan(0);
    room.enqueueStamped([
      {
        type: 'move',
        tick: 0,
        playerId: 'bot:1',
        data: { dx: 1 },
      },
    ]);
    expect(
      log.filter((entry) => entry.event === 'bot-commands-late')
    ).toHaveLength(1);
    vi.advanceTimersByTime(100);
    const leaked = log.filter((entry) => {
      if (entry.event !== 'commands-batch' || !isRecord(entry.payload)) {
        return false;
      }
      const commands = entry.payload['commands'];
      if (!Array.isArray(commands)) return false;
      return commands.some(
        (command) => isRecord(command) && command['playerId'] === 'bot:1'
      );
    });
    expect(leaked).toEqual([]);
    room.stop();
    vi.useRealTimers();
  });
});
