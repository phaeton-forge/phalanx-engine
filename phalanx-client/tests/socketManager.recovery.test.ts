import { describe, it, expect, vi } from 'vitest';
import { DeterministicRandom } from '../src/DeterministicRandom.js';
import { PhalanxClient } from '../src/PhalanxClient.js';
import {
  SocketManager,
  type SocketManagerCallbacks,
  type SocketManagerConfig,
} from '../src/SocketManager.js';
import type { GameStartEvent, ReconnectStateEvent } from '../src/types.js';

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
  playerId: 'recovery-test-player',
  username: 'RecoveryTest',
  connectionTimeoutMs: 1000,
  recoverRoomTimeoutMs: 1000,
  socketTransports: ['websocket'],
  autoReconnect: false,
  maxReconnectAttempts: 0,
  reconnectDelayMs: 100,
  debug: false,
};

function createSocketManager(
  callbacks: Partial<SocketManagerCallbacks>
): { manager: SocketManager; mockSocket: MockSocket } {
  const mockSocket = createMockSocket();
  const onGameStart = vi.fn();

  const manager = new SocketManager(baseConfig, {
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onReconnecting: vi.fn(),
    onReconnectFailed: vi.fn(),
    onError: vi.fn(),
    onMatchFound: vi.fn(),
    onCountdown: vi.fn(),
    onGameStart,
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
    ...callbacks,
  });

  (
    manager as unknown as { socket: MockSocket; setupEventHandlers: () => void }
  ).socket = mockSocket;
  (
    manager as unknown as { socket: MockSocket; setupEventHandlers: () => void }
  ).setupEventHandlers();

  return { manager, mockSocket };
}

describe('SocketManager reconnect recovery', () => {
  it('replays synthetic game-start from reconnect-state before play begins', () => {
    const onGameStart = vi.fn();
    const { mockSocket } = createSocketManager({ onGameStart });

    const reconnectHandler = mockSocket.listeners('reconnect-state')[0];
    expect(reconnectHandler).toBeDefined();

    const snapshot: ReconnectStateEvent = {
      matchId: 'match-recovery',
      currentTick: 0,
      state: 'waiting-for-ready',
      recentCommands: [],
      gameStartEmitted: true,
      randomSeed: 5150,
    };

    reconnectHandler(snapshot);

    expect(onGameStart).toHaveBeenCalledTimes(1);
    expect(onGameStart).toHaveBeenCalledWith({
      matchId: 'match-recovery',
      randomSeed: 5150,
    } satisfies GameStartEvent);
  });

  it('initializes PhalanxClient RNG when recovery replays game-start', () => {
    const client = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'recovery-client',
      username: 'RecoveryClient',
    });

    const socketManager = (
      client as unknown as { socketManager: SocketManager }
    ).socketManager;
    const mockSocket = createMockSocket();
    (
      socketManager as unknown as {
        socket: MockSocket;
        setupEventHandlers: () => void;
      }
    ).socket = mockSocket;
    (
      socketManager as unknown as {
        socket: MockSocket;
        setupEventHandlers: () => void;
      }
    ).setupEventHandlers();

    const reconnectHandler = mockSocket.listeners('reconnect-state')[0];
    reconnectHandler({
      matchId: 'match-recovery-client',
      currentTick: 0,
      state: 'countdown',
      recentCommands: [],
      gameStartEmitted: true,
      randomSeed: 8080,
    } satisfies ReconnectStateEvent);

    expect(client.randomSeed).toBe(8080);
    expect(client.random.intRange(1, 100)).toBe(
      new DeterministicRandom(8080).intRange(1, 100)
    );

    client.disconnect();
  });
});
