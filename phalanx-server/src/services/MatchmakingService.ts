import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  PhalanxConfig,
  QueuedPlayer,
  MatchInfo,
  QueueStatusEvent,
} from '../types/index.js';
import { resolveGameMode } from '../config/validation.js';
import { GameRoom } from './GameRoom.js';

/**
 * Matchmaking Service
 * Handles player queue and match creation with per-gameType queues
 */
export class MatchmakingService {
  /** Outer key = gameType (default: 'default'), inner key = playerId */
  private queues: Map<string, Map<string, QueuedPlayer>> = new Map();
  private matches: Map<string, GameRoom> = new Map();
  private matchmakingInterval: NodeJS.Timeout | null = null;
  private readonly config: PhalanxConfig;
  private readonly io: SocketIOServer;
  private readonly eventEmitter: (
    event: string,
    ...args: unknown[]
  ) => boolean | void;

  constructor(
    io: SocketIOServer,
    config: PhalanxConfig,
    eventEmitter: (event: string, ...args: unknown[]) => boolean | void
  ) {
    this.io = io;
    this.config = config;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Start the matchmaking service
   */
  start(): void {
    this.matchmakingInterval = setInterval(() => {
      this.tryCreateMatch();
    }, this.config.matchmakingIntervalMs);
  }

  /**
   * Stop the matchmaking service
   */
  stop(): void {
    if (this.matchmakingInterval) {
      clearInterval(this.matchmakingInterval);
      this.matchmakingInterval = null;
    }

    // Stop all active matches
    for (const match of this.matches.values()) {
      match.stop();
    }
    this.matches.clear();
    this.queues.clear();
  }

  /**
   * Get or create a sub-queue for the given game type
   */
  private getQueue(gameType: string): Map<string, QueuedPlayer> {
    let queue = this.queues.get(gameType);
    if (!queue) {
      queue = new Map();
      this.queues.set(gameType, queue);
    }
    return queue;
  }

  /**
   * Check if a player is already in any queue
   */
  private isInAnyQueue(playerId: string): boolean {
    for (const queue of this.queues.values()) {
      if (queue.has(playerId)) return true;
    }
    return false;
  }

  /**
   * Add a player to the matchmaking queue
   */
  joinQueue(playerId: string, username: string, socket: Socket, gameType?: string): void {
    // Check not already in any queue
    if (this.isInAnyQueue(playerId)) {
      socket.emit('error', { message: 'Already in queue' });
      return;
    }

    const resolvedGameType = gameType ?? 'default';
    const queue = this.getQueue(resolvedGameType);

    queue.set(playerId, {
      playerId,
      username,
      socketId: socket.id,
      joinedAt: Date.now(),
      gameType: resolvedGameType,
    });

    const position = queue.size;
    const waitTime = this.estimateWaitTime(resolvedGameType);

    socket.emit('queue-status', {
      position,
      waitTime,
    } as QueueStatusEvent);
  }

  /**
   * Estimate wait time in milliseconds for a specific game type queue
   */
  private estimateWaitTime(gameType: string): number {
    const resolvedConfig = this.resolveGameTypeConfig(gameType);
    const { playersPerMatch } = resolveGameMode(resolvedConfig.gameMode);
    const queue = this.queues.get(gameType);
    const queueSize = queue?.size ?? 0;

    // Estimate how many matchmaking cycles needed
    const cyclesNeeded = Math.ceil(queueSize / playersPerMatch);
    const estimatedMs = cyclesNeeded * this.config.matchmakingIntervalMs;

    // Minimum wait time is 1 second
    return Math.max(1000, estimatedMs);
  }

  /**
   * Remove a player from the matchmaking queue
   */
  leaveQueue(playerId: string, socket: Socket): void {
    for (const queue of this.queues.values()) {
      if (queue.has(playerId)) {
        queue.delete(playerId);
        socket.emit('queue-left');
        return;
      }
    }
    // Player not in queue - do nothing (no error per Story-2)
  }

  /**
   * Resolve configuration for a specific game type.
   * Merges matching gameTypes[] entry over the base config.
   */
  resolveGameTypeConfig(gameType: string): PhalanxConfig {
    const override = this.config.gameTypes?.find(
      (gt) => gt.gameType === gameType
    );
    if (!override) {
      return this.config;
    }
    return { ...this.config, ...override };
  }

  /**
   * Try to create matches from queued players (iterates all sub-queues)
   */
  private tryCreateMatch(): void {
    for (const [gameType, queue] of this.queues) {
      this.tryCreateMatchForGameType(gameType, queue);
    }
  }

  /**
   * Try to create a match for a specific game type queue
   */
  private tryCreateMatchForGameType(
    gameType: string,
    queue: Map<string, QueuedPlayer>
  ): void {
    const resolvedConfig = this.resolveGameTypeConfig(gameType);
    const { playersPerMatch } = resolveGameMode(resolvedConfig.gameMode);

    if (queue.size < playersPerMatch) {
      return;
    }

    // Get the required number of players from the queue
    const players: QueuedPlayer[] = [];
    const queueIterator = queue.values();

    for (let i = 0; i < playersPerMatch; i++) {
      const player = queueIterator.next().value;
      if (player) {
        players.push(player);
      }
    }

    if (players.length !== playersPerMatch) {
      return;
    }

    // Safe check: ensure no duplicate players (players not matched with themselves)
    const playerIds = new Set(players.map((p) => p.playerId));
    if (playerIds.size !== players.length) {
      console.warn(
        '[MATCH] Duplicate player detected, skipping match creation'
      );
      return;
    }

    // Remove players from queue
    for (const player of players) {
      queue.delete(player.playerId);
    }

    // Distribute players into teams using resolved config
    const teams = this.distributeIntoTeams(players, resolvedConfig);

    // Generate match ID first for logging
    const matchId = this.generateMatchId();

    // Log match creation with team composition
    this.logMatchCreation(teams, matchId);

    // Create new game room with resolved config and gameType
    const gameRoom = new GameRoom(
      matchId,
      this.io,
      resolvedConfig,
      teams,
      this.eventEmitter,
      gameType
    );

    this.matches.set(matchId, gameRoom);

    // Emit match-created event
    this.eventEmitter('match-created', gameRoom.getMatchInfo());

    // Start the match
    gameRoom.start();
  }

  /**
   * Distribute players evenly into teams
   */
  private distributeIntoTeams(
    players: QueuedPlayer[],
    config?: PhalanxConfig
  ): QueuedPlayer[][] {
    const effectiveConfig = config ?? this.config;
    const { teamsCount } = resolveGameMode(effectiveConfig.gameMode);
    const playersPerTeam = players.length / teamsCount;
    const teams: QueuedPlayer[][] = [];

    for (let t = 0; t < teamsCount; t++) {
      const start = t * playersPerTeam;
      teams.push(players.slice(start, start + playersPerTeam));
    }

    return teams;
  }

  /**
   * Log match creation with team composition
   */
  private logMatchCreation(_teams: QueuedPlayer[][], _matchId: string): void {
    // Match creation logging removed - use event handlers instead
  }

  /**
   * Get information about a specific match
   */
  getMatch(matchId: string): GameRoom | undefined {
    return this.matches.get(matchId);
  }

  /**
   * Remove a finished match
   */
  removeMatch(matchId: string): void {
    const match = this.matches.get(matchId);
    if (match) {
      match.stop();
      this.matches.delete(matchId);
    }
  }

  /**
   * Get all active matches info
   */
  getActiveMatches(): MatchInfo[] {
    return Array.from(this.matches.values()).map((m) => m.getMatchInfo());
  }

  /**
   * Get current queue size (total across all sub-queues)
   */
  getQueueSize(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.size;
    }
    return total;
  }

  /**
   * Handle player disconnection
   */
  handleDisconnect(socketId: string): void {
    // Remove from all queues
    for (const queue of this.queues.values()) {
      for (const [playerId, player] of queue.entries()) {
        if (player.socketId === socketId) {
          queue.delete(playerId);
          break;
        }
      }
    }

    // Notify matches
    for (const match of this.matches.values()) {
      match.handleDisconnect(socketId);
    }
  }

  /**
   * Generate a unique match ID
   * Format: match-{timestamp}-{randomId}
   */
  private generateMatchId(): string {
    return `match-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}
