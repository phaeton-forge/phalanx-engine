import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { MatchFoundEvent } from '../src/types/index.js';

/**
 * Tests for Story 5 (MATCH-5): Server Sends Match Found Notification to Players
 */
describe('MATCH-5: Server Sends Match Found Notification to Players', () => {
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

  it('should emit match-found event with matchId, playerId, teamId, teammates, opponents', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchPromise1 = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const match = await matchPromise1;

    // All required fields should be present
    expect(match.matchId).toBeDefined();
    expect(typeof match.matchId).toBe('string');
    expect(match.playerId).toBeDefined();
    expect(typeof match.teamId).toBe('number');
    expect(Array.isArray(match.teammates)).toBe(true);
    expect(Array.isArray(match.opponents)).toBe(true);
  });

  it('should send personalized playerId to each player', async () => {
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

    // Each player receives their own playerId
    expect(match1.playerId).toBe('player1');
    expect(match2.playerId).toBe('player2');
    // Same matchId
    expect(match1.matchId).toBe(match2.matchId);
  });

  it('should include teammate info with playerId and username (1v1 has no teammates)', async () => {
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

    // In 1v1, each player is alone on their team
    expect(match.teammates.length).toBe(0);
  });

  it('should include opponent info with playerId and username', async () => {
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

    // In 1v1, one opponent
    expect(match.opponents.length).toBe(1);
    // Opponent info should have playerId and username
    expect(match.opponents[0]).toHaveProperty('playerId');
    expect(match.opponents[0]).toHaveProperty('username');
  });

  it('should not crash if player disconnects before match-found', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });

    // Disconnect client1 immediately before match is formed
    client1.disconnect();

    // Wait a bit and then add client2
    await new Promise((resolve) => setTimeout(resolve, 50));

    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    // Wait for matchmaking cycle - should not crash
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Server should still be running
    expect(server.getQueueSize()).toBeDefined();
  });
});

describe('MATCH-5: Teammates and Opponents in 2v2', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '2v2',
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

  it('should have 1 teammate and 2 opponents in 2v2', async () => {
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

    const matchPromise = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'p1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'p2', username: 'bob' });
    client3.emit('queue-join', { playerId: 'p3', username: 'carol' });
    client4.emit('queue-join', { playerId: 'p4', username: 'dave' });

    const match = await matchPromise;

    // In 2v2: 1 teammate (excluding self), 2 opponents
    expect(match.teammates.length).toBe(1);
    expect(match.opponents.length).toBe(2);
  });

  it('should exclude self from teammates list', async () => {
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

    const matchPromise = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    client1.emit('queue-join', { playerId: 'p1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'p2', username: 'bob' });
    client3.emit('queue-join', { playerId: 'p3', username: 'carol' });
    client4.emit('queue-join', { playerId: 'p4', username: 'dave' });

    const match = await matchPromise;

    // Self should not be in teammates
    const teammateIds = match.teammates.map((t) => t.playerId);
    expect(teammateIds).not.toContain(match.playerId);
  });

  it('should have opponents from different team only', async () => {
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

    // Get team 0 players
    const team0 = matches.filter((m) => m.teamId === 0);
    const team1 = matches.filter((m) => m.teamId === 1);

    // Team 0 player's opponents should be team 1 players
    const team0OpponentIds = team0[0].opponents.map((o) => o.playerId);
    const team1PlayerIds = team1.map((m) => m.playerId);

    expect(team0OpponentIds.sort()).toEqual(team1PlayerIds.sort());
  });
});

describe('MATCH-5: 3v3 Match Found Format', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({
      port: 0,
      matchmakingIntervalMs: 100,
      gameMode: '3v3',
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

  it('should have 2 teammates and 3 opponents in 3v3 (as per story example)', async () => {
    const clientsArr: Socket[] = [];
    for (let i = 0; i < 6; i++) {
      const client = createClient();
      await connectClient(client);
      clientsArr.push(client);
    }

    const matchPromise = new Promise<MatchFoundEvent>((resolve) => {
      clientsArr[0].on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    // Join 6 players for 3v3
    const usernames = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank'];
    for (let i = 0; i < 6; i++) {
      clientsArr[i].emit('queue-join', {
        playerId: `p${i}`,
        username: usernames[i],
      });
    }

    const match = await matchPromise;

    // In 3v3: 2 teammates (excluding self), 3 opponents
    expect(match.teammates.length).toBe(2);
    expect(match.opponents.length).toBe(3);

    // As per story example format check
    const teammateUsernames = match.teammates.map((t) => t.username);
    const opponentUsernames = match.opponents.map((o) => o.username);

    expect(teammateUsernames.length).toBe(2);
    expect(opponentUsernames.length).toBe(3);
  });
});
