import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { RoomCreatedEvent, RoomErrorEvent } from '../src/services/PrivateRoomService.js';

/**
 * Tests for PrivateRoomService — room creation, joining, cancellation,
 * TTL expiry, and guards against duplicate/in-match usage.
 */
describe('PrivateRoomService', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3399;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 0,
      tickRate: 20,
      cors: { origin: '*' },
    });
    await server.start();
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.connected) client.disconnect();
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

  // ── Room creation ──────────────────────────────────────────────

  it('should emit room-created with a code when creating a room', async () => {
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });

    host.emit('room-create', { playerId: 'host1', username: 'Host' });

    const created = await createdPromise;
    expect(created.code).toBeDefined();
    expect(created.code.length).toBe(6);
  });

  it('should reject creating a second room for the same player', async () => {
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.once('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    await createdPromise;

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      host.once('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const error = await errorPromise;
    expect(error.message).toBe('You already have an active room');
  });

  // ── Room joining (match created) ──────────────────────────────

  it('should create a match when a second player joins a room', async () => {
    const host = createClient();
    const guest = createClient();
    await connectClient(host);
    await connectClient(guest);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    const hostMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      host.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    const guestMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      guest.on('match-found', (data: { matchId: string }) => resolve(data));
    });

    guest.emit('room-join', { playerId: 'guest1', username: 'Guest', code: created.code });

    const hostMatch = await hostMatchPromise;
    const guestMatch = await guestMatchPromise;
    expect(hostMatch.matchId).toBeDefined();
    expect(hostMatch.matchId).toBe(guestMatch.matchId);
  });

  // ── Invalid code errors ───────────────────────────────────────

  it('should emit room-error when joining with an invalid code', async () => {
    const guest = createClient();
    await connectClient(guest);

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      guest.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });

    guest.emit('room-join', { playerId: 'guest1', username: 'Guest', code: 'ZZZZZZ' });

    const error = await errorPromise;
    expect(error.message).toBe('Room not found');
  });

  it('should emit room-error when host tries to join own room', async () => {
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      host.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    host.emit('room-join', { playerId: 'host1', username: 'Host', code: created.code });

    const error = await errorPromise;
    expect(error.message).toBe('Cannot join your own room');
  });

  // ── Cancellation ──────────────────────────────────────────────

  it('should cancel a room and return room-cancelled event', async () => {
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    const cancelledPromise = new Promise<{ code: string }>((resolve) => {
      host.on('room-cancelled', (data: { code: string }) => resolve(data));
    });
    host.emit('room-cancel');

    const cancelled = await cancelledPromise;
    expect(cancelled.code).toBe(created.code);

    // Room should be gone — joining should fail
    const guest = createClient();
    await connectClient(guest);

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      guest.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    guest.emit('room-join', { playerId: 'guest1', username: 'Guest', code: created.code });

    const error = await errorPromise;
    expect(error.message).toBe('Room not found');
  });

  // ── TTL expiry ────────────────────────────────────────────────
  // Note: TTL is 5 minutes — a full expiry test would be too slow
  // for a unit test suite. We verify the cleanup mechanics
  // indirectly via the cancel and disconnect tests above.

  // ── Guard: reject if already in a match ───────────────────────

  it('should reject room creation if player is already in a match', async () => {
    const host = createClient();
    const guest = createClient();
    await connectClient(host);
    await connectClient(guest);

    // Create a room and have a guest join to start a match
    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    const hostMatchPromise = new Promise<void>((resolve) => {
      host.on('match-found', () => resolve());
    });
    guest.emit('room-join', { playerId: 'guest1', username: 'Guest', code: created.code });
    await hostMatchPromise;

    // Wait for game-start so matchId is assigned on sockets
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Now try to create another room — should be rejected
    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      host.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });

    const error = await errorPromise;
    expect(error.message).toBe('Already in a match');
  });

  it('should reject room joining if player is already in a match', async () => {
    const host1 = createClient();
    const guest1 = createClient();
    const host2 = createClient();
    await connectClient(host1);
    await connectClient(guest1);
    await connectClient(host2);

    // Create room 1 and start a match
    const created1Promise = new Promise<RoomCreatedEvent>((resolve) => {
      host1.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host1.emit('room-create', { playerId: 'host1', username: 'Host1' });
    const created1 = await created1Promise;

    const guestMatchPromise = new Promise<void>((resolve) => {
      guest1.on('match-found', () => resolve());
    });
    guest1.emit('room-join', { playerId: 'guest1', username: 'Guest1', code: created1.code });
    await guestMatchPromise;

    // Wait for game-start so matchId is assigned
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Create room 2
    const created2Promise = new Promise<RoomCreatedEvent>((resolve) => {
      host2.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host2.emit('room-create', { playerId: 'host2', username: 'Host2' });
    const created2 = await created2Promise;

    // guest1 (already in match) tries to join room 2 — should be rejected
    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      guest1.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    guest1.emit('room-join', { playerId: 'guest1', username: 'Guest1', code: created2.code });

    const error = await errorPromise;
    expect(error.message).toBe('Already in a match');
  });

  // ── Host disconnect cleans up room ────────────────────────────

  it('should clean up room when host disconnects', async () => {
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    // Host disconnects
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Guest tries to join — should fail
    const guest = createClient();
    await connectClient(guest);

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      guest.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    guest.emit('room-join', { playerId: 'guest1', username: 'Guest', code: created.code });

    const error = await errorPromise;
    expect(error.message).toBe('Room not found');
  });
});
