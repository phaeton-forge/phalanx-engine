import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { PhalanxConfig, QueuedPlayer } from '../types/index.js';
import { GameRoom } from './GameRoom.js';

/**
 * Represents a private room waiting for a second player.
 */
interface PrivateRoom {
  readonly code: string;
  readonly host: QueuedPlayer;
  readonly hostSocket: Socket;
  readonly gameType: string;
  readonly createdAt: number;
}

/** Event sent to the host when a room is created. */
export interface RoomCreatedEvent {
  code: string;
}

/** Event sent when a room join fails. */
export interface RoomErrorEvent {
  message: string;
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
  private readonly io: SocketIOServer;
  private readonly config: PhalanxConfig;
  private readonly eventEmitter: (event: string, ...args: unknown[]) => boolean | void;
  private readonly resolveGameTypeConfig: (gameType: string) => PhalanxConfig;

  /** TTL for rooms in ms (5 minutes). */
  private static readonly ROOM_TTL_MS = 5 * 60 * 1000;

  constructor(
    io: SocketIOServer,
    config: PhalanxConfig,
    eventEmitter: (event: string, ...args: unknown[]) => boolean | void,
    resolveGameTypeConfig: (gameType: string) => PhalanxConfig,
  ) {
    this.io = io;
    this.config = config;
    this.eventEmitter = eventEmitter;
    this.resolveGameTypeConfig = resolveGameTypeConfig;
  }

  /**
   * Create a private room for the given host player.
   */
  createRoom(
    playerId: string,
    username: string,
    socket: Socket,
    gameType?: string,
  ): void {
    // Prevent duplicate rooms per player
    for (const room of this.rooms.values()) {
      if (room.host.playerId === playerId) {
        socket.emit('room-error', { message: 'You already have an active room' } satisfies RoomErrorEvent);
        return;
      }
    }

    const code = this.generateCode();
    const resolvedGameType = gameType ?? 'default';

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
      gameType: resolvedGameType,
      createdAt: Date.now(),
    };

    this.rooms.set(code, room);

    socket.emit('room-created', { code } satisfies RoomCreatedEvent);
    console.log(`[PrivateRoom] Room ${code} created by ${playerId}`);

    // Auto-expire room after TTL
    setTimeout(() => {
      if (this.rooms.has(code)) {
        this.rooms.delete(code);
        socket.emit('room-expired', { code });
        console.log(`[PrivateRoom] Room ${code} expired`);
      }
    }, PrivateRoomService.ROOM_TTL_MS);
  }

  /**
   * Join an existing private room, creating a match immediately.
   */
  joinRoom(
    playerId: string,
    username: string,
    socket: Socket,
    code: string,
  ): void {
    const room = this.rooms.get(code.toUpperCase());

    if (!room) {
      socket.emit('room-error', { message: 'Room not found' } satisfies RoomErrorEvent);
      return;
    }

    if (room.host.playerId === playerId) {
      socket.emit('room-error', { message: 'Cannot join your own room' } satisfies RoomErrorEvent);
      return;
    }

    // Remove room — it's now consumed
    this.rooms.delete(code.toUpperCase());

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
      room.gameType,
    );

    this.matches.set(matchId, gameRoom);
    this.eventEmitter('match-created', gameRoom.getMatchInfo());
    gameRoom.start();

    console.log(`[PrivateRoom] Room ${code} → match ${matchId} (${room.host.playerId} vs ${playerId})`);
  }

  /**
   * Cancel a room that the player previously created.
   */
  cancelRoom(playerId: string, socket: Socket): void {
    for (const [code, room] of this.rooms) {
      if (room.host.playerId === playerId) {
        this.rooms.delete(code);
        socket.emit('room-cancelled', { code });
        console.log(`[PrivateRoom] Room ${code} cancelled by ${playerId}`);
        return;
      }
    }
  }

  /**
   * Handle socket disconnect — clean up rooms owned by this socket.
   */
  handleDisconnect(socketId: string): void {
    for (const [code, room] of this.rooms) {
      if (room.host.socketId === socketId) {
        this.rooms.delete(code);
        console.log(`[PrivateRoom] Room ${code} removed (host disconnected)`);
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
   * Stop all active matches and clear rooms.
   */
  stop(): void {
    for (const match of this.matches.values()) {
      match.stop();
    }
    this.matches.clear();
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

