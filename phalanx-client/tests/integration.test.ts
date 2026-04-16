import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Phalanx } from 'phalanx-server';
import { PhalanxClient } from '../src/index.js';
import type {
  MatchFoundEvent,
  CountdownEvent,
  TickSyncEvent,
} from '../src/types.js';

/**
 * Integration tests for PhalanxClient with the real Phalanx server
 */
describe('PhalanxClient Integration Tests', () => {
  let server: Phalanx;
  const TEST_PORT = 3456;
  const SERVER_URL = `http://localhost:${TEST_PORT}`;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 1,
      tickRate: 20,
      cors: { origin: '*' },
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Connection', () => {
    it('should connect to server successfully', async () => {
      const client = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'TestPlayer',
      });

      await client.connect();

      expect(client.isConnected()).toBe(true);
      expect(client.getConnectionState()).toBe('connected');

      client.disconnect();
    });

    it('should emit connected event on successful connection', async () => {
      const client = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'TestPlayer',
      });

      let connected = false;
      client.on('connected', () => {
        connected = true;
      });

      await client.connect();

      expect(connected).toBe(true);

      client.disconnect();
    });

    it('should update state on disconnect', async () => {
      const client = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'TestPlayer',
      });

      await client.connect();
      client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionState()).toBe('disconnected');
    });
  });

  describe('Queue', () => {
    it('should join queue and receive status', async () => {
      const client = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'TestPlayer',
      });

      await client.connect();
      const status = await client.joinQueue();

      expect(status.position).toBe(1);
      expect(status.waitTime).toBeGreaterThanOrEqual(0);
      expect(client.getClientState()).toBe('in-queue');

      client.disconnect();
    });

    it('should leave queue', async () => {
      const client = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'TestPlayer',
      });

      await client.connect();
      await client.joinQueue();
      client.leaveQueue();

      expect(client.getClientState()).toBe('idle');

      client.disconnect();
    });
  });

  describe('Matchmaking', () => {
    it('should find match when two players join queue', async () => {
      const client1 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'Player1',
      });
      const client2 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player2',
        username: 'Player2',
      });

      await client1.connect();
      await client2.connect();

      // Client 1 joins and waits for match
      const matchPromise = client1.joinQueueAndWaitForMatch();

      // Client 2 joins
      await client2.joinQueue();
      await client2.waitForMatch();

      const match = await matchPromise;

      expect(match.matchId).toBeDefined();
      expect(match.playerId).toBe('player1');
      expect(typeof match.teamId).toBe('number');
      expect(client1.getMatchId()).toBe(match.matchId);

      client1.disconnect();
      client2.disconnect();
    });

    it('should emit matchFound event', async () => {
      const client1 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'Player1',
      });
      const client2 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player2',
        username: 'Player2',
      });

      await client1.connect();
      await client2.connect();

      let matchFoundEvent: MatchFoundEvent | null = null;
      client1.on('matchFound', (event) => {
        matchFoundEvent = event;
      });

      // Start waiting BEFORE joining queue
      const matchPromise1 = client1.waitForMatch();
      const matchPromise2 = client2.waitForMatch();

      client1.joinQueue();
      client2.joinQueue();

      await matchPromise1;
      await matchPromise2;

      expect(matchFoundEvent).not.toBeNull();
      expect(matchFoundEvent!.matchId).toBeDefined();

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('Game Lifecycle', () => {
    it('should receive countdown events', async () => {
      const client1 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'Player1',
      });
      const client2 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player2',
        username: 'Player2',
      });

      await client1.connect();
      await client2.connect();

      await client1.joinQueue();
      await client2.joinQueue();

      await client1.waitForMatch();

      const countdownEvents: CountdownEvent[] = [];
      await client1.waitForCountdown((event) => {
        countdownEvents.push(event);
      });

      expect(countdownEvents.length).toBeGreaterThan(0);
      expect(countdownEvents[countdownEvents.length - 1]?.seconds).toBe(0);

      client1.disconnect();
      client2.disconnect();
    });

    it('should receive game start event', async () => {
      const client1 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'Player1',
      });
      const client2 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player2',
        username: 'Player2',
      });

      await client1.connect();
      await client2.connect();

      // Start waiting for match before joining
      const matchPromise1 = client1.waitForMatch();
      const matchPromise2 = client2.waitForMatch();

      await client1.joinQueue();
      await client2.joinQueue();

      await matchPromise1;
      await matchPromise2;

      // Now wait for game start (countdown is 1 second)
      const gameStart = await client1.waitForGameStart();

      expect(gameStart.matchId).toBeDefined();
      expect(client1.getClientState()).toBe('playing');

      client1.disconnect();
      client2.disconnect();
    });

    it('should receive tick-sync events after game start', async () => {
      const client1 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'Player1',
      });
      const client2 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player2',
        username: 'Player2',
      });

      await client1.connect();
      await client2.connect();

      // Start waiting for match before joining
      const matchPromise1 = client1.waitForMatch();
      const matchPromise2 = client2.waitForMatch();

      await client1.joinQueue();
      await client2.joinQueue();

      await matchPromise1;
      await matchPromise2;

      await client1.waitForGameStart();

      // Signal both clients as ready so the server starts sending ticks
      client1.sendReady();
      client2.sendReady();

      const tickEvents: TickSyncEvent[] = [];
      client1.on('tick', (event) => {
        tickEvents.push(event);
      });

      // Wait for a few ticks
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(tickEvents.length).toBeGreaterThan(0);
      expect(client1.getCurrentTick()).toBeGreaterThan(0);

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('LobbyScene Flow', () => {
    it('should receive matchFound and gameStart via on() subscriptions', async () => {
      const client1 = await PhalanxClient.create({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'Player1',
        debug: true,
      });
      const client2 = await PhalanxClient.create({
        serverUrl: SERVER_URL,
        playerId: 'player2',
        username: 'Player2',
        debug: true,
      });

      // Track events exactly like LobbyScene does
      let matchData1: MatchFoundEvent | null = null;
      let gameStarted1 = false;
      let matchData2: MatchFoundEvent | null = null;
      let gameStarted2 = false;

      // Subscribe BEFORE joining queue (like LobbyScene)
      client1.on('matchFound', (event) => {
        matchData1 = event;
      });
      client1.on('gameStart', () => {
        gameStarted1 = true;
      });

      client2.on('matchFound', (event) => {
        matchData2 = event;
      });
      client2.on('gameStart', () => {
        gameStarted2 = true;
      });

      // Join queue
      await client1.joinQueue();
      await client2.joinQueue();

      // Wait for game to start (countdown is 1 second + some buffer)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Verify both clients received events
      expect(matchData1).not.toBeNull();
      expect(matchData1!.matchId).toBeDefined();
      expect(gameStarted1).toBe(true);

      expect(matchData2).not.toBeNull();
      expect(matchData2!.matchId).toBeDefined();
      expect(gameStarted2).toBe(true);

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('Commands', () => {
    it('should submit commands and receive acknowledgment', async () => {
      const client1 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player1',
        username: 'Player1',
      });
      const client2 = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'player2',
        username: 'Player2',
      });

      await client1.connect();
      await client2.connect();

      // Start waiting for match before joining
      const matchPromise1 = client1.waitForMatch();
      const matchPromise2 = client2.waitForMatch();

      await client1.joinQueue();
      await client2.joinQueue();

      await matchPromise1;
      await matchPromise2;

      await client1.waitForGameStart();

      // Signal both clients as ready so the server starts sending ticks
      client1.sendReady();
      client2.sendReady();
      await new Promise<void>((resolve) => {
        client1.once('tick', () => resolve());
      });

      const ack = await client1.submitCommands(client1.getCurrentTick() + 1, [
        { type: 'move', data: { x: 10, y: 20 } },
      ]);

      expect(ack.accepted).toBe(true);

      client1.disconnect();
      client2.disconnect();
    });
  });
});
