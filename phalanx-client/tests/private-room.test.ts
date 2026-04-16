import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Phalanx } from 'phalanx-server';
import { PhalanxClient } from '../src/index.js';
import type {
  MatchFoundEvent,
  RoomCreatedEvent,
  RoomErrorEvent,
  RoomCancelledEvent,
} from '../src/types.js';

/**
 * Integration tests for PhalanxClient private room flows
 * (create, join, cancel, error handling).
 */
describe('PhalanxClient Private Room Integration', () => {
  let server: Phalanx;
  const TEST_PORT = 3457;
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

  // ── Create + Join → match-found ───────────────────────────────

  it('should create room with client A, join with client B, and receive match-found', async () => {
    const clientA = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerA',
      username: 'Alice',
    });
    const clientB = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerB',
      username: 'Bob',
    });

    await clientA.connect();
    await clientB.connect();

    // Client A creates a room
    const roomCreated = await clientA.createRoom();
    expect(roomCreated.code).toBeDefined();
    expect(roomCreated.code.length).toBe(6);

    // Client A waits for a match
    const matchPromiseA = clientA.waitForMatch();

    // Client B joins the room
    clientB.joinRoom(roomCreated.code);

    // Client B waits for a match
    const matchPromiseB = clientB.waitForMatch();

    const matchA = await matchPromiseA;
    const matchB = await matchPromiseB;

    expect(matchA.matchId).toBeDefined();
    expect(matchA.matchId).toBe(matchB.matchId);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('should receive game-start after room join', async () => {
    const clientA = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerA',
      username: 'Alice',
    });
    const clientB = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerB',
      username: 'Bob',
    });

    await clientA.connect();
    await clientB.connect();

    const roomCreated = await clientA.createRoom();

    const matchPromiseA = clientA.waitForMatch();
    clientB.joinRoom(roomCreated.code);
    const matchPromiseB = clientB.waitForMatch();

    await matchPromiseA;
    await matchPromiseB;

    const gameStart = await clientA.waitForGameStart();
    expect(gameStart.matchId).toBeDefined();
    expect(clientA.getClientState()).toBe('playing');

    clientA.disconnect();
    clientB.disconnect();
  });

  // ── Room error flows ──────────────────────────────────────────

  it('should emit roomError when joining a non-existent room code', async () => {
    const client = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'player1',
      username: 'TestPlayer',
    });

    await client.connect();

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      client.on('roomError', (event) => resolve(event));
    });

    client.joinRoom('ZZZZZZ');

    const error = await errorPromise;
    expect(error.message).toBe('Room not found');

    client.disconnect();
  });

  // ── Cancel flow ───────────────────────────────────────────────

  it('should cancel a room and receive roomCancelled from server', async () => {
    const client = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'player1',
      username: 'TestPlayer',
    });

    await client.connect();

    const roomCreated = await client.createRoom();
    expect(roomCreated.code).toBeDefined();

    const cancelledPromise = new Promise<RoomCancelledEvent>((resolve) => {
      client.on('roomCancelled', (event) => resolve(event));
    });

    client.cancelRoom();

    const cancelled = await cancelledPromise;
    expect(cancelled.code).toBe(roomCreated.code);
    expect(client.getClientState()).toBe('idle');

    client.disconnect();
  });

  it('should not allow joining a cancelled room', async () => {
    const clientA = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerA',
      username: 'Alice',
    });
    const clientB = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerB',
      username: 'Bob',
    });

    await clientA.connect();
    await clientB.connect();

    const roomCreated = await clientA.createRoom();

    const cancelledPromise = new Promise<RoomCancelledEvent>((resolve) => {
      clientA.on('roomCancelled', (event) => resolve(event));
    });
    clientA.cancelRoom();
    await cancelledPromise;

    // Now try joining — should fail
    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      clientB.on('roomError', (event) => resolve(event));
    });
    clientB.joinRoom(roomCreated.code);

    const error = await errorPromise;
    expect(error.message).toBe('Room not found');

    clientA.disconnect();
    clientB.disconnect();
  });
});
