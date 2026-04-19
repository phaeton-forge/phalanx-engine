import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  PhalanxConfig,
  QueuedPlayer,
  RoomCreatedEvent,
  RoomRecoveredEvent,
  RoomErrorEvent,
} from '../types/index.js';
import { GameRoom } from './GameRoom.js';

// Re-export private-room event types from this module for backward
// compatibility — callers (and existing tests) historically import them
// from `services/PrivateRoomService.js`.
export type { RoomCreatedEvent, RoomRecoveredEvent, RoomErrorEvent };

/**
 * Represents a private room waiting for a second player.
 *
 * The host socket may be temporarily `null` if the host disconnects —
 * e.g. a mobile browser killing the WebSocket when the user switches
 * to another app to share the invite link. In that case the room
 * survives for `HOST_DISCONNECT_GRACE_MS` so the host can reconnect
 * via `room-recover` and reclaim it.
 */
interface PrivateRoom {
  readonly code: string;
  readonly host: QueuedPlayer;
  /** Current host socket; null while the host is disconnected. */
  hostSocket: Socket | null;
  /** Tracked separately from the socket object because hostSocket may be null. */
  hostSocketId: string;
  readonly gameType: string;
  readonly createdAt: number;
  expirationTimer: ReturnType<typeof setTimeout>;
  /** Pending grace-period timer set when the host disconnects. */
  hostDisconnectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * PrivateRoomService — manages private room creation and joining.
 *
 * When a second player joins a room, the service creates a GameRoom
 * (bypassing the matchmaking queue) and starts the match.
 */
export class PrivateRoomService {
  private readonly rooms: Map<string, PrivateRoom> = new Map();
  private readonly matches: Map<string, GameRoom> = new Map();
  /**
   * Matches whose host was still disconnected at the moment a guest
   * joined their room. The host never received `match-found` because
   * their socket was null at `joinRoom` time, so we remember the
   * `matchId` — and the *original* room code the host must present
   * to claim it — keyed by the host's `playerId`, and deliver it
   * when the host finally reconnects via `room-recover`.
   *
   * Storing the code alongside the matchId lets the recovery fallback
   * keep the same security posture as the live-room path: an attacker
   * who only knows a host's `playerId` cannot harvest the code by
   * guessing, because the fallback also refuses to promote a socket
   * into the match unless the caller presents the matching code.
   *
   * Entries are purged when the match ends (see `removeMatch`), so a
   * dead match can't leak through an indefinite pending-recover entry.
   */
  private readonly pendingHostReconnect: Map<
    string,
    { matchId: string; code: string }
  > = new Map();
  private readonly io: SocketIOServer;
  private readonly config: PhalanxConfig;
  private readonly eventEmitter: (
    event: string,
    ...args: unknown[]
  ) => boolean | void;
  private readonly resolveGameTypeConfig: (gameType: string) => PhalanxConfig;
  private readonly isPlayerQueued?: (playerId: string) => boolean;

  /** TTL for rooms in ms (5 minutes). */
  private static readonly ROOM_TTL_MS = 5 * 60 * 1000;

  /** How long a room survives after the host disconnects, in ms (2 minutes). */
  private static readonly HOST_DISCONNECT_GRACE_MS = 2 * 60 * 1000;

  constructor(
    io: SocketIOServer,
    config: PhalanxConfig,
    eventEmitter: (event: string, ...args: unknown[]) => boolean | void,
    resolveGameTypeConfig: (gameType: string) => PhalanxConfig,
    isPlayerQueued?: (playerId: string) => boolean
  ) {
    this.io = io;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.resolveGameTypeConfig = resolveGameTypeConfig;
    this.isPlayerQueued = isPlayerQueued;
  }

  /**
   * Create a private room for the given host player.
   */
  createRoom(
    playerId: string,
    username: string,
    socket: Socket,
    gameType?: string
  ): void {
    // Reject if player is already in a match
    if ((socket.data as { matchId?: string }).matchId) {
      socket.emit('room-error', {
        message: 'Already in a match',
      } satisfies RoomErrorEvent);
      return;
    }

    // Reject if player is currently queued in matchmaking
    if (this.isPlayerQueued?.(playerId)) {
      socket.emit('room-error', {
        message: 'Already in matchmaking queue',
      } satisfies RoomErrorEvent);
      return;
    }

    // Prevent duplicate rooms per player
    for (const room of this.rooms.values()) {
      if (room.host.playerId === playerId) {
        socket.emit('room-error', {
          message: 'You already have an active room',
        } satisfies RoomErrorEvent);
        return;
      }
    }

    const code = this.generateCode();
    const resolvedGameType = gameType ?? 'default';

    // Auto-expire room after TTL.
    //
    // Look the room back up inside the timer and emit on its *current*
    // host socket rather than the one captured at creation time, because
    // the host may have reconnected on a new socket via `room-recover`
    // before the TTL elapsed. If the host is disconnected at the moment
    // of expiry, there's simply no one to notify — that's fine.
    const expirationTimer = setTimeout(() => {
      const expired = this.rooms.get(code);
      if (expired) {
        this.removeRoom(code);
        expired.hostSocket?.emit('room-expired', { code });
        console.log(`[PrivateRoom] Room ${code} expired`);
      }
    }, PrivateRoomService.ROOM_TTL_MS);

    const room: PrivateRoom = {
      code,
      host: {
        playerId,
        username,
        socketId: socket.id,
        joinedAt: Date.now(),
        gameType: resolvedGameType,
      },
      hostSocket: socket,
      hostSocketId: socket.id,
      gameType: resolvedGameType,
      createdAt: Date.now(),
      expirationTimer,
      hostDisconnectTimer: null,
    };

    this.rooms.set(code, room);

    socket.emit('room-created', { code } satisfies RoomCreatedEvent);
    console.log(`[PrivateRoom] Room ${code} created by ${playerId}`);
  }

  /**
   * Join an existing private room, creating a match immediately.
   */
  joinRoom(
    playerId: string,
    username: string,
    socket: Socket,
    code: string
  ): void {
    // Reject if player is already in a match
    if ((socket.data as { matchId?: string }).matchId) {
      socket.emit('room-error', {
        message: 'Already in a match',
      } satisfies RoomErrorEvent);
      return;
    }

    // Reject if player is currently queued in matchmaking
    if (this.isPlayerQueued?.(playerId)) {
      socket.emit('room-error', {
        message: 'Already in matchmaking queue',
      } satisfies RoomErrorEvent);
      return;
    }

    const room = this.rooms.get(code.toUpperCase());

    if (!room) {
      socket.emit('room-error', {
        message: 'Room not found',
      } satisfies RoomErrorEvent);
      return;
    }

    if (room.host.playerId === playerId) {
      socket.emit('room-error', {
        message: 'Cannot join your own room',
      } satisfies RoomErrorEvent);
      return;
    }

    // Remove room — it's now consumed
    this.removeRoom(code.toUpperCase());

    const guest: QueuedPlayer = {
      playerId,
      username,
      socketId: socket.id,
      joinedAt: Date.now(),
      gameType: room.gameType,
    };

    // Build teams: host = team 0, guest = team 1
    const teams: QueuedPlayer[][] = [[room.host], [guest]];

    const resolvedConfig = this.resolveGameTypeConfig(room.gameType);
    const matchId = `match-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    const gameRoom = new GameRoom(
      matchId,
      this.io,
      resolvedConfig,
      teams,
      this.eventEmitter,
      room.gameType
    );

    this.matches.set(matchId, gameRoom);
    this.eventEmitter('match-created', gameRoom.getMatchInfo());
    gameRoom.start();

    // If the host was still in the disconnect grace window at the
    // moment the guest joined, `match-found` was emitted by GameRoom
    // but never reached them (their socket is null / dead). Record
    // the pairing so a subsequent `room-recover` on the host's new
    // socket can retroactively deliver match-found and wire the
    // socket into the running match.
    if (!room.hostSocket) {
      this.pendingHostReconnect.set(room.host.playerId, {
        matchId,
        code: room.code,
      });
      console.log(
        `[PrivateRoom] Host ${room.host.playerId} was offline when match ${matchId} started — pending recover`
      );
    }

    console.log(
      `[PrivateRoom] Room ${code} → match ${matchId} (${room.host.playerId} vs ${playerId})`
    );
  }

  /**
   * Cancel a room that the player previously created.
   *
   * Looks up by `playerId` (not `socketId`) so a host who reconnected with
   * a new socket after a disconnect can still cancel their own room.
   * `room-cancelled` is emitted on the socket that initiated the cancel.
   */
  cancelRoom(playerId: string, socket: Socket): void {
    for (const [code, room] of this.rooms) {
      if (room.host.playerId === playerId) {
        this.removeRoom(code);
        socket.emit('room-cancelled', { code });
        console.log(`[PrivateRoom] Room ${code} cancelled by ${playerId}`);
        return;
      }
    }
  }

  /**
   * Recover a room after the host's socket disconnected within the grace period.
   *
   * The caller must present the room `code` along with the `playerId` —
   * possession of the code is what authenticates the host in the
   * anonymous-socket case. Without that check, any client that knew
   * (or guessed) a host's `playerId` could reclaim their room and
   * learn its invite code, so `code` is required and must match.
   *
   * On success: clears the pending destruction timer, rebinds the
   * room to the host's new socket (updating both the service-level
   * `hostSocket`/`hostSocketId` and the matchmaking-level
   * `host.socketId` used by GameRoom to look up the host's socket),
   * and emits `room-recovered` on the new socket.
   *
   * If no matching room exists for this player (never created, or
   * grace period / TTL already elapsed) OR the code doesn't match
   * the stored room, emits `room-error: "Room expired"`. We use
   * the same message for both cases so we don't leak whether a
   * given playerId currently owns a room.
   *
   * Returns `true` on success and `false` on any failure, so the
   * Phalanx handler can gate updating the socket's captured
   * `playerId` on an authenticated recover.
   */
  recoverRoom(playerId: string, socket: Socket, code: string): boolean {
    // O(1) lookup by code (the map's key) rather than scanning every
    // room. The same 'Room expired' error is emitted whether the code
    // is unknown or the code is known but owned by a different player,
    // so an attacker who guesses a playerId can't tell a valid code
    // from an invalid one.
    const normalizedCode = code.toUpperCase();
    const room = this.rooms.get(normalizedCode);
    if (!room || room.host.playerId !== playerId) {
      // Fallback: the host's original room may already have been
      // consumed by a guest while the host was in the disconnect
      // grace window. In that case a match exists but the host never
      // learned its id. Promote the host into that match, but only
      // if they present the matching original room code — we must
      // not weaken authentication in the fallback path relative to
      // the live-room path, or an attacker who only knows a playerId
      // could harvest the match by guessing any code.
      const pending = this.pendingHostReconnect.get(playerId);
      if (pending && pending.code === normalizedCode) {
        const match = this.matches.get(pending.matchId);
        if (match) {
          this.pendingHostReconnect.delete(playerId);
          // `handleReconnect` wires the socket into the running match
          // and emits `reconnect-state` with the full match snapshot.
          // We also emit `match-found` so the client sees the same
          // event it would have seen had its socket been alive at
          // `joinRoom` time — keeps the client state machine simple.
          match.handleReconnect(playerId, socket.id);
          const matchFound = match.buildMatchFoundPayload(playerId);
          if (matchFound) {
            socket.emit('match-found', matchFound);
          }
          // Emit the *stored* room code, not the caller-provided one,
          // so a client that somehow drifted on casing still sees the
          // canonical value.
          socket.emit('room-recovered', {
            code: pending.code,
          } satisfies RoomRecoveredEvent);
          console.log(
            `[PrivateRoom] Host ${playerId} recovered into pending match ${pending.matchId}`
          );
          return true;
        }
        // Match vanished before recover — drop the stale entry and
        // fall through to the generic 'Room expired' response below.
        this.pendingHostReconnect.delete(playerId);
      }
      socket.emit('room-error', {
        message: 'Room expired',
      } satisfies RoomErrorEvent);
      return false;
    }

    if (room.hostDisconnectTimer) {
      clearTimeout(room.hostDisconnectTimer);
      room.hostDisconnectTimer = null;
    }
    room.hostSocket = socket;
    room.hostSocketId = socket.id;
    // Keep the QueuedPlayer.socketId in sync so that when a guest
    // later joins, GameRoom's socketId→playerId map and its
    // `io.sockets.sockets.get(player.socketId)` lookups resolve
    // to the host's *current* socket rather than the dead one.
    room.host.socketId = socket.id;
    socket.emit('room-recovered', {
      code: room.code,
    } satisfies RoomRecoveredEvent);
    console.log(`[PrivateRoom] Room ${room.code} recovered by ${playerId}`);
    return true;
  }

  /**
   * Handle socket disconnect — start a grace period during which the host
   * can reclaim their room via `room-recover`. This keeps the room alive
   * while the host opens a messenger to share the invite link on mobile,
   * since mobile browsers aggressively kill background WebSockets.
   *
   * The room is destroyed at whichever fires first: this grace timer
   * or the original TTL timer (`ROOM_TTL_MS`).
   */
  handleDisconnect(socketId: string): void {
    for (const [code, room] of this.rooms) {
      if (room.hostSocketId === socketId) {
        room.hostSocket = null;
        // Only start a grace timer if one isn't already running.
        // (Defensive; in practice a fresh disconnect won't have one.)
        if (!room.hostDisconnectTimer) {
          room.hostDisconnectTimer = setTimeout(() => {
            if (this.rooms.has(code)) {
              this.removeRoom(code);
              console.log(
                `[PrivateRoom] Room ${code} removed (host stayed disconnected)`
              );
            }
          }, PrivateRoomService.HOST_DISCONNECT_GRACE_MS);
        }
        console.log(
          `[PrivateRoom] Host of room ${code} disconnected — grace period started`
        );
      }
    }

    // Forward disconnect to private-room matches
    for (const match of this.matches.values()) {
      match.handleDisconnect(socketId);
    }
  }

  /**
   * Get a match created by this service (for command routing etc.)
   */
  getMatch(matchId: string): GameRoom | undefined {
    return this.matches.get(matchId);
  }

  /**
   * Get all active matches from private rooms.
   */
  getActiveMatches(): GameRoom[] {
    return Array.from(this.matches.values());
  }

  /**
   * Remove a finished match from the private matches map.
   * Called from the match-ended listener — the match already stopped itself.
   *
   * Also purges any pending host-reconnect entry that still points at
   * this match, so a host who never came back within the match's
   * lifetime can't later collide with a fresh room they create.
   */
  removeMatch(matchId: string): void {
    this.matches.delete(matchId);
    for (const [playerId, pending] of this.pendingHostReconnect) {
      if (pending.matchId === matchId) {
        this.pendingHostReconnect.delete(playerId);
      }
    }
  }

  /**
   * Remove a room and clear all of its pending timers (TTL and any
   * host-disconnect grace timer).
   */
  private removeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (room) {
      clearTimeout(room.expirationTimer);
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
      this.rooms.delete(code);
    }
  }

  /**
   * Stop all active matches and clear rooms, including any pending
   * TTL and host-disconnect grace timers.
   */
  stop(): void {
    for (const match of this.matches.values()) {
      match.stop();
    }
    this.matches.clear();
    for (const room of this.rooms.values()) {
      clearTimeout(room.expirationTimer);
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
    }
    this.rooms.clear();
    this.pendingHostReconnect.clear();
  }

  /**
   * Generate a 6-character uppercase alphanumeric room code.
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
    let code: string;
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }
}
