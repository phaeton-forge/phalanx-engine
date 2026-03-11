import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';

const TEST_PORT = 3030;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

/**
 * NET-1: Server Validates Incoming Player Commands
 *
 * Tests for command validation:
 * - Commands with missing fields are rejected
 * - Commands for invalid tick ranges are rejected
 * - Valid commands are accepted
 */
describe('NET-1: Server Validates Incoming Player Commands', () => {
  let server: Phalanx;
  let socket1: Socket;
  let socket2: Socket;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      tickRate: 20,
      countdownSeconds: 0,
      maxTickBehind: 10,
      maxTickAhead: 5,
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
    const matchPromise = new Promise<void>((resolve) => {
      socket1.once('match-found', () => resolve());
    });

    socket1.emit('queue-join', { playerId: 'player1', username: 'Player1' });
    socket2.emit('queue-join', { playerId: 'player2', username: 'Player2' });

    await matchPromise;

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

  it('should accept valid commands with type and data', async () => {
    const ackPromise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 3,
      commands: [{ type: 'move', data: { x: 10, y: 20 } }],
    });

    const ack = await ackPromise;
    expect(ack.accepted).toBe(true);
  });

  it('should reject commands with missing type field', async () => {
    const rejectedPromise = new Promise<{ reason: string; tick: number }>(
      (resolve) => {
        socket1.once('command-rejected', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 3,
      commands: [{ data: { x: 10 } }], // missing type
    });

    const rejected = await rejectedPromise;
    expect(rejected.reason).toContain('Missing required fields');
  });

  it('should reject commands with missing data field', async () => {
    const rejectedPromise = new Promise<{ reason: string; tick: number }>(
      (resolve) => {
        socket1.once('command-rejected', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 3,
      commands: [{ type: 'move' }], // missing data
    });

    const rejected = await rejectedPromise;
    expect(rejected.reason).toContain('Missing required fields');
  });

  it('should reject commands for ticks too far in the future', async () => {
    const ackPromise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );

    // Submit for tick 1000 - way beyond maxTickAhead
    socket1.emit('submit-commands', {
      tick: 1000,
      commands: [{ type: 'move', data: {} }],
    });

    const ack = await ackPromise;
    expect(ack.accepted).toBe(false);
  });

  it('should accept commands with data set to null (valid empty payload)', async () => {
    const ackPromise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 3,
      commands: [{ type: 'stop', data: null }],
    });

    const ack = await ackPromise;
    expect(ack.accepted).toBe(true);
  });

  it('should accept empty commands array (player idle)', async () => {
    const ackPromise = new Promise<{ tick: number; accepted: boolean }>(
      (resolve) => {
        socket1.once('submit-commands-ack', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 3,
      commands: [],
    });

    const ack = await ackPromise;
    expect(ack.accepted).toBe(true);
  });
});
