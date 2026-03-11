import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';
import type {
  MatchFoundEvent,
  TickSyncEvent,
  CommandsBatchEvent,
} from '../src/types/index.js';

const TEST_PORT = 3027;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

/**
 * LOCKSTEP-2: Server Collects Commands from All Players for Each Tick
 *
 * Tests for command buffer system:
 * - Commands are buffered by tick number
 * - Server tracks which players submitted for each tick
 * - Commands can arrive out-of-order (tick 2 before tick 1)
 * - Players can submit empty command arrays (no actions for this tick)
 * - Duplicate tick submissions are handled
 */
describe('LOCKSTEP-2: Server Collects Commands from All Players for Each Tick', () => {
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

  it('should accept submit-commands with tick and commands array', async () => {
    const ackPromise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 5,
      commands: [{ type: 'move', data: { unitId: 1, x: 10, y: 20 } }],
    });

    const ack = await ackPromise;
    expect(ack.tick).toBe(5);
    expect(ack.accepted).toBe(true);
  });

  it('should accept empty command arrays (no actions for this tick)', async () => {
    const ackPromise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );

    // Player has no commands for this tick (e.g., unit is moving)
    socket1.emit('submit-commands', {
      tick: 5,
      commands: [],
    });

    const ack = await ackPromise;
    expect(ack.tick).toBe(5);
    expect(ack.accepted).toBe(true);
  });

  it('should accept commands from both players for the same tick', async () => {
    const ack1Promise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );
    const ack2Promise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket2.once('submit-commands-ack', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 5,
      commands: [{ type: 'attack', data: { targetId: 2 } }],
    });
    socket2.emit('submit-commands', {
      tick: 5,
      commands: [{ type: 'defend', data: {} }],
    });

    const [ack1, ack2] = await Promise.all([ack1Promise, ack2Promise]);
    expect(ack1.accepted).toBe(true);
    expect(ack2.accepted).toBe(true);
  });

  it('should handle out-of-order tick submissions (tick 2 before tick 1)', async () => {
    // Wait for a tick-sync to know the current tick
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    const tick1 = currentTick + 1;
    const tick2 = currentTick + 2;

    const ackPromises: Promise<{ tick: number; accepted: boolean }>[] = [];

    ackPromises.push(
      new Promise<{ tick: number; accepted: boolean }>((resolve) => {
        socket1.on(
          'submit-commands-ack',
          (ack: { tick: number; accepted: boolean }) => {
            if (ack.tick === tick2) resolve(ack);
          }
        );
      })
    );
    ackPromises.push(
      new Promise<{ tick: number; accepted: boolean }>((resolve) => {
        socket1.on(
          'submit-commands-ack',
          (ack: { tick: number; accepted: boolean }) => {
            if (ack.tick === tick1) resolve(ack);
          }
        );
      })
    );

    // Submit tick2 first (out of order)
    socket1.emit('submit-commands', {
      tick: tick2,
      commands: [{ type: 'move', data: {} }],
    });

    // Then submit tick1
    socket1.emit('submit-commands', {
      tick: tick1,
      commands: [{ type: 'build', data: {} }],
    });

    const [ackTick2, ackTick1] = await Promise.all(ackPromises);
    expect(ackTick2.accepted).toBe(true);
    expect(ackTick1.accepted).toBe(true);
  });

  it('should handle duplicate tick submission from same player (overwrite)', async () => {
    const ack1Promise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once(
          'submit-commands-ack',
          (ack: { tick: number; accepted: boolean }) => resolve(ack)
        );
      }
    );

    socket1.emit('submit-commands', {
      tick: 5,
      commands: [{ type: 'move', data: { x: 1 } }],
    });

    await ack1Promise;

    // Second submission for same tick should also be accepted (overwrite)
    const ack2Promise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once(
          'submit-commands-ack',
          (ack: { tick: number; accepted: boolean }) => resolve(ack)
        );
      }
    );

    socket1.emit('submit-commands', {
      tick: 5,
      commands: [{ type: 'move', data: { x: 2 } }],
    });

    const ack2 = await ack2Promise;
    expect(ack2.tick).toBe(5);
    expect(ack2.accepted).toBe(true);
  });

  it('should reject commands for ticks too far in the future', async () => {
    const ackPromise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );

    // Submit for tick 1000, way ahead of current tick
    socket1.emit('submit-commands', {
      tick: 1000,
      commands: [{ type: 'move', data: {} }],
    });

    const ack = await ackPromise;
    expect(ack.accepted).toBe(false);
  });

  it('should broadcast commands in commands-batch event', async () => {
    // Wait for a tick-sync to know the current tick
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    // Submit command for a near-future tick
    const targetTick = currentTick + 2;

    socket1.emit('submit-commands', {
      tick: targetTick,
      commands: [{ type: 'test-command', data: { value: 42 } }],
    });

    // Wait for the commands-batch for that tick
    const batch = await new Promise<{ tick: number; commands: unknown[] }>(
      (resolve) => {
        socket1.on('commands-batch', (data: CommandsBatchEvent) => {
          if (data.tick === targetTick) resolve(data);
        });
      }
    );

    expect(batch.tick).toBe(targetTick);
    expect(batch.commands.length).toBeGreaterThanOrEqual(1);
  });

  it('should include player commands in commands-batch even if one player sends no commands', async () => {
    // Wait for a tick-sync to know the current tick
    const currentTick = await new Promise<number>((resolve) => {
      socket1.once('tick-sync', (data: TickSyncEvent) => resolve(data.tick));
    });

    const targetTick = currentTick + 2;

    // Only player1 submits commands
    socket1.emit('submit-commands', {
      tick: targetTick,
      commands: [{ type: 'solo-command', data: {} }],
    });

    // Player2 doesn't submit anything - this is valid (e.g., unit is auto-moving)

    // Wait for the commands-batch for that tick
    const batch = await new Promise<{ tick: number; commands: unknown[] }>(
      (resolve) => {
        socket1.on('commands-batch', (data: CommandsBatchEvent) => {
          if (data.tick === targetTick) resolve(data);
        });
      }
    );

    expect(batch.tick).toBe(targetTick);
    // Should have player1's command
    expect(batch.commands.length).toBeGreaterThanOrEqual(1);
  });
});
