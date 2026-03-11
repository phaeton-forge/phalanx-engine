import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx, PlayerCommand } from '../src/index.js';
import type {
  MatchFoundEvent,
  CommandsBatchEvent,
  TickSyncEvent,
} from '../src/types/index.js';

const TEST_PORT = 3029;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

/**
 * LOCKSTEP-3: Server Broadcasts Tick Commands on Timer
 *
 * Tests for tick-driven command broadcasting:
 * - Server advances ticks based on tick rate
 * - Commands are broadcast on each tick
 * - Server does NOT wait for players to submit
 * - Commands are sorted by playerId for deterministic order
 * - Empty command batches are valid
 */
describe('LOCKSTEP-3: Server Broadcasts Tick Commands on Timer', () => {
  let server: Phalanx;
  let socket1: Socket;
  let socket2: Socket;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      tickRate: 20,
      countdownSeconds: 0, // No countdown for faster tests
      cors: { origin: '*' },
    });
    await server.start();

    // Connect both sockets
    socket1 = io(SERVER_URL, { forceNew: true });
    socket2 = io(SERVER_URL, { forceNew: true });

    await Promise.all([
      new Promise<void>((resolve) => socket1.on('connect', resolve)),
      new Promise<void>((resolve) => socket2.on('connect', resolve)),
    ]);

    // Join queue and wait for match
    const matchPromise = new Promise<string>((resolve) => {
      socket1.once('match-found', (data: MatchFoundEvent) => {
        resolve(data.matchId);
      });
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

  it('should broadcast commands-batch on each tick', async () => {
    const batches: CommandsBatchEvent[] = [];

    socket1.on('commands-batch', (data: CommandsBatchEvent) => {
      batches.push(data);
    });

    // Wait for several ticks
    await new Promise((resolve) => setTimeout(resolve, 200));

    // At 20Hz we should have ~4 batches in 200ms
    expect(batches.length).toBeGreaterThanOrEqual(2);

    // Each batch should have tick and commands
    for (const batch of batches) {
      expect(batch).toHaveProperty('tick');
      expect(batch).toHaveProperty('commands');
      expect(Array.isArray(batch.commands)).toBe(true);
    }
  });

  it('should broadcast empty commands array if no player submitted', async () => {
    // Wait for a batch without submitting any commands
    const batch = await new Promise<{
      tick: number;
      commands: PlayerCommand[];
    }>((resolve) => {
      socket1.once('commands-batch', resolve);
    });

    expect(batch.commands).toEqual([]);
  });

  it('should include submitted commands in broadcast', async () => {
    // Wait for current tick
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    const targetTick = currentTick + 2;

    // Submit a command
    socket1.emit('submit-commands', {
      tick: targetTick,
      commands: [{ type: 'test-action', data: { value: 123 } }],
    });

    // Wait for that tick's batch
    const batch = await new Promise<{
      tick: number;
      commands: PlayerCommand[];
    }>((resolve) => {
      socket1.on('commands-batch', (data: CommandsBatchEvent) => {
        if (data.tick === targetTick) resolve(data);
      });
    });

    expect(batch.commands.length).toBe(1);
    expect(batch.commands[0].type).toBe('test-action');
  });

  it('should not wait for all players - ticks advance on timer', async () => {
    const ticks: number[] = [];

    socket1.on('tick-sync', (data: TickSyncEvent) => {
      ticks.push(data.tick);
    });

    // Neither player submits anything
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Ticks should still advance at 20Hz (~6 ticks in 300ms)
    expect(ticks.length).toBeGreaterThanOrEqual(4);

    // Verify ticks are sequential
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBe(ticks[i - 1] + 1);
    }
  });

  it('should sort commands by playerId for deterministic order', async () => {
    // Wait for current tick
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    const targetTick = currentTick + 3;

    // Player2 submits first (but should appear second after sorting)
    socket2.emit('submit-commands', {
      tick: targetTick,
      commands: [{ type: 'player2-action', data: {} }],
    });

    // Small delay then Player1 submits
    await new Promise((resolve) => setTimeout(resolve, 10));
    socket1.emit('submit-commands', {
      tick: targetTick,
      commands: [{ type: 'player1-action', data: {} }],
    });

    // Wait for that tick's batch
    const batch = await new Promise<{
      tick: number;
      commands: PlayerCommand[];
    }>((resolve) => {
      socket1.on('commands-batch', (data: CommandsBatchEvent) => {
        if (data.tick === targetTick) resolve(data);
      });
    });

    expect(batch.commands.length).toBe(2);
    // Commands should be sorted by playerId: player1 before player2
    expect(batch.commands[0].playerId).toBe('player1');
    expect(batch.commands[1].playerId).toBe('player2');
  });

  it('should broadcast same batch to all players', async () => {
    // Wait for current tick
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    const targetTick = currentTick + 2;

    // Submit command
    socket1.emit('submit-commands', {
      tick: targetTick,
      commands: [{ type: 'shared-command', data: { x: 1 } }],
    });

    // Wait for batch on both sockets
    const [batch1, batch2] = await Promise.all([
      new Promise<{ tick: number; commands: PlayerCommand[] }>((resolve) => {
        socket1.on('commands-batch', (data: CommandsBatchEvent) => {
          if (data.tick === targetTick) resolve(data);
        });
      }),
      new Promise<{ tick: number; commands: PlayerCommand[] }>((resolve) => {
        socket2.on('commands-batch', (data: CommandsBatchEvent) => {
          if (data.tick === targetTick) resolve(data);
        });
      }),
    ]);

    // Both should receive identical data
    expect(batch1.tick).toBe(batch2.tick);
    expect(batch1.commands.length).toBe(batch2.commands.length);
    expect(batch1.commands[0].type).toBe(batch2.commands[0].type);
  });

  it('should handle player submitting commands while other player is idle (RTS scenario)', async () => {
    // Wait for current tick
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    const targetTick = currentTick + 2;

    // Only player1 submits (player2 is watching units move - valid RTS scenario)
    socket1.emit('submit-commands', {
      tick: targetTick,
      commands: [{ type: 'attack', data: { targetId: 'enemy1' } }],
    });

    // Wait for that tick's batch
    const batch = await new Promise<{
      tick: number;
      commands: PlayerCommand[];
    }>((resolve) => {
      socket2.on('commands-batch', (data: CommandsBatchEvent) => {
        if (data.tick === targetTick) resolve(data);
      });
    });

    // Player2 receives player1's command even though they didn't submit anything
    expect(batch.commands.length).toBe(1);
    expect(batch.commands[0].playerId).toBe('player1');
  });
});
