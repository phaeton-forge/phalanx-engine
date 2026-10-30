import { describe, it, expect, vi } from 'vitest';
import { PhalanxClient } from '../src/PhalanxClient.js';
import {
  SocketManager,
  type SocketManagerCallbacks,
  type SocketManagerConfig,
} from '../src/SocketManager.js';
import type { PlayerAbsentEvent } from '../src/types.js';

type SocketListener = (data: unknown) => void;

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  listeners: (event: string) => SocketListener[];
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, SocketListener[]>();

  return {
    on: vi.fn((event: string, handler: SocketListener) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    listeners: (event: string) => handlers.get(event)?.slice() ?? [],
    off: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

const baseConfig: SocketManagerConfig = {
  serverUrl: 'http://localhost:9999',
  playerId: 'absent-test-player',
  username: 'AbsentTest',
  connectionTimeoutMs: 1000,
  recoverRoomTimeoutMs: 1000,
  socketTransports: ['websocket'],
  autoReconnect: false,
  maxReconnectAttempts: 0,
  reconnectDelayMs: 100,
  debug: false,
};

function createSocketManager(callbacks: Partial<SocketManagerCallbacks>): {
  manager: SocketManager;
  mockSocket: MockSocket;
} {
  const mockSocket = createMockSocket();

  const manager = new SocketManager(baseConfig, {
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
    onPlayerAbsent: vi.fn(),
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
    ...callbacks,
  });

  attach(manager, mockSocket);
  return { manager, mockSocket };
}

/**
 * `socket` and `setupEventHandlers` are private. Tests install a mock
 * the same way the recovery tests do, then run the registration that
 * `connect()` would run.
 */
function attach(manager: SocketManager, socket: MockSocket): void {
  // The real field is a socket.io Socket. The mock only implements the
  // listener surface these tests call.
  const internal = manager as unknown as {
    socket: MockSocket;
    setupEventHandlers: () => void;
  };
  internal.socket = socket;
  internal.setupEventHandlers();
}

const ABSENT: PlayerAbsentEvent = {
  playerId: 'player-2',
  deadlineMs: 30_000,
  budgetLeftMs: 90_000,
};

describe('player-absent', () => {
  it('forwards the socket payload to onPlayerAbsent', () => {
    const onPlayerAbsent = vi.fn();
    const { mockSocket } = createSocketManager({ onPlayerAbsent });

    const handler = mockSocket.listeners('player-absent')[0];
    expect(handler).toBeDefined();
    handler?.(ABSENT);

    expect(onPlayerAbsent).toHaveBeenCalledTimes(1);
    expect(onPlayerAbsent).toHaveBeenCalledWith(ABSENT);
  });

  it('emits playerAbsent with milliseconds remaining', () => {
    const client = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'player-1',
      username: 'One',
    });
    const received: PlayerAbsentEvent[] = [];
    client.on('playerAbsent', (event) => {
      received.push(event);
    });

    // PhalanxClient keeps its SocketManager private. The mock is the
    // same listener surface attach() installs.
    const socketManager = (
      client as unknown as { socketManager: SocketManager }
    ).socketManager;
    const mockSocket = createMockSocket();
    attach(socketManager, mockSocket);

    mockSocket.listeners('player-absent')[0]?.(ABSENT);

    expect(received).toEqual([ABSENT]);
    client.disconnect();
  });
});
