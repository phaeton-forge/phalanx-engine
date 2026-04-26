import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Phalanx } from 'phalanx-server';
import { PhalanxClient } from '../src/index.js';
import type {
  MatchFoundEvent,
  RoomErrorEvent,
  RoomCancelledEvent,
  RoomRecoveredEvent,
  GameStartEvent,
  CountdownEvent,
  SocketTransport,
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

  it('should connect and create a room with polling fallback transports', async () => {
    const mobileTransports = [
      'polling',
      'websocket',
    ] as const satisfies readonly SocketTransport[];
    const client = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'mobile-player',
      username: 'MobilePlayer',
      socketTransports: mobileTransports,
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);

    const roomCreated = await client.createRoom();
    expect(roomCreated.code).toHaveLength(6);

    client.disconnect();
  });

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

  // ── Host recover flow ─────────────────────────────────────
  //
  // These tests cover the end-to-end mobile-host-switches-to-messenger
  // scenario: a private-room host creates a room, their socket dies
  // (simulated by `disconnect()` which in turn ends the TCP connection
  // server-side), and then they come back on a fresh socket and call
  // `recoverRoom(code)`. The server's grace period keeps the room
  // alive, and (if a guest had joined during the offline window) hands
  // the host directly into the running match with match-found +
  // reconnect-state carrying a countdown snapshot.

  it('should let a host reclaim their room after a socket reconnect', async () => {
    const host = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerHost',
      username: 'Host',
    });

    await host.connect();
    const roomCreated = await host.createRoom();

    // Simulate mobile browser killing the WebSocket when the user
    // switches to a messenger to share the invite link.
    host.disconnect();

    // Host comes back: reconnect on a fresh socket, then recover.
    await host.connect();
    const recovered: RoomRecoveredEvent = await host.recoverRoom(
      roomCreated.code,
    );
    expect(recovered.code).toBe(roomCreated.code);

    // Now a guest can still join the same room code and both sides
    // see match-found normally — the room was preserved across the
    // reconnect.
    const guest = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerGuest',
      username: 'Guest',
    });
    await guest.connect();

    const matchPromiseHost = new Promise<MatchFoundEvent>((resolve) => {
      host.on('matchFound', (event) => resolve(event));
    });
    const matchPromiseGuest = guest.waitForMatch();

    guest.joinRoom(roomCreated.code);

    const matchHost = await matchPromiseHost;
    const matchGuest = await matchPromiseGuest;
    expect(matchHost.matchId).toBe(matchGuest.matchId);

    host.disconnect();
    guest.disconnect();
  });

  it(
    'should deliver match-found to a host who was offline when the guest joined',
    async () => {
      // This is the exact scenario from the user bug report:
      //   1. Host creates room
      //   2. Host's browser tab goes background (socket dies)
      //   3. Guest joins — match-found fires server-side while host is dead
      //   4. Host returns, recoverRoom picks up the now-running match
      //
      // The host must still observe `matchFound` (retroactively, via the
      // pending-recover path) and `gameStart` (via the reconnect-state
      // snapshot fanned out through SocketManager's global handler).
      const host = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'playerHost',
        username: 'Host',
      });
      const guest = new PhalanxClient({
        serverUrl: SERVER_URL,
        playerId: 'playerGuest',
        username: 'Guest',
      });

      await host.connect();
      const roomCreated = await host.createRoom();

      // Host vanishes before guest arrives.
      host.disconnect();

      // Guest joins — server records a pending-recover entry for the host.
      await guest.connect();
      const matchPromiseGuest = guest.waitForMatch();
      guest.joinRoom(roomCreated.code);
      const matchGuest = await matchPromiseGuest;
      expect(matchGuest.matchId).toBeDefined();

      // Host returns. match-found must arrive via the recover fallback.
      await host.connect();

      // Wire *all* listeners up before calling `recoverRoom`. The server
      // emits in this order on the pending-recover path:
      //   `match-found` → `reconnect-state` (synchronously fans out
      //   synthetic `countdown`/`game-start`) → `room-recovered`.
      // If we only subscribed to `gameStart`/`countdown` after awaiting
      // `recoverRoom` (or even after `matchFound`), the synthetic replay
      // would have already passed by empty listener lists and this test
      // would hang until the timeout — flaky at best, deadlocking on a
      // reliable server at worst.
      const matchPromiseHost = new Promise<MatchFoundEvent>((resolve) => {
        host.on('matchFound', (event) => resolve(event));
      });
      const gameStartPromise = new Promise<GameStartEvent>((resolve) => {
        host.on('gameStart', (event) => resolve(event));
      });
      const countdownPromise = new Promise<CountdownEvent>((resolve) => {
        host.on('countdown', (event) => resolve(event));
      });

      const recovered = await host.recoverRoom(roomCreated.code);
      expect(recovered.code).toBe(roomCreated.code);

      const matchHost = await matchPromiseHost;
      expect(matchHost.matchId).toBe(matchGuest.matchId);

      // And the countdown + game-start — which fired on the guest while
      // the host was offline — must still flow through to the host's
      // callbacks thanks to the reconnect-state snapshot replay.
      //
      // If host recovered mid-countdown, the snapshot triggers a synthetic
      // countdown event. If the server had already emitted game-start by
      // recover time, gameStartEmitted is true and gameStart fires locally.
      // Either way, at least one of these will resolve within the test's
      // countdown window (server is configured with countdownSeconds: 1).
      const winner = await Promise.race([
        gameStartPromise.then(() => 'gameStart' as const),
        countdownPromise.then(() => 'countdown' as const),
      ]);
      expect(['gameStart', 'countdown']).toContain(winner);

      host.disconnect();
      guest.disconnect();
    },
  );

  it('should reject recoverRoom with a wrong code', async () => {
    const host = new PhalanxClient({
      serverUrl: SERVER_URL,
      playerId: 'playerHost',
      username: 'Host',
    });

    await host.connect();
    const roomCreated = await host.createRoom();
    host.disconnect();
    await host.connect();

    // Use a syntactically valid but wrong code. Server must refuse —
    // the rejection message is intentionally generic ("Room expired")
    // so an attacker can't use timing to enumerate live codes.
    const wrongCode =
      roomCreated.code === 'ABCDEF' ? 'GHJKLM' : 'ABCDEF';
    await expect(host.recoverRoom(wrongCode)).rejects.toThrow(/Room expired/);

    host.disconnect();
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
