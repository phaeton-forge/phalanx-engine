import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type {
  RoomCreatedEvent,
  RoomRecoveredEvent,
  RoomErrorEvent,
} from '../src/services/PrivateRoomService.js';

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

  it('should create a room for a disconnected host and allow recovery after guest joins', async () => {
    const created = server.createPrivateRoomForHost({
      playerId: 'telegram:100',
      username: 'Telegram Host',
    });

    expect(created.code).toBeDefined();
    expect(created.code.length).toBe(6);

    const guest = createClient();
    await connectClient(guest);

    const guestMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      guest.once('match-found', (data: { matchId: string }) => resolve(data));
    });

    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });

    const guestMatch = await guestMatchPromise;

    const host = createClient();
    await connectClient(host);

    const recoveredPromise = new Promise<RoomRecoveredEvent>((resolve) => {
      host.once('room-recovered', (data: RoomRecoveredEvent) => resolve(data));
    });
    const hostMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      host.once('match-found', (data: { matchId: string }) => resolve(data));
    });

    host.emit('room-recover', {
      playerId: 'telegram:100',
      username: 'Telegram Host',
      code: created.code,
    });

    const recovered = await recoveredPromise;
    const hostMatch = await hostMatchPromise;

    expect(recovered.code).toBe(created.code);
    expect(hostMatch.matchId).toBe(guestMatch.matchId);
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

  // ── Host disconnect — grace period ────────────────────────────
  //
  // Regression coverage for the mobile-share-link UX bug: when a host
  // on a mobile browser switches to a messenger to share the invite
  // link, the OS tears down the WebSocket. Previously this destroyed
  // the room immediately and the guest got 'Room not found' when they
  // followed the link. Now the room survives a grace period so the
  // host can either reconnect (room-recover) or the guest can still
  // join during the gap.

  it('should NOT destroy a room immediately when host disconnects', async () => {
    const host = createClient();
    const guest = createClient();
    await connectClient(host);
    await connectClient(guest);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    // Host disconnects (e.g. mobile browser killed the WebSocket)
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Guest follows the invite link during the disconnect window —
    // the room must still be there and the match must start.
    const guestMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      guest.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });

    const guestMatch = await guestMatchPromise;
    expect(guestMatch.matchId).toBeDefined();
  });

  it('should recover a room when the host reconnects via room-recover, and rebind to the new socket', async () => {
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    // Host socket dies
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Host reconnects with a brand-new socket and recovers the room
    const host2 = createClient();
    await connectClient(host2);

    const recoveredPromise = new Promise<RoomRecoveredEvent>((resolve) => {
      host2.on('room-recovered', (data: RoomRecoveredEvent) => resolve(data));
    });
    host2.emit('room-recover', {
      playerId: 'host1',
      username: 'Host',
      code: created.code,
    });

    const recovered = await recoveredPromise;
    expect(recovered.code).toBe(created.code);

    // A guest can still join by code AND both the recovered host and
    // the guest must receive match-found. The host assertion is the
    // important regression guard: if recoverRoom didn't also update
    // `room.host.socketId`, GameRoom would try to emit to the dead
    // original socket and host2 would get nothing.
    const guest = createClient();
    await connectClient(guest);
    const guestMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      guest.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    const hostMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      host2.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });
    const [guestMatch, hostMatch] = await Promise.all([
      guestMatchPromise,
      hostMatchPromise,
    ]);
    expect(guestMatch.matchId).toBeDefined();
    expect(hostMatch.matchId).toBe(guestMatch.matchId);
  });

  it('should deliver match-found to a host who recovers after the guest joined during disconnect', async () => {
    // The trickiest UX path: host creates a room, host's mobile browser
    // kills the socket, guest follows the invite link while the host is
    // still offline (so the match is created but the host socket is
    // null), and then the host finally reconnects. Prior to this fix,
    // the host never learned the matchId and had no way to reconnect.
    // After: the service remembers the pending match keyed by host
    // playerId and retroactively delivers match-found on room-recover.
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    // Host drops.
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Guest joins while host is still offline — match is created.
    const guest = createClient();
    await connectClient(guest);
    const guestMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      guest.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });
    const guestMatch = await guestMatchPromise;
    expect(guestMatch.matchId).toBeDefined();

    // Host finally reconnects on a new socket and recovers — should get
    // match-found with the same matchId the guest saw.
    const host2 = createClient();
    await connectClient(host2);
    const hostRecoveredPromise = new Promise<RoomRecoveredEvent>((resolve) => {
      host2.on('room-recovered', (data: RoomRecoveredEvent) => resolve(data));
    });
    const hostMatchPromise = new Promise<{
      matchId: string;
      teamId: number;
      opponents: { playerId: string }[];
    }>((resolve) => {
      host2.on(
        'match-found',
        (data: {
          matchId: string;
          teamId: number;
          opponents: { playerId: string }[];
        }) => resolve(data),
      );
    });
    host2.emit('room-recover', {
      playerId: 'host1',
      username: 'Host',
      code: created.code,
    });

    const [hostRecovered, hostMatch] = await Promise.all([
      hostRecoveredPromise,
      hostMatchPromise,
    ]);
    expect(hostRecovered.code).toBe(created.code);
    expect(hostMatch.matchId).toBe(guestMatch.matchId);
    expect(hostMatch.teamId).toBe(0); // host is team 0
    expect(hostMatch.opponents.map((o) => o.playerId)).toContain('guest1');
  });

  it('should reject pending-match recover when the attacker presents a wrong code', async () => {
    // Security guard for the pending-host-reconnect fallback path:
    // after a guest has consumed the room (joinRoom) while the host
    // was offline, recovery has to go through pendingHostReconnect
    // instead of this.rooms. That fallback must *also* require a
    // matching code — otherwise an attacker who knew only the host's
    // playerId could claim the pending match and get match-found /
    // reconnect-state for a game they were never part of.
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'victim', username: 'Victim' });
    const created = await createdPromise;

    // Victim drops; guest joins while offline — match is created and
    // goes into pendingHostReconnect keyed by 'victim' + the real code.
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const guest = createClient();
    await connectClient(guest);
    const guestMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      guest.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });
    await guestMatchPromise;

    // Attacker knows the victim's playerId but not the real room code.
    const attacker = createClient();
    await connectClient(attacker);
    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      attacker.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    const unexpectedMatchPromise = new Promise<unknown>((resolve) => {
      attacker.on('match-found', (data) => resolve(data));
      attacker.on('reconnect-state', (data) => resolve(data));
      attacker.on('room-recovered', (data) => resolve(data));
      setTimeout(() => resolve(null), 400);
    });
    attacker.emit('room-recover', {
      playerId: 'victim',
      username: 'Attacker',
      code: 'WRONGCD',
    });

    const error = await errorPromise;
    expect(error.message).toBe('Room expired');
    expect(await unexpectedMatchPromise).toBeNull();

    // And the legitimate victim can still come back with the real code
    // — i.e. the bad attempt didn't consume or poison the pending entry.
    const victim2 = createClient();
    await connectClient(victim2);
    const victimMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      victim2.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    victim2.emit('room-recover', {
      playerId: 'victim',
      username: 'Victim',
      code: created.code,
    });
    const victimMatch = await victimMatchPromise;
    expect(victimMatch.matchId).toBeDefined();
  });

  it('should not crash when room-recover payload is null or not an object', async () => {
    // Regression guard for the handler's top-level shape check. Without
    // it, `typeof data.code` on `null` / a primitive would throw
    // synchronously inside the socket handler and could tear the
    // connection down.
    const client = createClient();
    await connectClient(client);

    const collected: RoomErrorEvent[] = [];
    client.on('room-error', (data: RoomErrorEvent) => collected.push(data));

    // null, undefined, a string, and a number all count as "not a
    // well-formed payload" and must be rejected with 'Room expired'.
    // Using `emit(event, arg)` for each — Socket.IO serialises the
    // arg and the server hook receives it verbatim.
    client.emit('room-recover', null);
    client.emit('room-recover', undefined);
    client.emit('room-recover', 'not-an-object');
    client.emit('room-recover', 42);
    client.emit('room-recover'); // no payload at all

    // Give the server a moment to process all five messages.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // We expect at least one 'Room expired' error, and, crucially,
    // the socket must still be connected — if the handler had thrown,
    // the connection would have dropped.
    expect(collected.length).toBeGreaterThan(0);
    expect(collected.every((e) => e.message === 'Room expired')).toBe(true);
    expect(client.connected).toBe(true);
  });

  it('should emit room-error with "Room expired" when room-recover omits the code', async () => {
    // Security guard: the Phalanx room-recover handler rejects a payload
    // that has no `code`, so a client can't use playerId-only recovery
    // to fish for valid room codes.
    const host = createClient();
    await connectClient(host);

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      host.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    const unexpectedRecoverPromise = new Promise<RoomRecoveredEvent | null>(
      (resolve) => {
        host.on('room-recovered', (data: RoomRecoveredEvent) => resolve(data));
        setTimeout(() => resolve(null), 300);
      },
    );
    host.emit('room-recover', { playerId: 'host1', username: 'Host' });

    const error = await errorPromise;
    expect(error.message).toBe('Room expired');
    expect(await unexpectedRecoverPromise).toBeNull();
  });

  it('should emit room-error with "Room expired" when recovering a non-existent room', async () => {
    const host = createClient();
    await connectClient(host);

    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      host.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    host.emit('room-recover', {
      playerId: 'ghost',
      username: 'Ghost',
      code: 'ZZZZZZ',
    });

    const error = await errorPromise;
    expect(error.message).toBe('Room expired');
  });

  it('should reject room-recover when the code does not match the host\u2019s room', async () => {
    // Security guard: a client that only knows another host's playerId
    // (but not the room code) must not be able to reclaim the room and
    // learn its invite code.
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    await createdPromise;

    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // An attacker connects and tries to steal the room with the correct
    // playerId but a wrong code.
    const attacker = createClient();
    await connectClient(attacker);
    const errorPromise = new Promise<RoomErrorEvent>((resolve) => {
      attacker.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    const unexpectedRecoverPromise = new Promise<RoomRecoveredEvent | null>(
      (resolve) => {
        attacker.on('room-recovered', (data: RoomRecoveredEvent) =>
          resolve(data),
        );
        // Give the server plenty of room to misbehave before we conclude
        // no recover event came back.
        setTimeout(() => resolve(null), 300);
      },
    );
    attacker.emit('room-recover', {
      playerId: 'host1',
      username: 'Attacker',
      code: 'WRONGCD',
    });

    const error = await errorPromise;
    expect(error.message).toBe('Room expired');
    expect(await unexpectedRecoverPromise).toBeNull();
  });

  it('should not mutate per-socket identity state on a failed room-recover', async () => {
    // Regression guard for the case where an attacker (or a confused
    // client) sends a bogus room-recover: the handler must NOT capture
    // the payload's playerId on the connection, because a follow-up
    // room-cancel on the same socket would then act on a playerId the
    // socket was never authenticated to own.
    const host = createClient();
    await connectClient(host);

    // A victim host creates a real room.
    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'victim', username: 'Victim' });
    const created = await createdPromise;

    // Attacker connects on a fresh socket and fires a bad recover.
    const attacker = createClient();
    await connectClient(attacker);

    const attackerErrorPromise = new Promise<RoomErrorEvent>((resolve) => {
      attacker.on('room-error', (data: RoomErrorEvent) => resolve(data));
    });
    attacker.emit('room-recover', {
      playerId: 'victim',
      username: 'Attacker',
      code: 'WRONGCD',
    });
    const attackerError = await attackerErrorPromise;
    expect(attackerError.message).toBe('Room expired');

    // Now the attacker tries to cancel the victim's room. Because the
    // failed recover must not have captured `victim` as this socket's
    // playerId, cancel is a no-op and the room stays alive.
    attacker.emit('room-cancel');
    await new Promise((resolve) => setTimeout(resolve, 150));

    // The room is still there: the host can join it from a guest.
    const guest = createClient();
    await connectClient(guest);
    const guestMatchPromise = new Promise<{ matchId: string }>((resolve) => {
      guest.on('match-found', (data: { matchId: string }) => resolve(data));
    });
    const guestErrorPromise = new Promise<RoomErrorEvent | null>((resolve) => {
      guest.on('room-error', (data: RoomErrorEvent) => resolve(data));
      setTimeout(() => resolve(null), 500);
    });
    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });
    const guestMatch = await Promise.race([
      guestMatchPromise,
      guestErrorPromise.then((e) => {
        if (e) throw new Error(`unexpected room-error: ${e.message}`);
        return null;
      }),
    ]);
    expect(guestMatch).not.toBeNull();
    expect((guestMatch as { matchId: string }).matchId).toBeDefined();
  });

  it('should allow the host to cancel a room after reconnecting with a new socket', async () => {
    const host = createClient();
    await connectClient(host);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    // Original host socket drops
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // New host socket — cancel must still work because cancelRoom
    // looks up by playerId, not socketId.
    const host2 = createClient();
    await connectClient(host2);

    const cancelledPromise = new Promise<{ code: string }>((resolve) => {
      host2.on('room-cancelled', (data: { code: string }) => resolve(data));
    });
    // The Phalanx room-cancel handler keys off the `playerId` captured
    // from a prior message on this socket, so we first associate the
    // new socket with the host's playerId via room-recover, wait for
    // the server-side ack, and only then cancel. Relying on a fixed
    // sleep here is racy under load — waiting for `room-recovered`
    // is the deterministic signal that the handler has run.
    const recoveredPromise = new Promise<RoomRecoveredEvent>((resolve) => {
      host2.on('room-recovered', (data: RoomRecoveredEvent) => resolve(data));
    });
    host2.emit('room-recover', {
      playerId: 'host1',
      username: 'Host',
      code: created.code,
    });
    await recoveredPromise;
    host2.emit('room-cancel');

    const cancelled = await cancelledPromise;
    expect(cancelled.code).toBe(created.code);
  });

  // ── Disconnect persistence (unit, fake timers) ────────────────────
  //
  // Pure-unit checks against PrivateRoomService with fake timers so we
  // can assert that a host disconnect does not destroy a waiting room.

  it('should keep the room alive after host disconnect until TTL expires (unit)', async () => {
    const { PrivateRoomService } = await import(
      '../src/services/PrivateRoomService.js'
    );
    const { validateConfig } = await import('../src/config/validation.js');

    const config = validateConfig({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 0,
      tickRate: 20,
      cors: { origin: '*' },
    });

    // Minimal mocks for the dependencies we don't exercise here.
    const fakeIo = {} as unknown as import('socket.io').Server;
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const hostSocket = {
      id: 'sock-host-1',
      data: {},
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
        return true;
      },
    } as unknown as import('socket.io').Socket;

    vi.useFakeTimers();
    try {
      const service = new PrivateRoomService(
        fakeIo,
        config,
        () => undefined,
        () => config,
      );

      service.createRoom('host1', 'Host', hostSocket);
      const createdEvent = emitted.find((e) => e.event === 'room-created');
      expect(createdEvent).toBeDefined();
      const code = (createdEvent!.payload as { code: string }).code;

      // Host socket dies.
      service.handleDisconnect(hostSocket.id);

      // Fast-forward past the old grace-window duration.
      vi.advanceTimersByTime(2 * 60 * 1000 + 1);

      // Room must still be alive: host can recover by room code.
      emitted.length = 0;
      service.recoverRoom('host1', hostSocket, code);
      const recovered = emitted.find((e) => e.event === 'room-recovered');
      const roomError = emitted.find((e) => e.event === 'room-error');
      expect(recovered).toBeDefined();
      expect(roomError).toBeUndefined();

      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should allow room-recover after long disconnect while room TTL has not expired (unit)', async () => {
    // With disconnect no longer starting a destroy timer, host should be
    // able to recover even after the old grace window elapsed.
    const { PrivateRoomService } = await import(
      '../src/services/PrivateRoomService.js'
    );
    const { validateConfig } = await import('../src/config/validation.js');

    const config = validateConfig({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 0,
      tickRate: 20,
      cors: { origin: '*' },
    });

    const fakeIo = {} as unknown as import('socket.io').Server;
    const emitted: Array<{
      socket: string;
      event: string;
      payload: unknown;
    }> = [];
    const makeSocket = (id: string) =>
      ({
        id,
        data: {},
        emit: (event: string, payload: unknown) => {
          emitted.push({ socket: id, event, payload });
          return true;
        },
      }) as unknown as import('socket.io').Socket;

    const hostSocket1 = makeSocket('sock-host-1');
    const hostSocket2 = makeSocket('sock-host-2');
    const guestSocket = makeSocket('sock-guest-1');

    vi.useFakeTimers();
    try {
      const service = new PrivateRoomService(
        fakeIo,
        config,
        () => undefined,
        () => config,
      );

      service.createRoom('host1', 'Host', hostSocket1);
      const code = (
        emitted.find((e) => e.event === 'room-created')!.payload as {
          code: string;
        }
      ).code;

      service.handleDisconnect(hostSocket1.id);

      // Host reconnects on a new socket after the old grace window elapsed.
      vi.advanceTimersByTime(2 * 60 * 1000 + 1);
      service.recoverRoom('host1', hostSocket2, code);

      const recovered = emitted.find((e) => e.event === 'room-recovered');
      expect(recovered).toBeDefined();
      expect(recovered!.socket).toBe('sock-host-2');
      expect((recovered!.payload as { code: string }).code).toBe(code);

      // Advance close to TTL but still below it — room should still exist.
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Recovering again should succeed (room still alive). If the
      // room should still be present until TTL expiry.
      emitted.length = 0;
      service.recoverRoom('host1', hostSocket2, code);
      const secondRecover = emitted.find((e) => e.event === 'room-recovered');
      const expired = emitted.find(
        (e) =>
          e.event === 'room-error' &&
          (e.payload as { message: string }).message === 'Room expired',
      );
      expect(secondRecover).toBeDefined();
      expect(expired).toBeUndefined();

      // guestSocket is referenced but not used after mock-io simplification;
      // keep it allocated so the test structure stays self-documenting.
      void guestSocket;

      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should emit room-expired on the recovered host socket, not the original (unit)', async () => {
    // Regression guard: the TTL callback used to fire `socket.emit(...)`
    // on the socket captured at createRoom() time. After the host rebound
    // via room-recover that socket is dead, so the real host would never
    // see the expiry. The fix looks the room back up at expiry time and
    // emits on its *current* hostSocket.
    const { PrivateRoomService } = await import(
      '../src/services/PrivateRoomService.js'
    );
    const { validateConfig } = await import('../src/config/validation.js');

    const config = validateConfig({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 0,
      tickRate: 20,
      cors: { origin: '*' },
    });

    const fakeIo = {} as unknown as import('socket.io').Server;
    const emitted: Array<{
      socket: string;
      event: string;
      payload: unknown;
    }> = [];
    const makeSocket = (id: string) =>
      ({
        id,
        data: {},
        emit: (event: string, payload: unknown) => {
          emitted.push({ socket: id, event, payload });
          return true;
        },
      }) as unknown as import('socket.io').Socket;

    const hostSocket1 = makeSocket('sock-host-1');
    const hostSocket2 = makeSocket('sock-host-2');

    vi.useFakeTimers();
    try {
      const service = new PrivateRoomService(
        fakeIo,
        config,
        () => undefined,
        () => config,
      );

      service.createRoom('host1', 'Host', hostSocket1);
      const code = (
        emitted.find((e) => e.event === 'room-created')!.payload as {
          code: string;
        }
      ).code;

      // Host drops and immediately reconnects on a fresh socket.
      service.handleDisconnect(hostSocket1.id);
      service.recoverRoom('host1', hostSocket2, code);

      // Clear out the setup events so the next assertion is unambiguous.
      emitted.length = 0;

      // Fast-forward past the 5-minute TTL. The room-expired event must
      // arrive on sock-host-2 (current), never on sock-host-1 (original).
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const expired = emitted.filter((e) => e.event === 'room-expired');
      expect(expired).toHaveLength(1);
      expect(expired[0]!.socket).toBe('sock-host-2');

      const expiredOnOriginal = emitted.find(
        (e) => e.event === 'room-expired' && e.socket === 'sock-host-1',
      );
      expect(expiredOnOriginal).toBeUndefined();

      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Regression suite for the "host countdown freezes on 3" bug:
 *
 * 1. Player 1 creates a private room.
 * 2. Their mobile browser suspends the WebSocket while they switch to a
 *    messenger to share the invite link.
 * 3. Player 2 joins — match is created, countdown starts on the guest.
 * 4. Player 1 returns and issues room-recover.
 *
 * Prior to the snapshot fields on `reconnect-state`, the host had no
 * way to catch up on countdown ticks they missed while offline: the
 * 1Hz `countdown` broadcast was fire-and-forget, and `game-start`
 * (once fired) was never re-broadcast, leaving the host's UI stuck
 * on the last number they saw and never transitioning into the game.
 *
 * These tests exercise the server side of that fix. The client side
 * is covered separately by `phalanx-client/tests/private-room.test.ts`.
 *
 * A fresh `describe` block is used (rather than parameterising the
 * main suite) because the main suite runs with `countdownSeconds: 0`
 * — which skips the countdown phase entirely — and these tests must
 * observe the countdown while it is still in flight.
 */
describe('PrivateRoomService — host countdown recovery (snapshot)', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3400;

  beforeEach(async () => {
    server = new Phalanx({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      // Intentionally long: we want to observe the countdown mid-flight
      // without racing the 1Hz broadcast's own completion.
      countdownSeconds: 5,
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

  it('defers match-found and countdown for the guest when the host is offline at join time', async () => {
    const host = createClient();
    await connectClient(host);
    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    // Host's socket dies before the guest joins — the room survives
    // because of the grace-period timer.
    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Guest joins while host is offline. Under the new
    // wait-for-all-players design the match must NOT race ahead with
    // a countdown — guest should instead see
    // `match-waiting-for-players` and no `countdown` events until the
    // host comes back.
    const guest = createClient();
    await connectClient(guest);

    const waitingForPromise = new Promise<{
      matchId: string;
      missingPlayerIds: string[];
    }>((resolve) => {
      guest.on('match-waiting-for-players', resolve);
    });
    let countdownReceived = false;
    guest.on('countdown', () => {
      countdownReceived = true;
    });

    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });

    const waiting = await waitingForPromise;
    expect(waiting.matchId).toBeDefined();
    expect(waiting.missingPlayerIds).toContain('host1');
    // Give the server enough wall-clock time for a hypothetical
    // countdown tick to slip through, then assert silence.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(countdownReceived).toBe(false);

    // Host recovers — now we expect countdown to begin and match-found
    // to land on the host as if they'd been present from the start.
    const host2 = createClient();
    await connectClient(host2);
    const hostMatchFoundPromise = new Promise<{ matchId: string }>(
      (resolve) => {
        host2.on('match-found', resolve);
      },
    );
    const hostCountdownPromise = new Promise<{ seconds: number }>((resolve) => {
      host2.on('countdown', resolve);
    });
    host2.emit('room-recover', {
      playerId: 'host1',
      username: 'Host',
      code: created.code,
    });

    const hostMatchFound = await hostMatchFoundPromise;
    expect(hostMatchFound.matchId).toBe(waiting.matchId);
    const hostCountdown = await hostCountdownPromise;
    expect(hostCountdown.seconds).toBeGreaterThan(0);
    expect(hostCountdown.seconds).toBeLessThanOrEqual(5);
  });

  it('completes the deferred match end-to-end once both players are present', async () => {
    const host = createClient();
    await connectClient(host);
    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const guest = createClient();
    await connectClient(guest);
    const guestGameStartPromise = new Promise<{ randomSeed: number }>(
      (resolve) => {
        guest.on('game-start', resolve);
      },
    );
    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });

    // Host returns; the deferred match must now actually run through
    // its countdown to game-start, and the guest's seed must agree
    // with the host's so determinism survives the recovery handoff.
    const host2 = createClient();
    await connectClient(host2);
    const hostGameStartPromise = new Promise<{ randomSeed: number }>(
      (resolve) => {
        host2.on('game-start', resolve);
      },
    );
    host2.emit('room-recover', {
      playerId: 'host1',
      username: 'Host',
      code: created.code,
    });

    const guestStart = await guestGameStartPromise;
    const hostStart = await hostGameStartPromise;
    expect(hostStart.randomSeed).toBe(guestStart.randomSeed);
  });

  it('keeps a private match recoverable when host disconnects during waiting-for-ready', async () => {
    await server.stop();
    server = new Phalanx({
      port: TEST_PORT,
      matchmakingIntervalMs: 100,
      gameMode: '1v1',
      countdownSeconds: 0,
      tickRate: 20,
      readyTimeoutMs: 100,
      playersConnectTimeoutMs: 2000,
      cors: { origin: '*' },
    });
    await server.start();

    const host = createClient();
    const guest = createClient();
    await connectClient(host);
    await connectClient(guest);

    const createdPromise = new Promise<RoomCreatedEvent>((resolve) => {
      host.on('room-created', (data: RoomCreatedEvent) => resolve(data));
    });
    host.emit('room-create', { playerId: 'host1', username: 'Host' });
    const created = await createdPromise;

    const hostGameStartPromise = new Promise<{ matchId: string }>((resolve) => {
      host.on('game-start', resolve);
    });
    guest.emit('room-join', {
      playerId: 'guest1',
      username: 'Guest',
      code: created.code,
    });
    const hostGameStart = await hostGameStartPromise;
    expect(hostGameStart.matchId).toBeDefined();

    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const host2 = createClient();
    await connectClient(host2);
    const recoveredPromise = new Promise<RoomRecoveredEvent>((resolve) => {
      host2.on('room-recovered', resolve);
    });
    const reconnectStatePromise = new Promise<{ matchId: string; state: string; gameStartEmitted?: boolean }>(
      (resolve) => {
        host2.on('reconnect-state', resolve);
      },
    );
    host2.emit('room-recover', {
      playerId: 'host1',
      username: 'Host',
      code: created.code,
    });

    const recovered = await recoveredPromise;
    const reconnectState = await reconnectStatePromise;
    expect(recovered.code).toBe(created.code);
    expect(reconnectState.matchId).toBe(hostGameStart.matchId);
    expect(reconnectState.state).toBe('waiting-for-ready');
    expect(reconnectState.gameStartEmitted).toBe(true);
  });
});
