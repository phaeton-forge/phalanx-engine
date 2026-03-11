import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';
import type { TickSyncEvent } from '../src/types/index.js';

const TEST_PORT = 3031;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

/**
 * LOCKSTEP-5: Server Detects Unresponsive Players via Activity Tracking
 *
 * Tests for activity tracking and timeout detection:
 * - Any message from client updates activity (via socket.onAny)
 * - Lagging players are detected based on time since last message
 * - Timed out players are detected and marked disconnected
 */
describe('LOCKSTEP-5: Server Detects Unresponsive Players via Activity Tracking', () => {
  let server: Phalanx;
  let socket1: Socket;
  let socket2: Socket;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      tickRate: 20,
      countdownSeconds: 0,
      timeoutTicks: 10, // 0.5 sec at 20 TPS - lagging threshold
      disconnectTicks: 40, // 2 sec at 20 TPS - disconnect threshold (more time between lag and disconnect)
      cors: { origin: '*' },
    });
    await server.start();

    socket1 = io(SERVER_URL, { forceNew: true });
    socket2 = io(SERVER_URL, { forceNew: true });

    await Promise.all([
      new Promise<void>((resolve) => socket1.on('connect', resolve)),
      new Promise<void>((resolve) => socket2.on('connect', resolve)),
    ]);

    // Join queue and wait for match
    const matchPromise = new Promise<void>((resolve) => {
      socket1.once('match-found', () => resolve());
    });

    socket1.emit('queue-join', { playerId: 'player1', username: 'Player1' });
    socket2.emit('queue-join', { playerId: 'player2', username: 'Player2' });

    await matchPromise;

    // Wait for game to start
    await new Promise<void>((resolve) => {
      socket1.once('game-start', () => resolve());
    });

    // Send client-ready from both clients to start tick loop
    socket1.emit('client-ready');
    socket2.emit('client-ready');

    // Wait a tick to ensure game is running
    await new Promise<void>((resolve) => {
      socket1.once('tick-sync', () => resolve());
    });
  });

  afterEach(async () => {
    socket1?.disconnect();
    socket2?.disconnect();
    await server?.stop();
  });

  it('should track activity when commands are submitted', async () => {
    // Submit commands to update activity
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    socket1.emit('submit-commands', {
      tick: currentTick + 1,
      commands: [{ type: 'move', data: {} }],
    });

    // Wait for ack - if accepted, activity was tracked
    const ack = await new Promise<{ accepted: boolean }>((resolve) => {
      socket1.once('submit-commands-ack', resolve);
    });

    expect(ack.accepted).toBe(true);
  });

  it('should track activity on any message (not just commands)', async () => {
    // Any message should update activity - we use a custom ping event
    socket1.emit('ping-test', { timestamp: Date.now() });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Player 1 should not be lagging since they just sent a message
    // We verify by checking that no lagging event is received for player1
    let player1Lagging = false;
    socket1.on(
      'player-lagging',
      (data: { playerId: string; msSinceLastMessage: number }) => {
        if (data.playerId === 'player1') {
          player1Lagging = true;
        }
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(player1Lagging).toBe(false);
  });

  it('should emit player-lagging when player has no activity', async () => {
    // Setup listener BEFORE player stops sending messages
    const laggingPromise = new Promise<{
      playerId: string;
      msSinceLastMessage: number;
    }>((resolve) => {
      socket1.on(
        'player-lagging',
        (data: { playerId: string; msSinceLastMessage: number }) => {
          if (data.playerId === 'player2') {
            resolve(data);
          }
        }
      );
    });

    // Keep player 1 active by sending any message
    const keepAlive = setInterval(() => {
      socket1.emit('heartbeat', { t: Date.now() });
    }, 100);

    // Wait for player 2 to be detected as lagging (timeout after 3 sec)
    const lagging = await Promise.race([
      laggingPromise,
      new Promise<null>((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout waiting for player-lagging')),
          3000
        )
      ),
    ]);
    clearInterval(keepAlive);

    expect(lagging).not.toBeNull();
    expect(lagging!.playerId).toBe('player2');
    expect(lagging!.msSinceLastMessage).toBeGreaterThanOrEqual(400); // ~0.5 sec
  }, 10000);

  it('should emit player-timeout when player has no activity for disconnect threshold', async () => {
    const timeoutPromise = new Promise<{
      playerId: string;
      msSinceLastMessage: number;
    }>((resolve) => {
      socket1.on(
        'player-timeout',
        (data: { playerId: string; msSinceLastMessage: number }) => {
          if (data.playerId === 'player2') {
            resolve(data);
          }
        }
      );
    });

    // Keep player 1 active
    const keepAlive = setInterval(() => {
      socket1.emit('heartbeat', { t: Date.now() });
    }, 100);

    // Wait for player 2 to timeout
    const timeout = await timeoutPromise;
    clearInterval(keepAlive);

    expect(timeout.playerId).toBe('player2');
    expect(timeout.msSinceLastMessage).toBeGreaterThanOrEqual(1800); // ~2 sec (disconnectTicks=40)
  });

  it('should not emit player-lagging for active players', async () => {
    let laggingReceived = false;

    socket1.on(
      'player-lagging',
      (data: { playerId: string; msSinceLastMessage: number }) => {
        if (data.playerId === 'player1') {
          laggingReceived = true;
        }
      }
    );

    // Both players stay active by sending messages
    const keepAlive1 = setInterval(() => {
      socket1.emit('heartbeat', { t: Date.now() });
    }, 100);
    const keepAlive2 = setInterval(() => {
      socket2.emit('heartbeat', { t: Date.now() });
    }, 100);

    // Wait longer than timeout period
    await new Promise((resolve) => setTimeout(resolve, 800));

    clearInterval(keepAlive1);
    clearInterval(keepAlive2);

    expect(laggingReceived).toBe(false);
  });
});
