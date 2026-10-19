import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { MatchFoundEvent } from '../src/types/index.js';

/**
 * Tests for Story 4 (MATCH-4): Server Creates Match Room and Assigns Players
 */
describe('MATCH-4: Server Creates Match Room and Assigns Players', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
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

  it('should generate match ID in format match-{timestamp}-{randomId}', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchPromise = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const match = await matchPromise;

    // Match ID should match the format: match-{timestamp}-{randomId}
    expect(match.matchId).toMatch(/^match-\d+-[a-z0-9]+$/);
  });

  it('should create unique match IDs for different matches', async () => {
    // First match
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchPromise1 = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const match1 = await matchPromise1;

    // Second match with new players
    const client3 = createClient();
    const client4 = createClient();
    await connectClient(client3);
    await connectClient(client4);

    const matchPromise2 = new Promise<MatchFoundEvent>((resolve) => {
      client3.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client3.emit('queue-join', { playerId: 'player3', username: 'carol' });
    client4.emit('queue-join', { playerId: 'player4', username: 'dave' });

    const match2 = await matchPromise2;

    // Match IDs should be different
    expect(match1.matchId).not.toBe(match2.matchId);
  });

  it('should assign all players to the same room', async () => {
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

    // Both players should receive the same match ID (same room)
    expect(match1.matchId).toBe(match2.matchId);
    // Each player gets personalized data
    expect(match1.playerId).toBe('player1');
    expect(match2.playerId).toBe('player2');
  });

  it('should assign correct team IDs to players', async () => {
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

    // In 1v1, team IDs should be 0 and 1
    expect([0, 1]).toContain(match1.teamId);
    expect([0, 1]).toContain(match2.teamId);
    expect(match1.teamId).not.toBe(match2.teamId);
  });
});

describe('MATCH-4: Team Assignment for 2v2 Mode', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '2v2', // 4 players, 2 teams
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

  it('should correctly assign teammates and opponents in 2v2', async () => {
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

    const matchPromises = [client1, client2, client3, client4].map(
      (client) =>
        new Promise<MatchFoundEvent>((resolve) => {
          client.on('match-found', (data: MatchFoundEvent) => resolve(data));
        })
    );

    client1.emit('queue-join', { playerId: 'p1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'p2', username: 'bob' });
    client3.emit('queue-join', { playerId: 'p3', username: 'carol' });
    client4.emit('queue-join', { playerId: 'p4', username: 'dave' });

    const matches = await Promise.all(matchPromises);

    // All 4 players should be in the same match
    const matchIds = new Set(matches.map((m) => m.matchId));
    expect(matchIds.size).toBe(1);

    // Team 0 should have 2 players, Team 1 should have 2 players
    const team0 = matches.filter((m) => m.teamId === 0);
    const team1 = matches.filter((m) => m.teamId === 1);

    expect(team0.length).toBe(2);
    expect(team1.length).toBe(2);

    // Each player should have 1 teammate (excluding themselves) and 2 opponents
    expect(team0[0].teammates.length).toBe(1);
    expect(team0[0].opponents.length).toBe(2);
    expect(team1[0].teammates.length).toBe(1);
    expect(team1[0].opponents.length).toBe(2);
  });

  it('should add all 4 players to the same match room', async () => {
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

    const matchPromises = [client1, client2, client3, client4].map(
      (client) =>
        new Promise<MatchFoundEvent>((resolve) => {
          client.on('match-found', (data: MatchFoundEvent) => resolve(data));
        })
    );

    client1.emit('queue-join', { playerId: 'p1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'p2', username: 'bob' });
    client3.emit('queue-join', { playerId: 'p3', username: 'carol' });
    client4.emit('queue-join', { playerId: 'p4', username: 'dave' });

    const matches = await Promise.all(matchPromises);

    // All players should receive the same match ID
    const matchIds = new Set(matches.map((m) => m.matchId));
    expect(matchIds.size).toBe(1);
  });
});
