import { describe, expect, it, vi } from 'vitest';
import { PhalanxClient } from '../src/PhalanxClient.js';
import {
  SocketManager,
  type SocketManagerCallbacks,
  type SocketManagerConfig,
} from '../src/SocketManager.js';
import {
  MatchResumeRejected,
  MatchSessionStore,
  MemoryKeyValueStorage,
  type MatchResumeState,
  type MatchSession,
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

function clientWithSocket(options?: {
  buildId?: string;
  gameId?: string;
  storage?: MemoryKeyValueStorage;
  connectionTimeoutMs?: number;
}): { client: PhalanxClient; socket: MockSocket } {
  const client = new PhalanxClient({
    serverUrl: 'http://127.0.0.1:9',
    playerId: 'player-1',
    username: 'Player1',
    autoReconnect: false,
    connectionTimeoutMs: options?.connectionTimeoutMs ?? 1000,
    ...(options?.buildId !== undefined ? { buildId: options.buildId } : {}),
    ...(options?.gameId !== undefined ? { gameId: options.gameId } : {}),
    ...(options?.storage !== undefined
      ? { matchSessionStorage: options.storage }
      : {}),
  });
  const socket = createMockSocket();
  const internal = client as unknown as { socketManager: SocketManager };
  attach(internal.socketManager, socket);
  return { client, socket };
}

const session: MatchSession = {
  token: 'opaque-token',
  matchId: 'match-1',
  slot: 1,
  buildId: 'build-a',
};

const resumeState: MatchResumeState = {
  matchId: 'match-1',
  slot: 0,
  currentTick: 4,
  state: 'playing',
};

describe('MatchSessionStore', () => {
  it('saves, loads, and clears under phalanx.session.<gameId>', () => {
    const storage = new MemoryKeyValueStorage();
    const store = new MatchSessionStore('legion', storage);
    expect(store.load()).toBeNull();
    store.save(session);
    expect(storage.getItem('phalanx.session.legion')).toContain('opaque-token');
    expect(storage.getItem('phalanx.session.other')).toBeNull();
    expect(store.load()).toEqual(session);

    const other = new MatchSessionStore('other-game', storage);
    expect(other.load()).toBeNull();

    store.clear();
    expect(store.load()).toBeNull();
    expect(storage.getItem('phalanx.session.legion')).toBeNull();
  });

  it('treats a corrupt value as empty and removes it', () => {
    const storage = new MemoryKeyValueStorage();
    const store = new MatchSessionStore('legion', storage);
    storage.setItem('phalanx.session.legion', '{');
    expect(store.load()).toBeNull();
    expect(storage.getItem('phalanx.session.legion')).toBeNull();

    storage.setItem(
      'phalanx.session.legion',
      JSON.stringify({ token: 1, matchId: 'm', slot: 0, buildId: '' })
    );
    expect(store.load()).toBeNull();
    expect(storage.getItem('phalanx.session.legion')).toBeNull();
  });
});

describe('resumeMatch', () => {
  it('resolves after reconnect-state has put the client in the match', async () => {
    const { client, socket } = clientWithSocket({ buildId: 'build-a' });
    const pending = client.resumeMatch('opaque-token', 3);
    await vi.waitFor(() => {
      expect(socket.emit).toHaveBeenCalledWith('match-resume', {
        token: 'opaque-token',
        haveTick: 3,
        buildId: 'build-a',
      });
    });

    socket.fire('reconnect-state', {
      matchId: 'match-1',
      currentTick: 7,
      state: 'playing',
      recentCommands: [],
    });
    socket.fire('match-resume-state', { ...resumeState, currentTick: 99 });
    const state = await pending;
    expect(state.currentTick).toBe(99);
    expect(client.getClientState()).toBe('playing');
    expect(client.getCurrentTick()).toBe(7);
    expect(client.getMatchId()).toBe('match-1');
    expect(socket.listenerCount('match-resume-state')).toBe(0);
    expect(socket.listenerCount('match-resume-error')).toBe(0);
  });

  it('omits buildId when the client has none', async () => {
    const { client, socket } = clientWithSocket();
    const pending = client.resumeMatch('tok', -1);
    await vi.waitFor(() => {
      expect(socket.emit).toHaveBeenCalledWith('match-resume', {
        token: 'tok',
        haveTick: -1,
      });
    });
    socket.fire('match-resume-error', { reason: 'invalid' });
    await expect(pending).rejects.toBeInstanceOf(MatchResumeRejected);
  });

  it('rejects each server reason', async () => {
    const reasons = [
      'invalid',
      'expired',
      'match-ended',
      'build-mismatch',
    ] as const;
    for (const reason of reasons) {
      const { client, socket } = clientWithSocket();
      const pending = client.resumeMatch('tok', 0);
      await vi.waitFor(() => {
        expect(socket.emit).toHaveBeenCalled();
      });
      socket.fire('match-resume-error', { reason });
      await expect(pending).rejects.toMatchObject({ reason });
    }
  });

  it('rejects with timeout when the server does not answer', async () => {
    const { client } = clientWithSocket({ connectionTimeoutMs: 30 });
    const pending = client.resumeMatch('tok', 0);
    await expect(pending).rejects.toMatchObject({
      name: 'MatchResumeRejected',
      reason: 'timeout',
    });
  });
});

describe('session-token persistence', () => {
  it('saves session-token and clears it on match-end', () => {
    const storage = new MemoryKeyValueStorage();
    const { client, socket } = clientWithSocket({
      gameId: 'legion',
      buildId: 'build-a',
      storage,
    });
    const seen: string[] = [];
    client.on('sessionToken', (event) => seen.push(event.token));

    socket.fire('session-token', {
      token: 'opaque-token',
      matchId: 'match-9',
      slot: 1,
    });
    expect(seen).toEqual(['opaque-token']);
    expect(new MatchSessionStore('legion', storage).load()).toEqual({
      token: 'opaque-token',
      matchId: 'match-9',
      slot: 1,
      buildId: 'build-a',
    });

    socket.fire('match-end', { reason: 'stopped' });
    expect(new MatchSessionStore('legion', storage).load()).toBeNull();
  });

  it('emits sessionToken without writing when gameId is omitted', () => {
    const storage = new MemoryKeyValueStorage();
    const { client, socket } = clientWithSocket({ storage });
    const seen: string[] = [];
    client.on('sessionToken', (event) => seen.push(event.token));
    socket.fire('session-token', {
      token: 'opaque-token',
      matchId: 'match-9',
      slot: 0,
    });
    expect(seen).toEqual(['opaque-token']);
    expect(storage.getItem('phalanx.session.legion')).toBeNull();
  });
});

describe('SocketManager.resumeMatch', () => {
  it('uses the manager timeout and callbacks stay optional', async () => {
    const manager = new SocketManager(
      { ...baseConfig, connectionTimeoutMs: 20 },
      callbacks()
    );
    const socket = createMockSocket();
    attach(manager, socket);
    await expect(manager.resumeMatch('tok', 1)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });
});
