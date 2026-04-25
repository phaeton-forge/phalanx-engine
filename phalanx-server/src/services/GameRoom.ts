import { randomBytes } from 'crypto';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  PhalanxConfig,
  QueuedPlayer,
  MatchInfo,
  PlayerInfo,
  PlayerCommand,
  TickCommands,
  DesyncConfig,
  PauseConfig,
  TickMode,
} from '../types/index.js';

/**
 * Socket data interface for type safety
 */
interface SocketData {
  matchId?: string;
  playerId?: string;
  teamId?: number;
  teammates?: string[];
  opponents?: string[];
}

/**
 * Game Room
 * Handles a single match with tick synchronization and command broadcasting
 */
export class GameRoom {
  private readonly id: string;
  private readonly roomId: string;
  private readonly io: SocketIOServer;
  private readonly config: PhalanxConfig;
  private readonly players: Map<string, PlayerInfo> = new Map();
  private readonly socketToPlayer: Map<string, string> = new Map();
  private readonly teams: QueuedPlayer[][];
  private readonly eventEmitter: (
    event: string,
    ...args: unknown[]
  ) => boolean | void;

  private currentTick: number = 0;
  private state: 'waiting-for-players' | 'countdown' | 'waiting-for-ready' | 'playing' | 'paused' | 'finished' = 'waiting-for-players';
  private createdAt: Date;
  private tickInterval: NodeJS.Timeout | null = null;
  private countdownTimer: NodeJS.Timeout | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  /**
   * Set when the match enters `'waiting-for-players'` (i.e. start()
   * was called but at least one participant's socket was offline).
   * Fires after `playersConnectTimeoutMs` and ends the match with
   * `match-end: 'players-not-connected'` so the connected players
   * aren't stranded indefinitely waiting for someone who's never
   * coming back.
   *
   * Cleared in `transitionFromWaitingForPlayers` when everyone's
   * online and we proceed to the countdown, or in `stop()` on shutdown.
   */
  private playersConnectTimeout: NodeJS.Timeout | null = null;
  /**
   * How long we'll hold the deferred-start state before giving up on
   * absent participants. Long enough to cover a typical mobile
   * "switched to messenger" round-trip, short enough that the
   * connected player isn't staring at a frozen lobby. Pulled from
   * config when available so games can tune it.
   */
  private readonly playersConnectTimeoutMs: number;
  /**
   * Absolute epoch-ms deadline for the countdown, set when the countdown
   * starts and cleared when `game-start` is emitted. Used to compute the
   * remaining seconds for a late-joining socket (e.g. a private-room host
   * whose mobile browser killed the WebSocket while they were sharing the
   * invite link) so the client can render the correct number instead of
   * staying stuck on the last value it saw before disconnecting.
   */
  private countdownDeadline: number | null = null;
  /**
   * Set to true once `game-start` has been broadcast. A host who recovers
   * after this point needs to synthesize the event locally — we signal
   * that via this flag in the `reconnect-state` payload so the client can
   * transition out of the countdown UI without waiting for a second
   * `game-start` it will never receive.
   */
  private gameStartEmitted: boolean = false;
  private pendingCommands: Map<number, PlayerCommand[]> = new Map();

  // Ready handshake: tracks which players have reported ready after asset loading
  private readyPlayers: Set<string> = new Set();
  private readyTimeout: NodeJS.Timeout | null = null;
  private readonly readyTimeoutMs: number;

  // Command buffer for lockstep: Map<tick, { playerId: commands[] }>
  private commandBuffer: Map<number, TickCommands> = new Map();
  // Track which players have submitted for each tick
  private tickSubmissions: Map<number, Set<string>> = new Map();
  // Track last message timestamp per player (LOCKSTEP-5) - uses real time instead of ticks
  private lastMessageTime: Map<string, number> = new Map();
  // Command history for reconnection (NET-2)
  private commandHistory: Map<number, PlayerCommand[]> = new Map();
  // Track players who are currently lagging (to avoid spamming events)
  private laggingPlayers: Set<string> = new Set();
  // Random seed for deterministic RNG (generated at match creation)
  private readonly randomSeed: number;
  // Track last sequence number per player for input validation (2.1.4)
  private lastSequence: Map<string, number> = new Map();
  // State hashes per tick for desync detection (2.1.3)
  private stateHashes: Map<number, Map<string, string>> = new Map();
  // Track consecutive desyncs for grace period (2.5.3.1)
  private consecutiveDesyncs: number = 0;
  // Resolved desync config with defaults
  private readonly desyncConfig: Required<DesyncConfig>;
  // Resolved pause config with defaults
  private readonly pauseConfig: Required<PauseConfig>;
  // Track number of pauses used by each player
  private pauseCount: Map<string, number> = new Map();
  // Track which player initiated the current pause (for requireSamePlayerToResume)
  private pausedByPlayerId: string | null = null;
  // Game type for this room (used in per-gameType matchmaking)
  private readonly gameType: string | undefined;
  // Resolved tick mode for this room
  private readonly tickMode: TickMode;
  // Turn timeout handle for event mode
  private turnTimeout: NodeJS.Timeout | null = null;

  constructor(
    id: string,
    io: SocketIOServer,
    config: PhalanxConfig,
    teams: QueuedPlayer[][],
    eventEmitter: (event: string, ...args: unknown[]) => boolean | void,
    gameType?: string
  ) {
    this.id = id;
    this.roomId = id;
    this.io = io;
    this.config = config;
    this.teams = teams;
    this.eventEmitter = eventEmitter;
    this.createdAt = new Date();
    this.gameType = gameType;
    this.tickMode = config.tickMode ?? 'continuous';
    // Generate deterministic random seed for this match (32-bit unsigned integer)
    this.randomSeed = randomBytes(4).readUInt32BE();

    // Resolve ready timeout from config
    this.readyTimeoutMs = config.readyTimeoutMs ?? 30000;
    this.playersConnectTimeoutMs = config.playersConnectTimeoutMs ?? 60000;

    // Resolve desync config with defaults
    this.desyncConfig = {
      enabled: config.desync?.enabled ?? true,
      action: config.desync?.action ?? 'end-match',
      gracePeriodTicks: config.desync?.gracePeriodTicks ?? 1,
    };

    // Resolve pause config with defaults
    this.pauseConfig = {
      maxPausesPerPlayer: config.pause?.maxPausesPerPlayer ?? Infinity,
      requireSamePlayerToResume: config.pause?.requireSamePlayerToResume ?? false,
    };

    // Initialize players from teams
    teams.forEach((team, teamId) => {
      team.forEach((qp) => {
        const playerInfo: PlayerInfo = {
          id: qp.playerId,
          teamId,
          connected: true,
          lastTick: 0,
        };
        this.players.set(qp.playerId, playerInfo);
        this.socketToPlayer.set(qp.socketId, qp.playerId);
        // Initialize activity tracking with current time
        this.lastMessageTime.set(qp.playerId, Date.now());
      });
    });
  }

  /**
   * Start the game room.
   *
   * If every participant's socket is currently live we proceed straight
   * to the countdown. Otherwise the room enters
   * `'waiting-for-players'` — `match-found` and
   * `match-waiting-for-players` are emitted to whoever is online, and
   * the countdown is held back until either:
   *
   *   - every player has reconnected (via `GameRoom.handleReconnect`,
   *     typically driven by the engine's room/match-recover handlers
   *     for the private-room case), at which point we transition to
   *     the countdown; OR
   *
   *   - `playersConnectTimeoutMs` elapses and we end the match with
   *     `match-end: 'players-not-connected'`, freeing the participants
   *     who DID show up.
   *
   * Putting this gate inside `GameRoom` (rather than at the
   * matchmaking / private-room layer) means every flow that builds a
   * match — public matchmaking, private invites, future custom
   * lobbies — gets the same "don't drop a single player into a
   * countdown alone" guarantee for free.
   */
  start(): void {
    // Wire each player's socket: assign socket.data, join the room,
    // and reflect their actual connection state in `players`. The
    // constructor optimistically initialises everyone as connected,
    // but the socket they were tracked under may have died between
    // the matchmaking decision and now (mobile suspension etc.).
    this.teams.forEach((team, teamId) => {
      const teammateIds = team.map((p) => p.playerId);
      const opponentIds = this.teams
        .filter((_, i) => i !== teamId)
        .flat()
        .map((p) => p.playerId);

      team.forEach((player) => {
        const socket = this.io.sockets.sockets.get(player.socketId);
        const playerInfo = this.players.get(player.playerId);
        if (socket) {
          // Assign match data to socket
          const socketData = socket.data as SocketData;
          socketData.matchId = this.id;
          socketData.playerId = player.playerId;
          socketData.teamId = teamId;
          socketData.teammates = teammateIds.filter(
            (id) => id !== player.playerId
          );
          socketData.opponents = opponentIds;

          // Join the room
          void socket.join(this.roomId);
          if (playerInfo) playerInfo.connected = true;
        } else if (playerInfo) {
          // Socket is gone — this player will need to recover before
          // we can begin. They'll show up in `match-waiting-for-players`.
          playerInfo.connected = false;
        }
      });
    });

    // Always emit personalized match-found to currently-connected
    // players. Reconnecting absent players will receive theirs from
    // `handleReconnect` once they come back.
    this.notifyMatchFound();

    if (this.areAllPlayersConnected()) {
      // Happy path — everyone is here, run the original immediate-
      // countdown flow.
      this.state = 'countdown';
      this.startGameCountdown();
      return;
    }

    // Defer: at least one socket is missing. Sit in
    // `'waiting-for-players'` and announce who we're waiting on.
    this.state = 'waiting-for-players';
    this.notifyWaitingForPlayers();

    this.playersConnectTimeout = setTimeout(() => {
      this.playersConnectTimeout = null;
      // Recheck inside the timer in case everyone reconnected during
      // a pending microtask between schedule and fire.
      if (this.state !== 'waiting-for-players') return;

      const missing = this.getDisconnectedPlayerIds();
      console.log(
        `[GameRoom ${this.id}] players-connect timeout — ${missing.length} player(s) never returned: ${missing.join(', ')}`,
      );
      this.io.to(this.roomId).emit('match-end', {
        reason: 'players-not-connected',
      });
      this.state = 'finished';
      this.eventEmitter('match-ended', this.id, 'players-not-connected');
    }, this.playersConnectTimeoutMs);
  }

  /**
   * Drive the deferred-start state machine forward: invoked from
   * `handleReconnect` once a previously-missing player has rebound
   * their socket. If everyone is now present, cancels the players-
   * connect timeout and transitions into the countdown; otherwise
   * just re-broadcasts the updated waiting-for-players list.
   */
  private maybeBeginCountdownAfterReconnect(): void {
    if (this.state !== 'waiting-for-players') return;

    if (this.areAllPlayersConnected()) {
      if (this.playersConnectTimeout) {
        clearTimeout(this.playersConnectTimeout);
        this.playersConnectTimeout = null;
      }
      console.log(
        `[GameRoom ${this.id}] all players connected — starting countdown`,
      );
      this.state = 'countdown';
      this.startGameCountdown();
    } else {
      // Still missing someone — refresh the announcement so any
      // already-connected client UI (e.g. "waiting for X, Y…") can
      // update its label.
      this.notifyWaitingForPlayers();
    }
  }

  /** True iff every participant's `connected` flag is set. */
  private areAllPlayersConnected(): boolean {
    for (const p of this.players.values()) {
      if (!p.connected) return false;
    }
    return true;
  }

  /** PlayerIds whose `connected` flag is currently false. */
  private getDisconnectedPlayerIds(): string[] {
    const out: string[] = [];
    for (const [id, p] of this.players) {
      if (!p.connected) out.push(id);
    }
    return out;
  }

  /**
   * Broadcast `match-waiting-for-players` to every currently-connected
   * socket in the room, listing which playerIds we're still waiting on.
   * Uses `this.io.to(this.roomId).emit(...)` so socket.io handles room
   * routing to currently connected sockets while we include the canonical
   * `matchId` in the payload, consistent with `notifyMatchFound`.
   */
  private notifyWaitingForPlayers(): void {
    const missing = this.getDisconnectedPlayerIds();
    this.io.to(this.roomId).emit('match-waiting-for-players', {
      matchId: this.id,
      missingPlayerIds: missing,
    });
  }

  /**
   * Start the game countdown
   * Emits countdown events (5, 4, 3, 2, 1, 0) every second, then game-start
   */
  private startGameCountdown(): void {
    if (this.config.countdownSeconds <= 0) {
      // Skip countdown entirely — go straight to waiting-for-ready.
      // No deadline to record: the countdown phase is effectively zero
      // length, so a reconnecting client should observe `gameStartEmitted`.
      this.gameStartEmitted = true;
      this.io.to(this.roomId).emit('game-start', {
        matchId: this.id,
        randomSeed: this.randomSeed,
      });
      this.enterWaitingForReady();
      return;
    }

    let countdown = this.config.countdownSeconds;
    // Record the absolute wall-clock deadline so a reconnecting socket
    // can compute its own remaining-seconds value without having to wait
    // for the next tick of the 1Hz broadcast.
    this.countdownDeadline = Date.now() + countdown * 1000;

    // Emit initial countdown
    this.io.to(this.roomId).emit('countdown', { seconds: countdown });
    countdown--;

    this.countdownInterval = setInterval(() => {
      this.io.to(this.roomId).emit('countdown', { seconds: countdown });
      countdown--;

      if (countdown < 0) {
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        // The countdown phase is over — clear the deadline and mark the
        // game-start as emitted so a late recover falls into the
        // synthesize-locally path rather than waiting for an event that
        // will never fire again.
        this.countdownDeadline = null;
        this.gameStartEmitted = true;
        // Emit game-start event with random seed for deterministic RNG
        this.io.to(this.roomId).emit('game-start', {
          matchId: this.id,
          randomSeed: this.randomSeed,
        });
        this.enterWaitingForReady();
      }
    }, 1000);
  }

  /**
   * Transition to waiting-for-ready state.
   * The tick loop will not begin until all clients send 'client-ready'.
   */
  private enterWaitingForReady(): void {
    this.state = 'waiting-for-ready';
    this.readyPlayers.clear();
    this.readyTimeout = setTimeout(() => {
      this.endMatchDueToReadyTimeout();
    }, this.readyTimeoutMs);
  }

  /**
   * Notify all players that a match has been found
   * Each player receives personalized data about their teammates and opponents
   */
  private notifyMatchFound(): void {
    this.teams.forEach((team, teamId) => {
      team.forEach((player) => {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          const payload = this.buildMatchFoundPayloadForTeam(
            player.playerId,
            teamId,
            team,
          );
          if (payload) socket.emit('match-found', payload);
        }
      });
    });
  }

  /**
   * Build the personalized `match-found` payload for `playerId`.
   *
   * Used by the initial broadcast in {@link notifyMatchFound} and by
   * retroactive delivery when a host who was offline at `joinRoom`
   * time finally reconnects via `room-recover`. Returns `null` if
   * the player is not in this match.
   */
  buildMatchFoundPayload(playerId: string): {
    matchId: string;
    playerId: string;
    teamId: number;
    teammates: { playerId: string; username: string }[];
    opponents: { playerId: string; username: string }[];
  } | null {
    for (let teamId = 0; teamId < this.teams.length; teamId++) {
      const team = this.teams[teamId];
      if (team && team.some((p) => p.playerId === playerId)) {
        return this.buildMatchFoundPayloadForTeam(playerId, teamId, team);
      }
    }
    return null;
  }

  private buildMatchFoundPayloadForTeam(
    playerId: string,
    teamId: number,
    team: QueuedPlayer[],
  ): {
    matchId: string;
    playerId: string;
    teamId: number;
    teammates: { playerId: string; username: string }[];
    opponents: { playerId: string; username: string }[];
  } {
    const teammates = team
      .filter((p) => p.playerId !== playerId)
      .map((p) => ({ playerId: p.playerId, username: p.username }));
    const opponents = this.teams
      .filter((_, i) => i !== teamId)
      .flat()
      .map((p) => ({ playerId: p.playerId, username: p.username }));
    return {
      matchId: this.id,
      playerId,
      teamId,
      teammates,
      opponents,
    };
  }

  /**
   * Handle a player reporting ready after asset loading.
   * When all connected players are ready, the tick loop starts.
   * @param playerId - The player reporting ready
   */
  handlePlayerReady(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.connected) {
      return;
    }

    if (this.state !== 'waiting-for-ready') {
      return;
    }

    // Ignore duplicate ready signals
    if (this.readyPlayers.has(playerId)) {
      return;
    }

    this.readyPlayers.add(playerId);

    // Broadcast player-ready to the room so clients can update loading screens
    this.io.to(this.roomId).emit('player-ready', { playerId });

    // Check if all connected players are ready
    const allReady = Array.from(this.players.entries()).every(
      ([id, info]) => !info.connected || this.readyPlayers.has(id)
    );

    if (allReady) {
      if (this.readyTimeout) {
        clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
      }
      this.startGame();
    }
  }

  /**
   * End the match because not all clients reported ready within the timeout.
   */
  private endMatchDueToReadyTimeout(): void {
    this.readyTimeout = null;
    this.stop(true);

    this.io.to(this.roomId).emit('match-end', {
      reason: 'ready-timeout',
    });

    this.eventEmitter('match-ended', this.id, 'ready-timeout');
  }

  /**
   * Start the actual game (after countdown)
   */
  private startGame(): void {
    this.state = 'playing';
    this.currentTick = 0;

    // Reset activity timestamps for all players at game start
    const now = Date.now();
    for (const playerId of this.players.keys()) {
      this.lastMessageTime.set(playerId, now);
    }

    // Emit match-started event
    this.eventEmitter('match-started', this.getMatchInfo());

    if (this.tickMode === 'continuous') {
      // Start tick loop for continuous mode
      const tickIntervalMs = 1000 / this.config.tickRate;
      this.tickInterval = setInterval(() => {
        this.processTick();
      }, tickIntervalMs);
    } else {
      // Event mode: no tick loop — start turn timeout
      this.resetTurnTimeout();
    }
  }

  /**
   * Process a single tick
   */
  private processTick(): void {
    // Broadcast tick-sync to all players every tick
    this.io.to(this.roomId).emit('tick-sync', {
      tick: this.currentTick,
      timestamp: Date.now(),
    });

    // Check for lagging/disconnected players (LOCKSTEP-5)
    this.checkPlayerTimeouts();

    const commands = this.pendingCommands.get(this.currentTick) || [];

    // Sort for deterministic order across all clients:
    // 1. Primary: by playerId (alphabetical)
    // 2. Secondary: by command type (alphabetical) for stable ordering
    // This ensures all clients process commands in exactly the same order
    commands.sort((a, b) => {
      const playerCompare = a.playerId.localeCompare(b.playerId);
      if (playerCompare !== 0) return playerCompare;
      // Same player - sort by command type for stability
      return a.type.localeCompare(b.type);
    });

    // Store command history for reconnection (NET-2)
    this.storeCommandHistory(this.currentTick, commands);

    // Broadcast commands batch to all players
    this.io.to(this.roomId).emit('commands-batch', {
      tick: this.currentTick,
      commands,
    });

    // Clean up old commands and tick data
    this.pendingCommands.delete(this.currentTick);
    this.clearOldTicks(this.currentTick);

    // Advance tick
    this.currentTick++;
  }

  /**
   * Handle a player command
   */
  handleCommand(playerId: string, command: PlayerCommand): boolean {
    const player = this.players.get(playerId);
    if (!player || this.state !== 'playing') {
      return false;
    }

    // Validate tick range
    const tickDiff = command.tick - this.currentTick;
    if (
      tickDiff < -this.config.maxTickBehind ||
      tickDiff > this.config.maxTickAhead
    ) {
      return false;
    }

    // Let external handlers validate
    const result = this.eventEmitter('player-command', playerId, command);
    if (result === false) {
      return false;
    }

    // Store command for the specified tick
    const targetTick = Math.max(command.tick, this.currentTick);
    if (!this.pendingCommands.has(targetTick)) {
      this.pendingCommands.set(targetTick, []);
    }
    this.pendingCommands.get(targetTick)!.push(command);

    // Update player's last tick
    player.lastTick = command.tick;

    return true;
  }

  /**
   * Validate command sequence number (2.1.4)
   * Returns true if sequence is valid, false otherwise
   */
  private validateCommandSequence(
    playerId: string,
    command: PlayerCommand
  ): boolean {
    // If command has no sequence, accept it (backward compatibility)
    if (command.sequence === undefined) {
      return true;
    }

    const lastSeq = this.lastSequence.get(playerId) ?? -1;
    const expectedSeq = lastSeq + 1;

    if (command.sequence !== expectedSeq) {
      return false;
    }

    // Update last sequence
    this.lastSequence.set(playerId, command.sequence);
    return true;
  }

  /**
   * Receive commands from a player for a specific tick (LOCKSTEP-2)
   * Commands can be empty if player has no actions for this tick.
   * This is normal - units may be moving/idle and player doesn't need to input anything.
   */
  receivePlayerCommands(
    playerId: string,
    tick: number,
    commands: PlayerCommand[]
  ): { accepted: boolean; invalidCommands?: PlayerCommand[] } {
    const player = this.players.get(playerId);
    if (!player || this.state !== 'playing') {
      return { accepted: false };
    }

    // Update activity tracking (LOCKSTEP-5) - any message = player is alive
    this.updatePlayerActivity(playerId);

    // Validate tick range - can't submit for ticks too far in the past or future
    const tickDiff = tick - this.currentTick;
    if (
      tickDiff < -this.config.maxTickBehind ||
      tickDiff > this.config.maxTickAhead
    ) {
      return { accepted: false };
    }

    // Validate input sequences if enabled (2.1.4)
    const validCommands: PlayerCommand[] = [];
    const invalidCommands: PlayerCommand[] = [];

    if (this.config.validateInputSequence) {
      for (const cmd of commands) {
        if (!this.validateCommandSequence(playerId, cmd)) {
          invalidCommands.push(cmd);
        } else {
          validCommands.push(cmd);
        }
      }
    } else {
      // No validation - accept all commands
      validCommands.push(...commands);
    }

    // Get or create tick entry in command buffer
    if (!this.commandBuffer.has(tick)) {
      this.commandBuffer.set(tick, {});
    }

    const tickData = this.commandBuffer.get(tick)!;

    // Store commands for this player (can be empty array - this is valid)
    tickData[playerId] = validCommands;

    // Track submission
    if (!this.tickSubmissions.has(tick)) {
      this.tickSubmissions.set(tick, new Set());
    }
    this.tickSubmissions.get(tick)!.add(playerId);

    // Update player's last tick
    player.lastTick = tick;

    // Let external handlers process each command
    for (const command of validCommands) {
      this.eventEmitter('player-command', playerId, command);
    }

    if (this.tickMode === 'event') {
      // Event mode: immediately broadcast commands and advance tick
      const commands = [...validCommands];
      // Normalize per-command ticks to match the batch tick
      for (const cmd of commands) {
        cmd.tick = this.currentTick;
      }
      commands.sort((a, b) => {
        const playerCompare = a.playerId.localeCompare(b.playerId);
        if (playerCompare !== 0) return playerCompare;
        return a.type.localeCompare(b.type);
      });

      this.storeCommandHistory(this.currentTick, commands);

      this.io.to(this.roomId).emit('commands-batch', {
        tick: this.currentTick,
        commands,
      });

      this.currentTick++;
      // Prune stale commandBuffer/tickSubmissions entries to prevent memory leak
      // (processTick is never called in event mode, so clearOldTicks must run here)
      this.clearOldTicks(this.currentTick);
      this.resetTurnTimeout();
    } else {
      // Continuous mode: add to pending commands for next tick broadcast
      const targetTick = Math.max(tick, this.currentTick);
      if (!this.pendingCommands.has(targetTick)) {
        this.pendingCommands.set(targetTick, []);
      }
      this.pendingCommands.get(targetTick)!.push(...validCommands);
    }

    return {
      accepted: true,
      invalidCommands: invalidCommands.length > 0 ? invalidCommands : undefined,
    };
  }

  /**
   * Get all commands for a specific tick
   */
  getCommandsForTick(tick: number): TickCommands | null {
    return this.commandBuffer.get(tick) || null;
  }

  /**
   * Check if all players have submitted for a specific tick
   */
  allPlayersSubmittedForTick(tick: number): boolean {
    const submissions = this.tickSubmissions.get(tick);
    if (!submissions) {
      return false;
    }

    for (const [playerId, playerInfo] of this.players) {
      if (playerInfo.connected && !submissions.has(playerId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get which players have submitted for a specific tick
   */
  getSubmissionsForTick(tick: number): Set<string> {
    return this.tickSubmissions.get(tick) || new Set();
  }

  /**
   * Clean up old ticks after they've been processed
   */
  clearOldTicks(beforeTick: number): void {
    for (const [tick] of this.commandBuffer) {
      if (tick < beforeTick) {
        this.commandBuffer.delete(tick);
      }
    }
    for (const [tick] of this.tickSubmissions) {
      if (tick < beforeTick) {
        this.tickSubmissions.delete(tick);
      }
    }
  }

  // ============================================================
  // LOCKSTEP-5: Activity Tracking and Timeout Detection
  // ============================================================

  /**
   * Update player activity timestamp (called on any message from player)
   * Uses real time instead of ticks - more reliable with Socket.IO ping/pong
   */
  updatePlayerActivity(playerId: string): void {
    this.lastMessageTime.set(playerId, Date.now());
    // If player was lagging, they're now back
    if (this.laggingPlayers.has(playerId)) {
      this.laggingPlayers.delete(playerId);
    }
  }

  /**
   * Check for lagging/disconnected players (LOCKSTEP-5)
   * Uses real time (ms) instead of ticks for more reliable detection.
   * Skipped entirely in event mode (turn timeout handles inactivity).
   */
  private checkPlayerTimeouts(): void {
    if (this.tickMode === 'event') return;

    const now = Date.now();
    // Convert tick-based config to milliseconds
    const lagThresholdMs =
      (this.config.timeoutTicks / this.config.tickRate) * 1000;
    const disconnectThresholdMs =
      (this.config.disconnectTicks / this.config.tickRate) * 1000;

    for (const [playerId, playerInfo] of this.players) {
      if (!playerInfo.connected) continue;

      const lastMessage = this.lastMessageTime.get(playerId) || 0;
      const msSinceLastMessage = now - lastMessage;

      if (msSinceLastMessage >= disconnectThresholdMs) {
        // Player timed out - mark as disconnected
        this.io.to(this.roomId).emit('player-timeout', {
          playerId,
          lastMessageTime: lastMessage,
          currentTick: this.currentTick,
          msSinceLastMessage,
        });

        playerInfo.connected = false;
        this.laggingPlayers.delete(playerId);
        this.eventEmitter('player-timeout', playerId, this.id);
      } else if (msSinceLastMessage >= lagThresholdMs) {
        // Player is lagging - emit warning (only once per lagging period)
        if (!this.laggingPlayers.has(playerId)) {
          this.laggingPlayers.add(playerId);
          this.io.to(this.roomId).emit('player-lagging', {
            playerId,
            currentTick: this.currentTick,
            msSinceLastMessage,
          });
        }
      }
    }
  }

  // ============================================================
  // EVENT MODE: Turn Timeout
  // ============================================================

  /**
   * Reset (or start) the turn timeout for event mode.
   * If no commands arrive within turnTimeoutMs the match ends.
   */
  private resetTurnTimeout(): void {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }

    const turnTimeoutMs = this.config.turnTimeoutMs ?? 60000;
    this.turnTimeout = setTimeout(() => {
      this.endMatchDueToTurnTimeout();
    }, turnTimeoutMs);
  }

  /**
   * End the match because the turn timeout expired (event mode only).
   */
  private endMatchDueToTurnTimeout(): void {
    this.turnTimeout = null;
    this.stop(true);

    this.io.to(this.roomId).emit('match-end', {
      reason: 'turn-timeout',
    });

    this.eventEmitter('match-ended', this.id, 'turn-timeout');
  }

  // ============================================================
  // NET-2: Command History for Reconnection
  // ============================================================

  /**
   * Store command history for reconnection support (NET-2)
   */
  private storeCommandHistory(tick: number, commands: PlayerCommand[]): void {
    this.commandHistory.set(tick, [...commands]);

    // Prune old history
    const oldestToKeep = tick - this.config.commandHistoryTicks;
    for (const [historyTick] of this.commandHistory) {
      if (historyTick < oldestToKeep) {
        this.commandHistory.delete(historyTick);
      }
    }
  }

  /**
   * Get recent command history for reconnecting player (NET-2)
   */
  getRecentCommandHistory(
    fromTick: number
  ): { tick: number; commands: PlayerCommand[] }[] {
    const history: { tick: number; commands: PlayerCommand[] }[] = [];

    for (let tick = fromTick; tick < this.currentTick; tick++) {
      const commands = this.commandHistory.get(tick);
      if (commands) {
        history.push({ tick, commands });
      }
    }

    return history;
  }

  /**
   * Pause the game.
   * Stops the tick loop and broadcasts 'game-paused' to all clients.
   * All clients freeze deterministically because the pause only takes effect
   * when they receive this broadcast (after the last completed tick).
   *
   * @param requestedBy - Player ID who requested the pause
   * @returns true if the game was paused, false if not in a pauseable state or player exceeded pause limit
   */
  pause(requestedBy: string): boolean {
    if (this.state !== 'playing') return false;

    // Check if player has pauses remaining
    const currentPauseCount = this.pauseCount.get(requestedBy) ?? 0;
    if (currentPauseCount >= this.pauseConfig.maxPausesPerPlayer) {
      return false;
    }

    // Stop sending ticks — the current tick has already been emitted
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }

    this.state = 'paused';

    // Track who paused and increment their pause count
    this.pausedByPlayerId = requestedBy;
    this.pauseCount.set(requestedBy, currentPauseCount + 1);

    // Broadcast to all clients so they freeze at the same logical point
    this.io.to(this.roomId).emit('game-paused', {
      requestedBy,
      lastTick: this.currentTick - 1,
    });

    this.eventEmitter('match-paused', this.id, requestedBy);
    return true;
  }

  /**
   * Resume the game after a pause.
   * Restarts the tick loop and broadcasts 'game-resumed' to all clients.
   *
   * @param requestedBy - Player ID who requested the resume
   * @returns true if the game was resumed, false if not currently paused or player not allowed to resume
   */
  resume(requestedBy: string): boolean {
    if (this.state !== 'paused') return false;

    // Check if only the player who paused can resume
    if (
      this.pauseConfig.requireSamePlayerToResume &&
      this.pausedByPlayerId !== null &&
      this.pausedByPlayerId !== requestedBy
    ) {
      return false;
    }

    this.state = 'playing';

    // Clear the paused-by tracker
    this.pausedByPlayerId = null;

    // Reset activity timestamps so no player is flagged as lagging right after resume
    const now = Date.now();
    for (const playerId of this.players.keys()) {
      this.lastMessageTime.set(playerId, now);
    }

    // Broadcast to all clients so they unfreeze
    this.io.to(this.roomId).emit('game-resumed', {
      requestedBy,
    });

    if (this.tickMode === 'continuous') {
      // Restart tick loop
      const tickIntervalMs = 1000 / this.config.tickRate;
      this.tickInterval = setInterval(() => {
        this.processTick();
      }, tickIntervalMs);
    } else {
      // Event mode: restart turn timeout
      this.resetTurnTimeout();
    }

    this.eventEmitter('match-resumed', this.id, requestedBy);
    return true;
  }

  /**
   * Get current tick number
   */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Stop the game room
   * @param skipNotify - If true, skip emitting match-ended events (used when already handled)
   */
  stop(skipNotify: boolean = false): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
    if (this.playersConnectTimeout) {
      clearTimeout(this.playersConnectTimeout);
      this.playersConnectTimeout = null;
    }
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }
    this.state = 'finished';

    if (!skipNotify) {
      // Emit match-ended event
      this.eventEmitter('match-ended', this.id, 'stopped');

      // Notify players
      this.io.to(this.roomId).emit('match-end', {
        reason: 'stopped',
      });
    }
  }

  /**
   * Handle player disconnection (NET-2)
   */
  handleDisconnect(socketId: string): void {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) {
      return;
    }

    const player = this.players.get(playerId);
    if (player) {
      player.connected = false;
      this.eventEmitter('player-disconnected', playerId, this.id);

      // Notify other players with grace period info
      this.io.to(this.roomId).emit('player-disconnected', {
        playerId,
        matchId: this.id,
        gracePeriodMs: this.config.reconnectGracePeriodMs,
      });

      // If we're waiting for ready, re-check whether all remaining connected
      // players are now ready (the disconnected player no longer blocks).
      if (this.state === 'waiting-for-ready') {
        const allReady = Array.from(this.players.entries()).every(
          ([id, info]) => !info.connected || this.readyPlayers.has(id)
        );

        if (allReady) {
          if (this.readyTimeout) {
            clearTimeout(this.readyTimeout);
            this.readyTimeout = null;
          }
          this.startGame();
        }
      }
    }
  }

  /**
   * Handle player reconnection (NET-2)
   */
  handleReconnect(playerId: string, socketId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }

    // Update socket mapping
    for (const [oldSocketId, pid] of this.socketToPlayer.entries()) {
      if (pid === playerId) {
        this.socketToPlayer.delete(oldSocketId);
        break;
      }
    }
    this.socketToPlayer.set(socketId, playerId);

    player.connected = true;
    this.laggingPlayers.delete(playerId);

    // Update activity timestamp
    this.lastMessageTime.set(playerId, Date.now());

    this.eventEmitter('player-reconnected', playerId, this.id);

    // Join the room
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      void socket.join(this.roomId);
      const socketData = socket.data as SocketData;
      socketData.matchId = this.id;
      socketData.playerId = playerId;

      // If we're still in the deferred-start phase, this player has
      // never received their `match-found` (the original broadcast in
      // `start()` only reached live sockets). Send it now, then drive
      // the wait-for-players → countdown transition. We deliberately
      // skip the `reconnect-state` snapshot here — there's no tick
      // history to replay yet, and a `reconnect-state` carrying
      // `state: 'waiting-for-players'` would just confuse a client
      // expecting it to mean "the game is in progress".
      if (this.state === 'waiting-for-players') {
        const matchFoundPayload = this.buildMatchFoundPayload(playerId);
        if (matchFoundPayload) {
          socket.emit('match-found', matchFoundPayload);
        }
        socket.to(this.roomId).emit('player-reconnected', { playerId });
        // Look up the team info for the right teammates/opponents
        // assignment on socket.data — same fields `start()` would
        // have set for them on the happy path.
        for (let teamId = 0; teamId < this.teams.length; teamId++) {
          const team = this.teams[teamId];
          if (!team || !team.some((p) => p.playerId === playerId)) continue;
          socketData.teamId = teamId;
          socketData.teammates = team
            .map((p) => p.playerId)
            .filter((id) => id !== playerId);
          socketData.opponents = this.teams
            .filter((_, i) => i !== teamId)
            .flat()
            .map((p) => p.playerId);
          break;
        }
        this.maybeBeginCountdownAfterReconnect();
        return true;
      }

      // Send reconnect-state with command history (NET-2).
      //
      // Also carries a countdown / game-start snapshot so a client who
      // reconnects mid-countdown can render the correct remaining seconds
      // instead of freezing on the last value it saw, and a client who
      // reconnects after `game-start` can synthesize the event locally
      // (it will never be re-broadcast).
      const fromTick = Math.max(
        0,
        this.currentTick - this.config.commandHistoryTicks
      );
      // Use Math.ceil so a deadline 2.1s away is reported as 3, matching
      // the integer value the periodic `countdown` broadcast would have
      // emitted at the most recent whole second.
      const countdownSecondsRemaining =
        this.countdownDeadline !== null
          ? Math.max(
              0,
              Math.ceil((this.countdownDeadline - Date.now()) / 1000),
            )
          : null;
      socket.emit('reconnect-state', {
        matchId: this.id,
        currentTick: this.currentTick,
        state: this.state,
        players: Array.from(this.players.values()),
        recentCommands: this.getRecentCommandHistory(fromTick),
        countdownSecondsRemaining,
        gameStartEmitted: this.gameStartEmitted,
        randomSeed: this.randomSeed,
      });

      // Notify other players
      socket.to(this.roomId).emit('player-reconnected', { playerId });
    }

    // If reconnecting during waiting-for-ready, clear their previous ready
    // status so they must send client-ready again after re-loading.
    if (this.state === 'waiting-for-ready') {
      this.readyPlayers.delete(playerId);
    }

    return true;
  }

  /**
   * Whether the given playerId is a participant of this match.
   * Used by `PrivateRoomService.recoverRoom` to authenticate a
   * `room-recover` against a deferred / running match without
   * exposing the players map.
   */
  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  /**
   * Get match information
   */
  getMatchInfo(): MatchInfo {
    return {
      id: this.id,
      players: Array.from(this.players.values()),
      currentTick: this.currentTick,
      state: this.state,
      createdAt: this.createdAt,
      gameType: this.gameType,
    };
  }

  /**
   * Get the room ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get the random seed for this match
   * Clients use this to initialize their deterministic RNG
   */
  getRandomSeed(): number {
    return this.randomSeed;
  }

  // ============================================================
  // STATE HASHING (2.1.3): Desync Detection
  // ============================================================

  /**
   * Receive state hash from a player for a specific tick
   * @param playerId - The player sending the hash
   * @param tick - The tick this hash is for
   * @param hash - The state hash string
   */
  receiveStateHash(playerId: string, tick: number, hash: string): void {
    // Only process if state hashing is enabled
    if (!this.config.enableStateHashing) {
      return;
    }

    const player = this.players.get(playerId);
    if (!player || this.state !== 'playing') {
      return;
    }

    // Get or create hash map for this tick
    if (!this.stateHashes.has(tick)) {
      this.stateHashes.set(tick, new Map());
    }

    const tickHashes = this.stateHashes.get(tick)!;
    tickHashes.set(playerId, hash);

    // Check if all connected players have submitted for this tick
    const connectedPlayers = Array.from(this.players.entries())
      .filter(([_, p]) => p.connected)
      .map(([id]) => id);

    const allSubmitted = connectedPlayers.every((id) => tickHashes.has(id));

    if (allSubmitted) {
      this.checkForDesync(tick, tickHashes);
      // Clean up old hashes
      this.cleanupOldStateHashes(tick);
    }
  }

  /**
   * Check if there's a desync at a given tick
   */
  private checkForDesync(tick: number, hashes: Map<string, string>): void {
    const hashValues = Array.from(hashes.values());
    const allMatch = hashValues.every((h) => h === hashValues[0]);

    const hashObject: { [playerId: string]: string } = {};
    hashes.forEach((hash, playerId) => {
      hashObject[playerId] = hash;
    });

    if (!allMatch) {
      // Increment consecutive desync counter
      this.consecutiveDesyncs++;

      // Emit desync event to server handlers
      this.eventEmitter('desync-detected', this.id, tick, hashObject);

      // Check if we've exceeded the grace period
      if (this.consecutiveDesyncs >= this.desyncConfig.gracePeriodTicks) {
        // Take configured action
        if (this.desyncConfig.action === 'end-match') {
          // End the match due to confirmed desync
          this.endMatchDueToDesync(tick, hashObject);
        } else {
          // Log only - broadcast to clients for their logging/debugging
          this.io.to(this.roomId).emit('hash-comparison', {
            tick,
            hashes: hashObject,
          });
        }
      } else {
        // Still within grace period - just broadcast for logging
        this.io.to(this.roomId).emit('hash-comparison', {
          tick,
          hashes: hashObject,
        });
      }
    } else {
      // Hashes match - reset consecutive desync counter
      this.consecutiveDesyncs = 0;

      // Broadcast successful comparison (for client-side logging if needed)
      this.io.to(this.roomId).emit('hash-comparison', {
        tick,
        hashes: hashObject,
      });
    }
  }

  /**
   * End the match due to confirmed desync
   */
  private endMatchDueToDesync(
    tick: number,
    hashes: { [playerId: string]: string }
  ): void {
    // Stop the game (skip default notification since we handle it here)
    this.stop(true);

    // Notify players with desync details
    this.io.to(this.roomId).emit('match-end', {
      reason: 'desync',
      details: {
        tick,
        hashes,
      },
      winner: null,
    });

    // Emit match-ended event
    this.eventEmitter('match-ended', this.id, 'desync');
  }

  /**
   * Clean up state hashes older than the specified tick
   */
  private cleanupOldStateHashes(currentTick: number): void {
    const keepTicks = 10; // Keep last 10 ticks of hashes for debugging
    for (const [tick] of this.stateHashes) {
      if (tick < currentTick - keepTicks) {
        this.stateHashes.delete(tick);
      }
    }
  }
}
