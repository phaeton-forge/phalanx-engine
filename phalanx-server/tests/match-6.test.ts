import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type {
  CountdownEvent,
  GameStartEvent,
  MatchFoundEvent,
} from '../src/types/index.js';

/**
 * Tests for Story 6 (MATCH-6): Server Sends Game Start Countdown
 */
describe('MATCH-6: Server Sends Game Start Countdown', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 3, // Short countdown for faster tests
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
    const client = io(`http://localhost:${String(server.getPort())}`, {
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

  it('should emit countdown events starting immediately after match creation', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const countdownEvents: CountdownEvent[] = [];
    let matchFoundTime: number | null = null;
    let firstCountdownTime: number | null = null;

    client1.on('match-found', () => {
      matchFoundTime = Date.now();
    });

    client1.on('countdown', (data: CountdownEvent) => {
      if (firstCountdownTime === null) {
        firstCountdownTime = Date.now();
      }
      countdownEvents.push(data);
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    // Wait for match-found and first countdown
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(matchFoundTime).not.toBeNull();
    expect(firstCountdownTime).not.toBeNull();
    expect(countdownEvents.length).toBeGreaterThan(0);
    // First countdown should come almost immediately after match-found
    expect(firstCountdownTime! - matchFoundTime!).toBeLessThan(200);
  });

  it('should emit countdown event every 1 second', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const countdownTimestamps: number[] = [];

    client1.on('countdown', () => {
      countdownTimestamps.push(Date.now());
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    // Wait for all countdown events (3, 2, 1, 0 = 4 events over ~3 seconds)
    await new Promise((resolve) => setTimeout(resolve, 3500));

    // Should have multiple countdown events
    expect(countdownTimestamps.length).toBeGreaterThanOrEqual(3);

    // Check interval between events is approximately 1 second
    for (let i = 1; i < countdownTimestamps.length; i++) {
      const interval = countdownTimestamps[i] - countdownTimestamps[i - 1];
      expect(interval).toBeGreaterThanOrEqual(900);
      expect(interval).toBeLessThanOrEqual(1200);
    }
  });

  it('should emit countdown with decreasing seconds (e.g., 3, 2, 1, 0)', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const countdownValues: number[] = [];

    client1.on('countdown', (data: CountdownEvent) => {
      countdownValues.push(data.seconds);
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    // Wait for all countdown events
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Should have countdown from 3 to 0
    expect(countdownValues).toEqual([3, 2, 1, 0]);
  });

  it('should emit countdown events to both players in the match', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const countdownEvents1: CountdownEvent[] = [];
    const countdownEvents2: CountdownEvent[] = [];

    client1.on('countdown', (data: CountdownEvent) => {
      countdownEvents1.push(data);
    });
    client2.on('countdown', (data: CountdownEvent) => {
      countdownEvents2.push(data);
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    // Wait for all countdown events
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Both players should receive the same countdown
    expect(countdownEvents1.length).toBe(4); // 3, 2, 1, 0
    expect(countdownEvents2.length).toBe(4);
    expect(countdownEvents1.map((e) => e.seconds)).toEqual(
      countdownEvents2.map((e) => e.seconds)
    );
  });

  it('should emit game-start event after countdown reaches 0', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const gameStartPromise = new Promise<GameStartEvent>((resolve) => {
      client1.on('game-start', (data: GameStartEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const gameStart = await gameStartPromise;

    expect(gameStart).toBeDefined();
    expect(gameStart.matchId).toBeDefined();
    expect(typeof gameStart.matchId).toBe('string');
  });

  it('should emit game-start with the correct matchId', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    let matchId: string | null = null;

    const matchFoundPromise = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => {
        matchId = data.matchId;
        resolve(data);
      });
    });

    const gameStartPromise = new Promise<GameStartEvent>((resolve) => {
      client1.on('game-start', (data: GameStartEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await matchFoundPromise;
    const gameStart = await gameStartPromise;

    expect(gameStart.matchId).toBe(matchId);
  });

  it('should emit game-start to both players', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const gameStartPromise1 = new Promise<GameStartEvent>((resolve) => {
      client1.on('game-start', (data: GameStartEvent) => resolve(data));
    });
    const gameStartPromise2 = new Promise<GameStartEvent>((resolve) => {
      client2.on('game-start', (data: GameStartEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const [gameStart1, gameStart2] = await Promise.all([
      gameStartPromise1,
      gameStartPromise2,
    ]);

    expect(gameStart1.matchId).toBe(gameStart2.matchId);
  });
});

describe('MATCH-6: Countdown with 5-second default', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 5, // Standard 5-second countdown as per story
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
    const client = io(`http://localhost:${String(server.getPort())}`, {
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

  it('should emit countdown from 5 to 0 as per story example', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const countdownValues: number[] = [];

    client1.on('countdown', (data: CountdownEvent) => {
      countdownValues.push(data.seconds);
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    // Wait for all countdown events (5, 4, 3, 2, 1, 0)
    await new Promise((resolve) => setTimeout(resolve, 6500));

    expect(countdownValues).toEqual([5, 4, 3, 2, 1, 0]);
  });
});
