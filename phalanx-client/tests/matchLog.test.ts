import { describe, it, expect, vi } from 'vitest';
import { PhalanxClient } from '../src/PhalanxClient.js';
import {
  SocketManager,
  type SocketManagerCallbacks,
  type SocketManagerConfig,
} from '../src/SocketManager.js';
import {
  MatchLogError,
  type LogChunk,
  type ServerShutdownEvent,
} from '../src/index.js';

type SocketListener = (data: unknown) => void;

interface MockSocket {
  connected: boolean;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  listeners: (event: string) => SocketListener[];
  fire: (event: string, data: unknown) => void;
  listenerCount: (event: string) => number;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, SocketListener[]>();

  const on = vi.fn((event: string, handler: SocketListener) => {
    const list = handlers.get(event) ?? [];
    list.push(handler);
    handlers.set(event, list);
  });

  const off = vi.fn((event: string, handler: SocketListener) => {
    const list = handlers.get(event);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  });

  return {
    connected: true,
    emit: vi.fn(),
    on,
    once: vi.fn((event: string, handler: SocketListener) => {
      const wrapped: SocketListener = (data) => {
        off(event, wrapped);
        handler(data);
      };
      on(event, wrapped);
    }),
    off,
    listeners: (event: string) => handlers.get(event)?.slice() ?? [],
    listenerCount: (event: string) => handlers.get(event)?.length ?? 0,
    fire: (event: string, data: unknown) => {
      for (const handler of handlers.get(event)?.slice() ?? []) {
        handler(data);
      }
    },
  };
}

const baseConfig: SocketManagerConfig = {
  serverUrl: 'http://127.0.0.1:9',
  playerId: 'player-1',
  username: 'Player1',
  connectionTimeoutMs: 1000,
  recoverRoomTimeoutMs: 1000,
  socketTransports: ['websocket'],
  autoReconnect: false,
  maxReconnectAttempts: 0,
  reconnectDelayMs: 100,
  debug: false,
};

function callbacks(): SocketManagerCallbacks {
  return {
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onReconnecting: vi.fn(),
    onReconnectFailed: vi.fn(),
    onError: vi.fn(),
    onMatchFound: vi.fn(),
    onCountdown: vi.fn(),
    onGameStart: vi.fn(),
    onMatchEnd: vi.fn(),
    onTickSync: vi.fn(),
    onCommandsBatch: vi.fn(),
    onPlayerDisconnected: vi.fn(),
    onPlayerReconnected: vi.fn(),
    onPlayerReady: vi.fn(),
    onReconnectState: vi.fn(),
    onReconnectStatus: vi.fn(),
    onHashComparison: vi.fn(),
    onGamePaused: vi.fn(),
    onGameResumed: vi.fn(),
    onRoomError: vi.fn(),
    onRoomExpired: vi.fn(),
    onRoomCancelled: vi.fn(),
    onRoomRecovered: vi.fn(),
    isPlaying: () => false,
    getCurrentMatchId: () => null,
  };
}

/** SocketManager keeps its socket private; tests install a mock the same way the recovery tests do. */
function attach(manager: SocketManager, socket: MockSocket): void {
  const internal = manager as unknown as {
    socket: MockSocket;
    connectionState: string;
    setupEventHandlers: () => void;
  };
  internal.socket = socket;
  internal.connectionState = 'connected';
  internal.setupEventHandlers();
}

function clientWithSocket(buildId?: string): {
  client: PhalanxClient;
  socket: MockSocket;
} {
  const client = new PhalanxClient({
    serverUrl: 'http://127.0.0.1:9',
    playerId: 'player-1',
    username: 'Player1',
    autoReconnect: false,
    ...(buildId !== undefined ? { buildId } : {}),
  });
  const socket = createMockSocket();
  const internal = client as unknown as {
    currentMatchId: string | null;
    socketManager: SocketManager;
  };
  internal.currentMatchId = 'match-1';
  attach(internal.socketManager, socket);
  return { client, socket };
}

const chunk = (fromTick: number, toTick: number, done: boolean): LogChunk => ({
  matchId: 'match-1',
  fromTick,
  toTick,
  entries:
    fromTick === 0
      ? [{ tick: 0, commands: [{ type: 'ping', data: { n: 0 } }] }]
      : [],
  done,
});

describe('fetchMatchLog', () => {
  it('yields chunks in order and finishes on done', async () => {
    const { client, socket } = clientWithSocket();
    const collected: LogChunk[] = [];
    const done = (async () => {
      for await (const item of client.fetchMatchLog(0)) {
        collected.push(item);
      }
    })();

    await vi.waitFor(() => {
      expect(socket.emit).toHaveBeenCalledWith('match-log', {
        matchId: 'match-1',
        fromTick: 0,
      });
    });

    socket.fire('match-log-chunk', chunk(0, 1999, false));
    await vi.waitFor(() => {
      expect(collected).toHaveLength(1);
    });
    socket.fire('match-log-chunk', chunk(2000, 2000, true));
    await done;

    expect(collected.map((item) => item.fromTick)).toEqual([0, 2000]);
    expect(collected[1]!.done).toBe(true);
    expect(socket.listenerCount('match-log-chunk')).toBe(0);
    expect(socket.listenerCount('match-log-error')).toBe(0);
  });

  it('passes maxTicks only when the caller set it', async () => {
    const { client, socket } = clientWithSocket();
    const pending = client
      .fetchMatchLog(4, { maxTicks: 3 })
      [Symbol.asyncIterator]();
    const next = pending.next();
    await vi.waitFor(() => {
      expect(socket.emit).toHaveBeenCalledWith('match-log', {
        matchId: 'match-1',
        fromTick: 4,
        maxTicks: 3,
      });
    });
    socket.fire('match-log-chunk', chunk(4, 6, true));
    await next;
    await pending.return(undefined);
  });

  it('removes listeners when the caller breaks', async () => {
    const { client, socket } = clientWithSocket();
    const done = (async () => {
      for await (const _item of client.fetchMatchLog(0)) {
        break;
      }
    })();
    await vi.waitFor(() => {
      expect(socket.listenerCount('match-log-chunk')).toBe(1);
    });
    socket.fire('match-log-chunk', chunk(0, 10, false));
    await done;
    expect(socket.listenerCount('match-log-chunk')).toBe(0);
    expect(socket.listenerCount('match-log-error')).toBe(0);
  });

  it('rejects with MatchLogError and drops listeners', async () => {
    const { client, socket } = clientWithSocket();
    const consuming = (async () => {
      for await (const _item of client.fetchMatchLog(0)) {
        // The server refuses before any chunk.
      }
    })();
    await vi.waitFor(() => {
      expect(socket.listenerCount('match-log-error')).toBe(1);
    });
    socket.fire('match-log-error', { matchId: 'match-1', reason: 'truncated' });
    try {
      await consuming;
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MatchLogError);
      expect((error as MatchLogError).reason).toBe('truncated');
    }
    expect(socket.listenerCount('match-log-chunk')).toBe(0);
    expect(socket.listenerCount('match-log-error')).toBe(0);
  });

  it('rejects with disconnected and removes listeners when the socket drops', async () => {
    const { client, socket } = clientWithSocket();
    const pending = client.fetchMatchLog(0)[Symbol.asyncIterator]();
    const next = pending.next();
    await vi.waitFor(() => {
      expect(socket.listenerCount('match-log-chunk')).toBe(1);
      expect(socket.listenerCount('disconnect')).toBe(2);
    });
    socket.fire('disconnect', 'transport close');
    try {
      await next;
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MatchLogError);
      expect((error as MatchLogError).reason).toBe('disconnected');
    }
    expect(socket.listenerCount('match-log-chunk')).toBe(0);
    expect(socket.listenerCount('match-log-error')).toBe(0);
    expect(socket.listenerCount('disconnect')).toBe(1);
  });

  it('rejects an error that arrives between chunks while nobody is waiting', async () => {
    const { client, socket } = clientWithSocket();
    const consuming = (async () => {
      for await (const item of client.fetchMatchLog(0)) {
        if (!item.done) {
          socket.fire('match-log-error', {
            matchId: 'match-1',
            reason: 'truncated',
          });
        }
      }
    })();
    await vi.waitFor(() => {
      expect(socket.listenerCount('match-log-chunk')).toBe(1);
    });
    socket.fire('match-log-chunk', chunk(0, 1999, false));
    try {
      await consuming;
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MatchLogError);
      expect((error as MatchLogError).reason).toBe('truncated');
    }
    expect(socket.listenerCount('match-log-chunk')).toBe(0);
    expect(socket.listenerCount('match-log-error')).toBe(0);
    expect(socket.listenerCount('disconnect')).toBe(1);
  });

  it('throws when the client is not in a match', () => {
    const client = new PhalanxClient({
      serverUrl: 'http://127.0.0.1:9',
      playerId: 'player-1',
      username: 'Player1',
      autoReconnect: false,
    });
    expect(() => client.fetchMatchLog(0)).toThrow(/Not in a match/);
  });
});

describe('buildId and serverShutdown', () => {
  it('omits buildId from join payloads unless the config sets it', async () => {
    const plain = new SocketManager(baseConfig, callbacks());
    const plainSocket = createMockSocket();
    attach(plain, plainSocket);

    const joined = plain.joinQueue('skirmish');
    expect(plainSocket.emit).toHaveBeenCalledWith('queue-join', {
      playerId: 'player-1',
      username: 'Player1',
      gameType: 'skirmish',
    });
    plainSocket.fire('queue-status', { position: 1, waitTime: 0 });
    await joined;

    const creating = plain.createRoom();
    expect(plainSocket.emit).toHaveBeenCalledWith('room-create', {
      playerId: 'player-1',
      username: 'Player1',
      gameType: undefined,
    });
    plainSocket.fire('room-created', { code: 'ABC' });
    await creating;

    plain.joinRoom('abc');
    expect(plainSocket.emit).toHaveBeenCalledWith('room-join', {
      playerId: 'player-1',
      username: 'Player1',
      code: 'abc',
    });

    const tagged = new SocketManager(
      { ...baseConfig, buildId: 'build-1' },
      callbacks()
    );
    const taggedSocket = createMockSocket();
    attach(tagged, taggedSocket);
    const taggedJoin = tagged.joinQueue();
    expect(taggedSocket.emit).toHaveBeenCalledWith('queue-join', {
      playerId: 'player-1',
      username: 'Player1',
      gameType: undefined,
      buildId: 'build-1',
    });
    taggedSocket.fire('queue-status', { position: 1, waitTime: 0 });
    await taggedJoin;
  });

  it('emits serverShutdown from the socket event', () => {
    const { client, socket } = clientWithSocket();
    const seen: ServerShutdownEvent[] = [];
    client.on('serverShutdown', (event) => {
      seen.push(event);
    });
    socket.fire('server-shutdown', { reason: 'sigterm', matchIds: ['m-1'] });
    expect(seen).toEqual([{ reason: 'sigterm', matchIds: ['m-1'] }]);
  });
});
