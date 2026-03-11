import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { TickSyncEvent, GameStartEvent } from '../src/types/index.js';

/**
 * Tests for Story 7 (LOCKSTEP-1): Server Initializes Tick Clock and Synchronizes All Clients
 */
describe('LOCKSTEP-1: Server Initializes Tick Clock and Synchronizes All Clients', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3344;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 1, // Short countdown for faster tests
      tickRate: 20, // 20 ticks per second (50ms per tick)
    });
    await server.start();
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.stop();
  });

  function createClient(): Socket {
    const client = io(`http://localhost:${TEST_PORT}`, {
      autoConnect: false,
      forceNew: true,
    });
    clients.push(client);
    return client;
  }

  async function connectClient(client: Socket): Promise<void> {
    return new Promise((resolve) => {
      client.on('connect', () => resolve());
      client.connect();
    });
  }

  async function waitForGameStart(client: Socket): Promise<GameStartEvent> {
    return new Promise((resolve) => {
      client.on('game-start', (data: GameStartEvent) => resolve(data));
    });
  }

  it('should initialize currentTick = 0 after game-start', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const gameStartPromise = waitForGameStart(client1);
    const firstTickPromise = new Promise<TickSyncEvent>((resolve) => {
      client1.on('tick-sync', (data: TickSyncEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await gameStartPromise;

    // Send client-ready from both clients to start tick loop
    client1.emit('client-ready');
    client2.emit('client-ready');

    const firstTick = await firstTickPromise;

    // First tick should be 0
    expect(firstTick.tick).toBe(0);
  });

  it('should broadcast tick-sync event every tick with tick and timestamp', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const tickEvents: TickSyncEvent[] = [];

    client1.on('tick-sync', (data: TickSyncEvent) => {
      tickEvents.push(data);
    });

    const gameStartPromise = waitForGameStart(client1);

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await gameStartPromise;
    client1.emit('client-ready');
    client2.emit('client-ready');

    // Wait for some ticks (~500ms = 10 ticks at 20 TPS)
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Should have received multiple tick events
    expect(tickEvents.length).toBeGreaterThanOrEqual(5);

    // Each tick event should have tick and timestamp
    for (const event of tickEvents) {
      expect(typeof event.tick).toBe('number');
      expect(typeof event.timestamp).toBe('number');
      expect(event.timestamp).toBeGreaterThan(0);
    }
  });

  it('should increment tick at configured rate (20 TPS = ~50ms per tick)', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const tickEvents: { tick: number; receivedAt: number }[] = [];

    client1.on('tick-sync', (data: TickSyncEvent) => {
      tickEvents.push({ tick: data.tick, receivedAt: Date.now() });
    });

    const gameStartPromise = waitForGameStart(client1);

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await gameStartPromise;
    client1.emit('client-ready');
    client2.emit('client-ready');

    // Wait for 1 second of ticks (20 ticks)
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Should have ~20 ticks in 1 second
    const ticksAfterFirst = tickEvents.filter(
      (e) => e.tick >= 1 && e.tick <= 20
    );
    expect(ticksAfterFirst.length).toBeGreaterThanOrEqual(15); // Allow some margin

    // Ticks should be sequential
    for (let i = 1; i < tickEvents.length; i++) {
      expect(tickEvents[i].tick).toBe(tickEvents[i - 1].tick + 1);
    }
  });

  it('should send tick-sync to all players in match room', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const tickEvents1: TickSyncEvent[] = [];
    const tickEvents2: TickSyncEvent[] = [];

    client1.on('tick-sync', (data: TickSyncEvent) => {
      tickEvents1.push(data);
    });
    client2.on('tick-sync', (data: TickSyncEvent) => {
      tickEvents2.push(data);
    });

    const gameStartPromise = waitForGameStart(client1);

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await gameStartPromise;
    client1.emit('client-ready');
    client2.emit('client-ready');

    // Wait for some ticks
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Both players should receive same ticks
    expect(tickEvents1.length).toBeGreaterThanOrEqual(5);
    expect(tickEvents2.length).toBeGreaterThanOrEqual(5);

    // Same tick numbers
    const ticks1 = tickEvents1.map((e) => e.tick);
    const ticks2 = tickEvents2.map((e) => e.tick);
    expect(ticks1).toEqual(ticks2);
  });

  it('should include server timestamp for latency calculation', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const gameStartPromise = waitForGameStart(client1);
    const tickPromise = new Promise<TickSyncEvent>((resolve) => {
      client1.once('tick-sync', (data: TickSyncEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await gameStartPromise;
    client1.emit('client-ready');
    client2.emit('client-ready');

    const tickEvent = await tickPromise;

    // Timestamp should be a valid Unix timestamp (close to now)
    const now = Date.now();
    expect(tickEvent.timestamp).toBeGreaterThan(now - 5000);
    expect(tickEvent.timestamp).toBeLessThanOrEqual(now + 1000);
  });

  it('should continue tick synchronization until match ends', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const tickEvents: TickSyncEvent[] = [];

    client1.on('tick-sync', (data: TickSyncEvent) => {
      tickEvents.push(data);
    });

    const gameStartPromise = waitForGameStart(client1);

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await gameStartPromise;
    client1.emit('client-ready');
    client2.emit('client-ready');

    // Wait for 2 seconds of gameplay
    await new Promise((resolve) => setTimeout(resolve, 2200));

    // Should have ~40 ticks in 2 seconds at 20 TPS
    expect(tickEvents.length).toBeGreaterThanOrEqual(30);

    // Last tick should be around 40
    const lastTick = tickEvents[tickEvents.length - 1].tick;
    expect(lastTick).toBeGreaterThanOrEqual(30);
  });
});

describe('LOCKSTEP-1: Independent Tick Counters Per Match', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3345;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 1,
      tickRate: 20,
    });
    await server.start();
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.stop();
  });

  function createClient(): Socket {
    const client = io(`http://localhost:${TEST_PORT}`, {
      autoConnect: false,
      forceNew: true,
    });
    clients.push(client);
    return client;
  }

  async function connectClient(client: Socket): Promise<void> {
    return new Promise((resolve) => {
      client.on('connect', () => resolve());
      client.connect();
    });
  }

  it('should have independent tick counters for different matches', async () => {
    // Create 4 clients for 2 separate matches
    const client1 = createClient();
    const client2 = createClient();
    const client3 = createClient();
    const client4 = createClient();

    await Promise.all([
      connectClient(client1),
      connectClient(client2),
      connectClient(client3),
      connectClient(client4),
    ]);

    const match1FirstTick = new Promise<TickSyncEvent>((resolve) => {
      client1.once('tick-sync', (data: TickSyncEvent) => resolve(data));
    });

    const match1GameStart = new Promise<void>((resolve) => {
      client1.once('game-start', () => resolve());
    });

    // Start first match
    client1.emit('queue-join', { playerId: 'p1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'p2', username: 'bob' });

    await match1GameStart;
    client1.emit('client-ready');
    client2.emit('client-ready');

    // Wait for first match to progress
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const match2FirstTick = new Promise<TickSyncEvent>((resolve) => {
      client3.once('tick-sync', (data: TickSyncEvent) => resolve(data));
    });

    const match2GameStart = new Promise<void>((resolve) => {
      client3.once('game-start', () => resolve());
    });

    // Start second match (delayed)
    client3.emit('queue-join', { playerId: 'p3', username: 'carol' });
    client4.emit('queue-join', { playerId: 'p4', username: 'dave' });

    await match2GameStart;
    client3.emit('client-ready');
    client4.emit('client-ready');

    const firstTickMatch1 = await match1FirstTick;
    const firstTickMatch2 = await match2FirstTick;

    // First match started earlier, so its tick counter should be ahead
    // But second match should start from tick 0
    expect(firstTickMatch1.tick).toBe(0);
    expect(firstTickMatch2.tick).toBe(0);
  });
});

describe('LOCKSTEP-1: Configurable Tick Rate', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3346;

  afterEach(async () => {
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (server) {
      await server.stop();
    }
  });

  function createClient(): Socket {
    const client = io(`http://localhost:${TEST_PORT}`, {
      autoConnect: false,
      forceNew: true,
    });
    clients.push(client);
    return client;
  }

  async function connectClient(client: Socket): Promise<void> {
    return new Promise((resolve) => {
      client.on('connect', () => resolve());
      client.connect();
    });
  }

  it('should use configurable tick rate (10 TPS = 100ms per tick)', async () => {
    server = new Phalanx({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 1,
      tickRate: 10, // 10 ticks per second
    });
    await server.start();

    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const tickEvents: TickSyncEvent[] = [];

    client1.on('tick-sync', (data: TickSyncEvent) => {
      tickEvents.push(data);
    });

    const gameStartPromise = new Promise<void>((resolve) => {
      client1.once('game-start', () => resolve());
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await gameStartPromise;
    client1.emit('client-ready');
    client2.emit('client-ready');

    // Wait for 1 second of ticks
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // At 10 TPS, should have ~10 ticks in 1 second
    const ticksInOneSecond = tickEvents.filter(
      (e) => e.tick >= 0 && e.tick < 15
    );
    expect(ticksInOneSecond.length).toBeGreaterThanOrEqual(8);
    expect(ticksInOneSecond.length).toBeLessThanOrEqual(15);
  });
});
