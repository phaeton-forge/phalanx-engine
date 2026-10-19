import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  RoomCancelledEvent,
  RoomCreatedEvent,
  RoomErrorEvent,
  RoomExpiredEvent,
  RoomRecoveredEvent,
} from '@phalanx-engine/protocol';
import type { PhalanxConfig, QueuedPlayer } from '../types/index.js';
import {
  fillHumanSlot,
  parseServerMatch,
  type PreparedServerMatch,
} from '../sim/serverMatch.js';
import type { RegisteredGame } from '../sim/loadGames.js';
import { reservedPlayerMessage } from '../reservedPlayerId.js';
import { GameRoom } from './GameRoom.js';

export type {
  RoomCreatedEvent,
  RoomErrorEvent,
  RoomRecoveredEvent,
} from '@phalanx-engine/protocol';

/**
 * Represents a private room waiting for a second player.
 *
 * The host socket may be temporarily `null` if the host disconnects —
 * e.g. a mobile browser killing the WebSocket when the user switches
 * to another app to share the invite link. In that case the room stays
 * alive until normal room TTL expiry (or explicit cancel / consumption
 * by `room-join`), and the host can reconnect via `room-recover`.
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
  /** Set when `room-create` asked for a server match that still needs humans. */
  serverMatch?: PreparedServerMatch;
}

export interface CreateDisconnectedHostRoomResult extends RoomCreatedEvent {
  reused: boolean;
}

/**
 * PrivateRoomService — manages private room creation and joining.
 *
 * When a second player joins a room, the service creates a GameRoom
 * (bypassing the matchmaking queue) and starts the match. The GameRoom
 * itself is responsible for deferring the countdown if any of the
 * players is currently disconnected — the service merely hands it the
 * teams and lets it decide.
 */
export class PrivateRoomService {
  private readonly rooms: Map<string, PrivateRoom> = new Map();
  private readonly matches: Map<string, GameRoom> = new Map();
  /**
   * Reverse index: original room code → matchId. Lets a disconnected
   * participant (host or guest) recover into the running/deferred
   * match by presenting the room code they joined with, since neither
   * side may yet know the `matchId` (the host never received
   * `match-found` if the match is still deferred; the guest may also
   * have disconnected before reading it). The code is also our
   * authentication token for the recover — possession of the code is
   * what proves the caller is a legitimate participant in this match.
   *
   * Cleared in `removeMatch` so a finished match can't leak into a
   * future room reusing the same code (the code generator avoids
   * collisions for active rooms but a freshly generated code that
   * happens to match a long-finished one wouldn't).
   */
  private readonly matchByOriginalCode: Map<string, string> = new Map();
  private readonly originalCodeByMatch: Map<string, string> = new Map();
  private readonly io: SocketIOServer;
  private readonly config: PhalanxConfig;
  private readonly eventEmitter: (
    event: string,
    ...args: unknown[]
  ) => boolean | void;
  private readonly resolveGameTypeConfig: (gameType: string) => PhalanxConfig;
  private readonly isPlayerQueued?: (playerId: string) => boolean;
  private serverCatalog: readonly RegisteredGame[] = [];
  private serverMatchCount = 0;
  private maxServerMatches: number | undefined;
  /** False after the sim worker has died. */
  private simAvailable: (() => boolean) | null = null;
  /** Called once the GameRoom exists and before `start()`. */
  private attachServerMatch:
    ((room: GameRoom, prepared: PreparedServerMatch) => void) | null = null;

  /** TTL for rooms in ms (5 minutes). */
  private static readonly ROOM_TTL_MS = 5 * 60 * 1000;

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
   * Install the server-sim catalog. Absent means `matchConfig` is rejected
   * and ordinary rooms are unchanged.
   */
  setServerSim(options: {
    catalog: readonly RegisteredGame[];
    maxMatches?: number;
    available: () => boolean;
    attach: (room: GameRoom, prepared: PreparedServerMatch) => void;
  }): void {
    this.serverCatalog = options.catalog;
    this.maxServerMatches = options.maxMatches;
    this.simAvailable = options.available;
    this.attachServerMatch = options.attach;
  }

  /** Drop a reserved server match when its room ends. */
  releaseServerMatch(): void {
    if (this.serverMatchCount > 0) this.serverMatchCount -= 1;
  }

  /**
   * Create a private room for the given host player.
   */
  createRoom(
    playerId: string,
    username: string,
    socket: Socket,
    gameType?: string,
    buildId?: string,
    matchConfig?: unknown
  ): void {
    const reserved = reservedPlayerMessage(playerId);
    if (reserved !== null) {
      socket.emit('room-error', {
        message: reserved,
      } satisfies RoomErrorEvent);
      return;
    }

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

    const resolvedGameType = gameType ?? 'default';
    if (matchConfig !== undefined) {
      this.createServerRoom(
        playerId,
        username,
        socket,
        resolvedGameType,
        buildId,
        matchConfig
      );
      return;
    }

    const code = this.generateCode();

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
        expired.hostSocket?.emit('room-expired', {
          code,
        } satisfies RoomExpiredEvent);
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
        ...(buildId !== undefined ? { buildId } : {}),
      },
      hostSocket: socket,
      hostSocketId: socket.id,
      gameType: resolvedGameType,
      createdAt: Date.now(),
      expirationTimer,
    };

    this.rooms.set(code, room);

    socket.emit('room-created', { code } satisfies RoomCreatedEvent);
    console.log(`[PrivateRoom] Room ${code} created by ${playerId}`);
  }

  /**
   * Create a private room for a host that is not connected over Socket.IO yet.
   * Used by out-of-band integrations such as Telegram bot commands: the bot
   * creates a room, shares the code, and the host later reclaims it via
   * `room-recover` from the Mini App using the same deterministic playerId.
   */
  createRoomForDisconnectedHost(
    playerId: string,
    username: string,
    gameType?: string
  ): CreateDisconnectedHostRoomResult {
    const reserved = reservedPlayerMessage(playerId);
    if (reserved !== null) {
      throw new Error(reserved);
    }

    if (this.isPlayerQueued?.(playerId)) {
      throw new Error('Already in matchmaking queue');
    }

    for (const match of this.matches.values()) {
      if (match.hasPlayer(playerId)) {
        throw new Error('Already in a match');
      }
    }

    for (const room of this.rooms.values()) {
      if (room.host.playerId === playerId) {
        return { code: room.code, reused: true };
      }
    }

    const code = this.generateCode();
    const resolvedGameType = gameType ?? 'default';

    const expirationTimer = setTimeout(() => {
      const expired = this.rooms.get(code);
      if (expired) {
        this.removeRoom(code);
        expired.hostSocket?.emit('room-expired', {
          code,
        } satisfies RoomExpiredEvent);
        console.log(`[PrivateRoom] Room ${code} expired`);
      }
    }, PrivateRoomService.ROOM_TTL_MS);

    const room: PrivateRoom = {
      code,
      host: {
        playerId,
        username,
        socketId: '',
        joinedAt: Date.now(),
        gameType: resolvedGameType,
      },
      hostSocket: null,
      hostSocketId: '',
      gameType: resolvedGameType,
      createdAt: Date.now(),
      expirationTimer,
    };

    this.rooms.set(code, room);

    console.log(
      `[PrivateRoom] Room ${code} created by disconnected host ${playerId}`
    );
    return { code, reused: false };
  }

  /**
   * Join an existing private room, creating a match.
   *
   * The match is always created and started immediately, but
   * `GameRoom.start()` itself defers the countdown if any player
   * (host OR guest) is currently disconnected — it'll emit
   * `match-waiting-for-players` to whoever is online and only kick
   * off the countdown once everyone reconnects. So the call sites
   * here don't need to special-case an offline host any more.
   */
  joinRoom(
    playerId: string,
    username: string,
    socket: Socket,
    code: string,
    buildId?: string
  ): void {
    const reserved = reservedPlayerMessage(playerId);
    if (reserved !== null) {
      socket.emit('room-error', {
        message: reserved,
      } satisfies RoomErrorEvent);
      return;
    }

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

    const normalizedCode = code.toUpperCase();
    const room = this.rooms.get(normalizedCode);

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

    if (room.serverMatch) {
      this.joinServerRoom(
        room,
        normalizedCode,
        playerId,
        username,
        socket,
        buildId
      );
      return;
    }

    // Remove room — it's now consumed
    this.removeRoom(normalizedCode);

    const guest: QueuedPlayer = {
      playerId,
      username,
      socketId: socket.id,
      joinedAt: Date.now(),
      gameType: room.gameType,
      ...(buildId !== undefined ? { buildId } : {}),
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
    this.matchByOriginalCode.set(normalizedCode, matchId);
    this.originalCodeByMatch.set(matchId, normalizedCode);
    this.eventEmitter('match-created', gameRoom.getMatchInfo());
    // GameRoom decides whether to start the countdown right away or
    // emit `match-waiting-for-players` and wait for reconnects.
    gameRoom.start();

    console.log(
      `[PrivateRoom] Room ${code} → match ${matchId} (${room.host.playerId} vs ${playerId})`
    );
  }

  private createServerRoom(
    playerId: string,
    username: string,
    socket: Socket,
    gameType: string,
    buildId: string | undefined,
    matchConfig: unknown
  ): void {
    const host: QueuedPlayer = {
      playerId,
      username,
      socketId: socket.id,
      joinedAt: Date.now(),
      gameType,
      kind: 'human',
      ...(buildId !== undefined ? { buildId } : {}),
    };
    const parsed = parseServerMatch({
      raw: matchConfig,
      host,
      gameType,
      catalog: this.serverCatalog,
      config: this.resolveGameTypeConfig(gameType),
    });
    if (!parsed.ok) {
      socket.emit('room-error', {
        message: parsed.message,
      } satisfies RoomErrorEvent);
      return;
    }
    if (this.simAvailable !== null && !this.simAvailable()) {
      socket.emit('room-error', {
        message: 'Server simulation is unavailable',
        reason: 'sim-unavailable',
      } satisfies RoomErrorEvent);
      return;
    }
    if (!this.reserveServerMatch()) {
      socket.emit('room-error', {
        message: 'Server match capacity reached',
      } satisfies RoomErrorEvent);
      return;
    }
    if (parsed.prepared.waitingHumanIds.length > 0) {
      const code = this.generateCode();
      const expirationTimer = setTimeout(() => {
        const expired = this.rooms.get(code);
        if (expired) {
          this.removeRoom(code);
          expired.hostSocket?.emit('room-expired', {
            code,
          } satisfies RoomExpiredEvent);
        }
      }, PrivateRoomService.ROOM_TTL_MS);
      const room: PrivateRoom = {
        code,
        host,
        hostSocket: socket,
        hostSocketId: socket.id,
        gameType,
        createdAt: Date.now(),
        expirationTimer,
        serverMatch: parsed.prepared,
      };
      this.rooms.set(code, room);
      socket.emit('room-created', { code } satisfies RoomCreatedEvent);
      return;
    }
    this.beginPreparedMatch(parsed.prepared, gameType);
  }

  /** Count a server match. False when `maxMatches` is already taken. */
  private reserveServerMatch(): boolean {
    if (
      this.maxServerMatches !== undefined &&
      this.serverMatchCount >= this.maxServerMatches
    ) {
      return false;
    }
    this.serverMatchCount += 1;
    return true;
  }

  private joinServerRoom(
    room: PrivateRoom,
    code: string,
    playerId: string,
    username: string,
    socket: Socket,
    buildId: string | undefined
  ): void {
    const prepared = room.serverMatch;
    if (prepared === undefined) return;
    if (this.simAvailable !== null && !this.simAvailable()) {
      this.removeRoom(code);
      socket.emit('room-error', {
        message: 'Server simulation is unavailable',
        reason: 'sim-unavailable',
      } satisfies RoomErrorEvent);
      return;
    }
    const guest: QueuedPlayer = {
      playerId,
      username,
      socketId: socket.id,
      joinedAt: Date.now(),
      gameType: room.gameType,
      kind: 'human',
      ...(buildId !== undefined ? { buildId } : {}),
    };
    const filled = fillHumanSlot(prepared, guest);
    if (typeof filled === 'string') {
      socket.emit('room-error', { message: filled } satisfies RoomErrorEvent);
      return;
    }
    room.serverMatch = filled;
    if (filled.waitingHumanIds.length > 0) return;
    this.removeRoom(code, false);
    this.beginPreparedMatch(filled, room.gameType, code);
  }

  private beginPreparedMatch(
    prepared: PreparedServerMatch,
    gameType: string,
    code?: string
  ): void {
    const resolvedConfig = this.resolveGameTypeConfig(gameType);
    const matchId = `match-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const gameRoom = new GameRoom(
      matchId,
      this.io,
      resolvedConfig,
      prepared.teams,
      this.eventEmitter,
      gameType
    );
    this.matches.set(matchId, gameRoom);
    if (code !== undefined) {
      this.matchByOriginalCode.set(code, matchId);
      this.originalCodeByMatch.set(matchId, code);
    }
    this.attachServerMatch?.(gameRoom, prepared);
    this.eventEmitter('match-created', gameRoom.getMatchInfo());
    gameRoom.start();
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
        socket.emit('room-cancelled', { code } satisfies RoomCancelledEvent);
        console.log(`[PrivateRoom] Room ${code} cancelled by ${playerId}`);
        return;
      }
    }
  }

  /**
   * Recover a room or match after a participant's socket disconnected.
   *
   * The caller must present the room `code` along with the `playerId` —
   * possession of the code is what authenticates them in the
   * anonymous-socket case. Without that check, any client that knew
   * (or guessed) a participant's `playerId` could reclaim their room
   * and learn its invite code (or worse, a match in progress).
   *
   * Three cases, tried in order:
   *
   *   1. The code maps to a still-waiting room and `playerId` is the
   *      host — re-bind the host's socket to the room (existing
   *      "waiting for guest" flow).
   *
   *   2. The code maps to a match (deferred or running) and `playerId`
   *      is one of its participants — rebind via
   *      `GameRoom.handleReconnect`. If the match was deferred and
   *      everyone is now connected, the GameRoom will start its
   *      countdown; otherwise it'll deliver a `reconnect-state`
   *      snapshot for an in-flight match. Either way the caller gets
   *      `room-recovered` so their UI can transition out of the
   *      "trying to recover" state.
   *
   *   3. None of the above — `room-error: "Room expired"`.
   *
   * Returns `true` on success, `false` on failure.
   */
  recoverRoom(playerId: string, socket: Socket, code: string): boolean {
    const reserved = reservedPlayerMessage(playerId);
    if (reserved !== null) {
      socket.emit('room-error', {
        message: reserved,
      } satisfies RoomErrorEvent);
      return false;
    }

    const normalizedCode = code.toUpperCase();

    // Case 1: live room, caller is the host.
    const room = this.rooms.get(normalizedCode);
    if (room && room.host.playerId === playerId) {
      room.hostSocket = socket;
      room.hostSocketId = socket.id;
      // Keep QueuedPlayer.socketId in sync so a guest joining now
      // wires GameRoom up to the host's *current* socket.
      room.host.socketId = socket.id;
      socket.emit('room-recovered', {
        code: room.code,
      } satisfies RoomRecoveredEvent);
      console.log(`[PrivateRoom] Room ${room.code} recovered by ${playerId}`);
      return true;
    }

    // Case 2: code belongs to a match in progress / deferred and
    // caller is a participant. We use the original room code as the
    // authentication token — same posture as Case 1 and the previous
    // `pendingHostReconnect` path: an attacker who guesses only a
    // playerId cannot harvest the match without also guessing the code.
    const matchId = this.matchByOriginalCode.get(normalizedCode);
    if (matchId) {
      const match = this.matches.get(matchId);
      if (match && match.hasPlayer(playerId)) {
        // Task 9. Waiting-room recover (case 1) is unchanged. A
        // player who was offline at `match-found` is still in
        // `waiting-for-players` and has no token yet: `room-recover`
        // stays open so `handleReconnect` can send the retro
        // `match-found` and the first token. Once the match has left
        // that state, an in-match rebind must present a session
        // token when the flag is on.
        if (
          this.config.reconnect?.requireSessionToken === true &&
          match.getMatchInfo().state !== 'waiting-for-players'
        ) {
          socket.emit('room-error', {
            message: 'session-token-required',
            reason: 'session-token-required',
          } satisfies RoomErrorEvent);
          return false;
        }
        socket.emit('room-recovered', {
          code: normalizedCode,
        } satisfies RoomRecoveredEvent);
        match.handleReconnect(playerId, socket.id);
        console.log(
          `[PrivateRoom] Player ${playerId} recovered into match ${matchId} via code ${normalizedCode}`
        );
        return true;
      }
      // Stale index entry — clean it up rather than letting it
      // accumulate forever for a long-dead match.
      if (!match) {
        this.matchByOriginalCode.delete(normalizedCode);
        this.originalCodeByMatch.delete(matchId);
      }
    }

    // Case 3: nothing matched. Use the same generic error message
    // for "no such code", "wrong playerId", and "match already gone"
    // so an attacker can't distinguish them.
    socket.emit('room-error', {
      message: 'Room expired',
    } satisfies RoomErrorEvent);
    return false;
  }

  /**
   * Handle socket disconnect. For waiting private rooms we keep the room
   * alive and only mark the host socket as temporarily unavailable, so
   * mobile backgrounding does not destroy share-link rooms.
   */
  handleDisconnect(socketId: string): void {
    for (const [code, room] of this.rooms) {
      if (room.hostSocketId === socketId) {
        room.hostSocket = null;
        console.log(
          `[PrivateRoom] Host of room ${code} disconnected — room kept alive until TTL/cancel/join`
        );
      }
    }

    // Forward disconnect to private-room matches (this also drives
    // the deferral path: a guest disconnecting from a deferred match
    // marks them as not-connected so a host reconnect doesn't spuriously
    // start the countdown without the guest).
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
   */
  removeMatch(matchId: string): void {
    this.matches.delete(matchId);
    const code = this.originalCodeByMatch.get(matchId);
    if (code) {
      this.matchByOriginalCode.delete(code);
      this.originalCodeByMatch.delete(matchId);
    }
  }

  /**
   * Remove a room and clear its pending TTL timer.
   */
  private removeRoom(code: string, releaseReservation = true): void {
    const room = this.rooms.get(code);
    if (!room) return;
    clearTimeout(room.expirationTimer);
    this.rooms.delete(code);
    if (releaseReservation && room.serverMatch !== undefined) {
      this.releaseServerMatch();
    }
  }

  /**
   * Stop all active matches and clear rooms, including pending TTL timers.
   */
  stop(): void {
    for (const match of this.matches.values()) {
      match.stop();
    }
    this.matches.clear();
    this.matchByOriginalCode.clear();
    this.originalCodeByMatch.clear();
    for (const room of this.rooms.values()) {
      clearTimeout(room.expirationTimer);
      if (room.serverMatch !== undefined) this.releaseServerMatch();
    }
    this.rooms.clear();
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
