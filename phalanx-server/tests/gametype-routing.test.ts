import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';
import type { MatchFoundEvent, QueueStatusEvent } from '../src/types/index.js';

// ============================================================
// Test 1: Per-gameType queue isolation
// ============================================================

describe('Per-gameType queue isolation', () => {
  const TEST_PORT = 3410;
  const SERVER_URL = `http://localhost:${TEST_PORT}`;
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      countdownSeconds: 0,
      matchmakingIntervalMs: 200,
      gameMode: '1v1',
      gameTypes: [
        { gameType: 'ranked', tickMode: 'continuous' },
        { gameType: 'casual', tickMode: 'continuous' },
      ],
    });
    await server.start();
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.connected && c.disconnect();
    clients = [];
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.stop();
  });

  function createClient(): Socket {
    const c = io(SERVER_URL, { autoConnect: false, forceNew: true });
    clients.push(c);
    return c;
  }

  async function connect(c: Socket): Promise<void> {
    return new Promise((resolve) => {
      c.on('connect', () => resolve());
      c.connect();
    });
  }

  it('should not match players in different gameType queues', async () => {
    const c1 = createClient();
    const c2 = createClient();
    const c3 = createClient();
    const c4 = createClient();
    await Promise.all([connect(c1), connect(c2), connect(c3), connect(c4)]);

    // c1 & c2 join 'ranked', c3 & c4 join 'casual'
    const matchPromises = [c1, c2, c3, c4].map(
      (c) =>
        new Promise<MatchFoundEvent>((resolve) => {
          c.once('match-found', (data: MatchFoundEvent) => resolve(data));
        })
    );

    c1.emit('queue-join', { playerId: 'p1', username: 'P1', gameType: 'ranked' });
    c2.emit('queue-join', { playerId: 'p2', username: 'P2', gameType: 'ranked' });
    c3.emit('queue-join', { playerId: 'p3', username: 'P3', gameType: 'casual' });
    c4.emit('queue-join', { playerId: 'p4', username: 'P4', gameType: 'casual' });

    const matches = await Promise.all(matchPromises);

    // ranked players (p1, p2) should share the same matchId
    expect(matches[0].matchId).toBe(matches[1].matchId);
    // casual players (p3, p4) should share a different matchId
    expect(matches[2].matchId).toBe(matches[3].matchId);
    // ranked and casual matches should differ
    expect(matches[0].matchId).not.toBe(matches[2].matchId);
  });

  it('should fall back to default queue for unknown gameType', async () => {
    const c1 = createClient();
    const c2 = createClient();
    await Promise.all([connect(c1), connect(c2)]);

    const matchPromises = [c1, c2].map(
      (c) =>
        new Promise<MatchFoundEvent>((resolve) => {
          c.once('match-found', (data: MatchFoundEvent) => resolve(data));
        })
    );

    // 'bogus' is not configured, both should fall back to 'default'
    c1.emit('queue-join', { playerId: 'p1', username: 'P1', gameType: 'bogus' });
    c2.emit('queue-join', { playerId: 'p2', username: 'P2', gameType: 'bogus' });

    const matches = await Promise.all(matchPromises);
    expect(matches[0].matchId).toBe(matches[1].matchId);
  });
});

// ============================================================
// Test 2: Event-mode immediate commands-batch broadcast
// ============================================================

describe('Event-mode immediate commands-batch broadcast', () => {
  const TEST_PORT = 3411;
  const SERVER_URL = `http://localhost:${TEST_PORT}`;
  let server: Phalanx;
  let socket1: Socket;
  let socket2: Socket;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      countdownSeconds: 0,
      tickMode: 'event',
      turnTimeoutMs: 10000,
      matchmakingIntervalMs: 200,
      gameMode: '1v1',
    });
    await server.start();

    socket1 = io(SERVER_URL, { forceNew: true });
    socket2 = io(SERVER_URL, { forceNew: true });

    await Promise.all([
      new Promise<void>((resolve) => socket1.on('connect', resolve)),
      new Promise<void>((resolve) => socket2.on('connect', resolve)),
    ]);

    // Wait for match-found + game-start + client-ready
    const gameStartP = Promise.all([
      new Promise<void>((resolve) => socket1.once('game-start', () => resolve())),
      new Promise<void>((resolve) => socket2.once('game-start', () => resolve())),
    ]);

    await new Promise<void>((resolve) => {
      socket1.once('match-found', () => resolve());
      socket1.emit('queue-join', { playerId: 'p1', username: 'P1' });
      socket2.emit('queue-join', { playerId: 'p2', username: 'P2' });
    });

    await gameStartP;

    socket1.emit('client-ready');
    socket2.emit('client-ready');

    // Small delay for the server to transition to 'playing'
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    socket1?.disconnect();
    socket2?.disconnect();
    await server?.stop();
  });

  it('should emit commands-batch immediately on submit-commands (no tick-sync)', async () => {
    // In event mode there should be NO tick-sync events
    let tickSyncReceived = false;
    socket1.on('tick-sync', () => {
      tickSyncReceived = true;
    });

    const batchPromise = new Promise<{ tick: number; commands: unknown[] }>(
      (resolve) => {
        socket1.once('commands-batch', resolve);
      }
    );

    socket1.emit('submit-commands', {
      tick: 0,
      commands: [{ type: 'move', data: { x: 5 } }],
    });

    const batch = await batchPromise;
    expect(batch.tick).toBeGreaterThanOrEqual(0);
    expect(batch.commands.length).toBeGreaterThanOrEqual(1);

    // Give a moment to make sure no tick-sync arrives
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(tickSyncReceived).toBe(false);
  });
});

// ============================================================
// Test 3: Turn timeout ends match in event mode
// ============================================================

describe('Event-mode turnTimeoutMs ends match', () => {
  const TEST_PORT = 3412;
  const SERVER_URL = `http://localhost:${TEST_PORT}`;
  let server: Phalanx;
  let socket1: Socket;
  let socket2: Socket;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      countdownSeconds: 0,
      tickMode: 'event',
      turnTimeoutMs: 500, // short timeout for testing
      matchmakingIntervalMs: 200,
      gameMode: '1v1',
    });
    await server.start();

    socket1 = io(SERVER_URL, { forceNew: true });
    socket2 = io(SERVER_URL, { forceNew: true });

    await Promise.all([
      new Promise<void>((resolve) => socket1.on('connect', resolve)),
      new Promise<void>((resolve) => socket2.on('connect', resolve)),
    ]);

    const gameStartP = Promise.all([
      new Promise<void>((resolve) => socket1.once('game-start', () => resolve())),
      new Promise<void>((resolve) => socket2.once('game-start', () => resolve())),
    ]);

    await new Promise<void>((resolve) => {
      socket1.once('match-found', () => resolve());
      socket1.emit('queue-join', { playerId: 'p1', username: 'P1' });
      socket2.emit('queue-join', { playerId: 'p2', username: 'P2' });
    });

    await gameStartP;

    socket1.emit('client-ready');
    socket2.emit('client-ready');

    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    socket1?.disconnect();
    socket2?.disconnect();
    await server?.stop();
  });

  it('should end match with reason turn-timeout after turnTimeoutMs elapses', async () => {
    const endPromise = new Promise<{ reason: string }>((resolve) => {
      socket1.once('match-end', resolve);
    });

    // Don't send any commands — let the timeout fire
    const result = await endPromise;
    expect(result.reason).toBe('turn-timeout');
  }, 5000);
});
