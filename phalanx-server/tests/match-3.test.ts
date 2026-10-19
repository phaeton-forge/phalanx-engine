import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { MatchFoundEvent } from '../src/types/index.js';

/**
 * Tests for Story 3 (MATCH-3): Server Detects When Enough Players Are Ready for a Match
 */
describe('MATCH-3: Server Detects When Enough Players Are Ready for a Match', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    // Use a short matchmaking interval for faster tests
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '1v1', // 2 players per match
    });
    await server.start();
    clients = [];
  });

  afterEach(async () => {
    // Disconnect all clients first
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];
    // Small delay to allow disconnect events to process
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

  it('should create a match when enough players are in the queue (1v1)', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchPromise1 = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });
    const matchPromise2 = new Promise<MatchFoundEvent>((resolve) => {
      client2.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const match1 = await matchPromise1;
    const match2 = await matchPromise2;

    // Both players should receive the same matchId
    expect(match1.matchId).toBe(match2.matchId);
    // Each player receives their own playerId
    expect(match1.playerId).toBe('player1');
    expect(match2.playerId).toBe('player2');
    // In 1v1, no teammates, 1 opponent
    expect(match1.teammates.length).toBe(0);
    expect(match1.opponents.length).toBe(1);
  });

  it('should distribute players evenly into teams', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchPromise1 = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });
    const matchPromise2 = new Promise<MatchFoundEvent>((resolve) => {
      client2.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const match1 = await matchPromise1;
    const match2 = await matchPromise2;

    // In 1v1, each player should be on a different team (team 0 and team 1)
    expect(match1.teamId).not.toBe(match2.teamId);
    expect([0, 1]).toContain(match1.teamId);
    expect([0, 1]).toContain(match2.teamId);
  });

  it('should not create a match when not enough players are queued', async () => {
    const client1 = createClient();
    await connectClient(client1);

    let matchCreated = false;
    client1.on('match-found', () => {
      matchCreated = true;
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });

    // Wait for a matchmaking cycle
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(matchCreated).toBe(false);
    expect(server.getQueueSize()).toBe(1);
  });

  it('should remove players from queue after match creation', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchPromise = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    await matchPromise;

    // Queue should be empty after match creation
    expect(server.getQueueSize()).toBe(0);
  });

  it('should handle empty queue without errors', async () => {
    // Just wait for a matchmaking cycle with empty queue
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should not throw and queue size should be 0
    expect(server.getQueueSize()).toBe(0);
  });

  it('should emit match-created event', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchCreatedPromise = new Promise<boolean>((resolve) => {
      server.on('match-created', () => resolve(true));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const eventReceived = await matchCreatedPromise;
    expect(eventReceived).toBe(true);
  });
});

describe('MATCH-3: Game Mode Configuration', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

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

  it('should support 2v2 game mode (4 players)', async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '2v2',
    });
    await server.start();

    const clientsArr: Socket[] = [];
    for (let i = 0; i < 4; i++) {
      const client = createClient();
      await connectClient(client);
      clientsArr.push(client);
    }

    const matchPromises = clientsArr.map(
      (client) =>
        new Promise<MatchFoundEvent>((resolve) => {
          client.on('match-found', (data: MatchFoundEvent) => resolve(data));
        })
    );

    for (let i = 0; i < 4; i++) {
      clientsArr[i].emit('queue-join', {
        playerId: `player${i}`,
        username: `user${i}`,
      });
    }

    const matches = await Promise.all(matchPromises);

    // All players should be in the same match
    const matchIds = new Set(matches.map((m) => m.matchId));
    expect(matchIds.size).toBe(1);

    // Check team distribution: 2 players per team (teamId 0 and 1)
    const team0 = matches.filter((m) => m.teamId === 0);
    const team1 = matches.filter((m) => m.teamId === 1);
    expect(team0.length).toBe(2);
    expect(team1.length).toBe(2);

    // Each player on a team should have 1 teammate and 2 opponents
    expect(team0[0].teammates.length).toBe(1);
    expect(team0[0].opponents.length).toBe(2);
  });

  it('should support custom game mode configuration', async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: { playersPerMatch: 4, teamsCount: 4 }, // FFA style
    });
    await server.start();

    const clientsArr: Socket[] = [];
    for (let i = 0; i < 4; i++) {
      const client = createClient();
      await connectClient(client);
      clientsArr.push(client);
    }

    const matchPromises = clientsArr.map(
      (client) =>
        new Promise<MatchFoundEvent>((resolve) => {
          client.on('match-found', (data: MatchFoundEvent) => resolve(data));
        })
    );

    for (let i = 0; i < 4; i++) {
      clientsArr[i].emit('queue-join', {
        playerId: `player${i}`,
        username: `user${i}`,
      });
    }

    const matches = await Promise.all(matchPromises);

    // All players should be in the same match
    const matchIds = new Set(matches.map((m) => m.matchId));
    expect(matchIds.size).toBe(1);

    // Check team distribution: 1 player per team (FFA) - 4 different teams
    const teams = new Set(matches.map((m) => m.teamId));
    expect(teams.size).toBe(4);

    // In FFA, each player has 0 teammates and 3 opponents
    expect(matches[0].teammates.length).toBe(0);
    expect(matches[0].opponents.length).toBe(3);
  });
});
