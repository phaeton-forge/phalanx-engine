import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx, PlayerCommand } from '../src/index.js';
import type { MatchFoundEvent, TickSyncEvent } from '../src/types/index.js';

const TEST_PORT = 3032;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

/**
 * NET-2: Server Handles Player Reconnection
 *
 * Tests for reconnection:
 * - Disconnected player can reconnect
 * - Reconnecting player receives reconnect-state with command history
 * - Other players are notified of reconnection
 */
describe('NET-2: Server Handles Player Reconnection', () => {
  let server: Phalanx;
  let socket1: Socket;
  let socket2: Socket;
  let matchId: string;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      tickRate: 20,
      countdownSeconds: 0,
      reconnectGracePeriodMs: 30000,
      commandHistoryTicks: 100,
      cors: { origin: '*' },
    });
    await server.start();

    socket1 = io(SERVER_URL, { forceNew: true });
    socket2 = io(SERVER_URL, { forceNew: true });

    await Promise.all([
      new Promise<void>((resolve) => socket1.on('connect', resolve)),
      new Promise<void>((resolve) => socket2.on('connect', resolve)),
    ]);

    // Set up game-start listeners before joining queue (with countdownSeconds: 0, game-start fires immediately)
    const gameStartPromise = Promise.all([
      new Promise<void>((resolve) => { socket1.once('game-start', () => resolve()); }),
      new Promise<void>((resolve) => { socket2.once('game-start', () => resolve()); }),
    ]);

    // Join queue and wait for match
    const matchPromise = new Promise<string>((resolve) => {
      socket1.once('match-found', (data: MatchFoundEvent) => {
        matchId = data.matchId;
        resolve(data.matchId);
      });
    });

    socket1.emit('queue-join', { playerId: 'player1', username: 'Player1' });
    socket2.emit('queue-join', { playerId: 'player2', username: 'Player2' });

    matchId = await matchPromise;

    // Wait for game to start on both sockets
    await gameStartPromise;

    // Send client-ready from both clients to start tick loop
    socket1.emit('client-ready');
    socket2.emit('client-ready');

    // Wait a tick
    await new Promise<void>((resolve) => {
      socket1.once('tick-sync', () => resolve());
    });
  });

  afterEach(async () => {
    socket1?.disconnect();
    socket2?.disconnect();
    await server?.stop();
  });

  it('should notify other players when a player disconnects', async () => {
    const disconnectPromise = new Promise<{
      playerId: string;
      gracePeriodMs: number;
    }>((resolve) => {
      socket1.once('player-disconnected', resolve);
    });

    // Player 2 disconnects
    socket2.disconnect();

    const disconnectEvent = await disconnectPromise;
    expect(disconnectEvent.playerId).toBe('player2');
    expect(disconnectEvent.gracePeriodMs).toBe(30000);
  });

  it('should allow disconnected player to reconnect', async () => {
    // Player 2 disconnects
    socket2.disconnect();

    // Wait for disconnect to be processed
    await new Promise<void>((resolve) => {
      socket1.once('player-disconnected', () => resolve());
    });

    // Player 2 reconnects with new socket
    const newSocket = io(SERVER_URL, { forceNew: true });
    await new Promise<void>((resolve) => newSocket.on('connect', resolve));

    const reconnectPromise = new Promise<{ success: boolean }>((resolve) => {
      newSocket.once('reconnect-status', resolve);
    });

    newSocket.emit('reconnect-match', { playerId: 'player2', matchId });

    const status = await reconnectPromise;
    expect(status.success).toBe(true);

    newSocket.disconnect();
  });

  it('should send reconnect-state with current tick and command history', async () => {
    // Submit some commands first
    socket1.emit('submit-commands', {
      tick: 3,
      commands: [{ type: 'move', data: { x: 10 } }],
    });

    await new Promise((resolve) => setTimeout(resolve, 200)); // Let some ticks pass

    // Player 2 disconnects
    socket2.disconnect();

    await new Promise<void>((resolve) => {
      socket1.once('player-disconnected', () => resolve());
    });

    // Player 2 reconnects
    const newSocket = io(SERVER_URL, { forceNew: true });
    await new Promise<void>((resolve) => newSocket.on('connect', resolve));

    const statePromise = new Promise<{
      matchId: string;
      currentTick: number;
      state: string;
      recentCommands: { tick: number; commands: PlayerCommand[] }[];
    }>((resolve) => {
      newSocket.once('reconnect-state', resolve);
    });

    newSocket.emit('reconnect-match', { playerId: 'player2', matchId });

    const state = await statePromise;
    expect(state.matchId).toBe(matchId);
    expect(state.currentTick).toBeGreaterThan(0);
    expect(state.state).toBe('playing');
    expect(Array.isArray(state.recentCommands)).toBe(true);

    newSocket.disconnect();
  });

  it('should notify other players when player reconnects', async () => {
    // Player 2 disconnects
    socket2.disconnect();

    await new Promise<void>((resolve) => {
      socket1.once('player-disconnected', () => resolve());
    });

    // Player 2 reconnects
    const newSocket = io(SERVER_URL, { forceNew: true });
    await new Promise<void>((resolve) => newSocket.on('connect', resolve));

    const reconnectedPromise = new Promise<{ playerId: string }>((resolve) => {
      socket1.once('player-reconnected', resolve);
    });

    newSocket.emit('reconnect-match', { playerId: 'player2', matchId });

    const reconnected = await reconnectedPromise;
    expect(reconnected.playerId).toBe('player2');

    newSocket.disconnect();
  });

  it('should reject reconnection with wrong matchId', async () => {
    // Player 2 disconnects
    socket2.disconnect();

    await new Promise<void>((resolve) => {
      socket1.once('player-disconnected', () => resolve());
    });

    // Try to reconnect with wrong matchId
    const newSocket = io(SERVER_URL, { forceNew: true });
    await new Promise<void>((resolve) => newSocket.on('connect', resolve));

    const reconnectPromise = new Promise<{ success: boolean; reason?: string }>(
      (resolve) => {
        newSocket.once('reconnect-status', resolve);
      }
    );

    newSocket.emit('reconnect-match', {
      playerId: 'player2',
      matchId: 'wrong-match-id',
    });

    const status = await reconnectPromise;
    expect(status.success).toBe(false);
    expect(status.reason).toBe('Match not found');

    newSocket.disconnect();
  });

  it('should allow reconnected player to submit commands', async () => {
    // Player 2 disconnects
    socket2.disconnect();

    await new Promise<void>((resolve) => {
      socket1.once('player-disconnected', () => resolve());
    });

    // Player 2 reconnects
    const newSocket = io(SERVER_URL, { forceNew: true });
    await new Promise<void>((resolve) => newSocket.on('connect', resolve));

    await new Promise<void>((resolve) => {
      newSocket.once('reconnect-status', (data: { success: boolean }) => {
        if (data.success) resolve();
      });
      newSocket.emit('reconnect-match', { playerId: 'player2', matchId });
    });

    // Wait for a tick
    const currentTick = await new Promise<number>((resolve) => {
      newSocket.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    // Submit command with reconnected socket
    const ackPromise = new Promise<{ accepted: boolean }>((resolve) => {
      newSocket.once('submit-commands-ack', resolve);
    });

    newSocket.emit('submit-commands', {
      tick: currentTick + 1,
      commands: [{ type: 'attack', data: { targetId: 'enemy1' } }],
    });

    const ack = await ackPromise;
    expect(ack.accepted).toBe(true);

    newSocket.disconnect();
  });
});
