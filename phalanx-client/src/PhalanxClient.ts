/**
 * Phalanx Client
 * Client library for connecting to Phalanx Engine servers
 */

import { EventEmitter } from './EventEmitter.js';
import { RenderLoop } from './RenderLoop.js';
import { SocketManager } from './SocketManager.js';
import { DesyncDetector, type DesyncConfig } from './DesyncDetector.js';
import { AuthManager } from './auth/AuthManager.js';
import type { AuthState, CallbackParams } from './auth/types.js';
import type {
  PhalanxClientConfig,
  PhalanxClientEvents,
  PhalanxAuthState,
  PhalanxAuthUser,
  PlayerCommand,
  MatchFoundEvent,
  CountdownEvent,
  GameStartEvent,
  QueueStatusEvent,
  ReconnectStateEvent,
  SubmitCommandsAck,
  ConnectionState,
  ClientState,
  TickHandler,
  FrameHandler,
  Unsubscribe,
  PauseHandler,
  RoomCreatedEvent,
  RoomRecoveredEvent,
} from './types.js';

/**
 * PhalanxClient - Main client class for connecting to Phalanx Engine servers
 *
 * @example
 * ```typescript
 * const client = await PhalanxClient.create({
 *   serverUrl: 'http://localhost:3000',
 *   playerId: 'player-123',
 *   username: 'MyPlayer',
 * });
 *
 * client.on('matchFound', (data) => console.log('Match found!'));
 * client.on('gameStart', () => console.log('Game started!'));
 *
 * await client.joinQueue();
 *
 * client.onTick((tick, commands) => {
 *   // Process commands and run simulation
 * });
 *
 * client.onFrame((alpha, dt) => {
 *   // Interpolate and render
 * });
 * ```
 */
export class PhalanxClient extends EventEmitter<PhalanxClientEvents> {
  private config: Required<Omit<PhalanxClientConfig, 'authToken' | 'auth' | 'playerId' | 'username' | 'pause'>> &
    Pick<PhalanxClientConfig, 'authToken' | 'auth' | 'playerId' | 'username' | 'pause'>;
  private socketManager: SocketManager;
  private renderLoop: RenderLoop;
  private desyncDetector: DesyncDetector;
  private authManager: AuthManager | null = null;

  // State
  private clientState: ClientState = 'idle';
  private currentMatchId: string | null = null;
  private currentTick: number = 0;

  // Auth state
  private authState: PhalanxAuthState = {
    isAuthenticated: false,
    isLoading: true,
    user: null,
  };

  // Pending commands queue
  private pendingCommands: PlayerCommand[] = [];

  // ITickFrameProvider pause/resume handler arrays
  private pauseHandlers: PauseHandler[] = [];
  private resumeHandlers: PauseHandler[] = [];

  constructor(config: PhalanxClientConfig) {
    super();

    // Generate default player ID if not provided
    const defaultPlayerId = `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 1000,
      connectionTimeoutMs: 10000,
      recoverRoomTimeoutMs: 10000,
      socketTransports: ['websocket'],
      tickRate: 20,
      debug: false,
      ...config,
      playerId: config.playerId || defaultPlayerId,
      username: config.username || `Player-${defaultPlayerId.slice(-6)}`,
    };

    // Initialize auth if configured
    if (config.auth) {
      this.initializeAuth(config.auth);
    } else {
      this.authState.isLoading = false;
    }

    // Initialize SocketManager with callbacks
    this.socketManager = new SocketManager(
      {
        serverUrl: this.config.serverUrl,
        playerId: this.config.playerId!,
        username: this.config.username!,
        authToken: this.config.authToken,
        connectionTimeoutMs: this.config.connectionTimeoutMs,
        recoverRoomTimeoutMs: this.config.recoverRoomTimeoutMs,
        socketTransports: this.config.socketTransports,
        autoReconnect: this.config.autoReconnect,
        maxReconnectAttempts: this.config.maxReconnectAttempts,
        reconnectDelayMs: this.config.reconnectDelayMs,
        debug: this.config.debug,
      },
      {
        // Connection events
        onConnected: () => {
          this.logLifecycle('connected', { clientState: this.clientState });
          this.emit('connected');
        },
        onDisconnected: () => {
          const previousState = this.clientState;
          this.clientState = 'idle';
          this.logLifecycle('disconnected', {
            previousState,
            nextState: this.clientState,
          });
          this.emit('disconnected');
        },
        onReconnecting: (attempt) => this.emit('reconnecting', attempt),
        onReconnectFailed: () => this.emit('reconnectFailed'),
        onError: (error) => this.emit('error', error),

        // Match lifecycle events
        onMatchFound: (data) => {
          const previousState = this.clientState;
          this.currentMatchId = data.matchId;
          this.clientState = 'match-found';
          this.logLifecycle('matchFound', {
            previousState,
            nextState: this.clientState,
            matchId: data.matchId,
            teamId: data.teamId,
          });
          this.emit('matchFound', data);
        },
        onCountdown: (data) => {
          this.logLifecycle('countdown', {
            clientState: this.clientState,
            seconds: data.seconds,
            matchId: this.currentMatchId,
          });
          this.emit('countdown', data);
        },
        onGameStart: (data) => {
          const previousState = this.clientState;
          this.clientState = 'playing';
          this.currentTick = 0;
          this.logLifecycle('gameStart', {
            previousState,
            nextState: this.clientState,
            matchId: data.matchId,
            randomSeed: data.randomSeed,
          });
          this.emit('gameStart', data);
        },
        onMatchEnd: (data) => {
          this.clientState = 'finished';
          this.emit('matchEnd', data);
        },

        // Tick events
        onTickSync: (data) => {
          this.currentTick = data.tick;
          this.renderLoop.updateTickTime();
          this.emit('tick', data);
        },
        onCommandsBatch: (data) => {
          this.currentTick = data.tick;
          this.renderLoop.processTick(data.tick, data.commands);
          this.emit('commands', data);
        },

        // Player events
        onPlayerDisconnected: (data) => this.emit('playerDisconnected', data),
        onPlayerReconnected: (data) => this.emit('playerReconnected', data),
        onPlayerReady: (data) => this.emit('playerReady', data),

        // Reconnection events
        onReconnectState: (data) => {
          const previousState = this.clientState;
          this.currentMatchId = data.matchId;
          this.currentTick = data.currentTick;
          if (data.state === 'paused') {
            this.clientState = 'paused';
          } else if (data.state === 'playing') {
            this.clientState = 'playing';
          } else {
            this.clientState = 'idle';
          }
          this.logLifecycle('reconnectState', {
            previousState,
            nextState: this.clientState,
            matchId: data.matchId,
            state: data.state,
            currentTick: data.currentTick,
            countdownSecondsRemaining: data.countdownSecondsRemaining,
            gameStartEmitted: data.gameStartEmitted,
          });
          this.emit('reconnectState', data);
        },
        onReconnectStatus: (data) => this.emit('reconnectStatus', data),

        // Pause events
        onGamePaused: (data) => {
          this.clientState = 'paused';
          this.emit('gamePaused', data);
          // Notify ITickFrameProvider subscribers (GameWorld listens here)
          for (const handler of this.pauseHandlers) handler();
        },
        onGameResumed: (data) => {
          this.clientState = 'playing';
          this.emit('gameResumed', data);
          // Notify ITickFrameProvider subscribers (GameWorld listens here)
          for (const handler of this.resumeHandlers) handler();
        },

        // Desync detection events
        onHashComparison: (data) => {
          if (!this.desyncDetector.isEnabled()) return;

          const hasDesync = !this.desyncDetector.compareWithRemote(
            data.tick,
            data.hashes
          );
          if (hasDesync) {
            const localHash = this.desyncDetector.getLocalHash(data.tick);
            this.emit('desync', {
              tick: data.tick,
              localHash: localHash ?? 'unknown',
              remoteHashes: data.hashes,
            });
          }
        },

        // State queries
        isPlaying: () => this.clientState === 'playing',
        getCurrentMatchId: () => this.currentMatchId,

        // Private room events
        onRoomError: (data) => {
          this.logLifecycle('roomError', { message: data.message });
          this.emit('roomError', data);
        },
        onRoomExpired: (data) => {
          this.logLifecycle('roomExpired', { code: data.code });
          this.emit('roomExpired', data);
        },
        onRoomCancelled: (data) => {
          const previousState = this.clientState;
          this.clientState = 'idle';
          this.logLifecycle('roomCancelled', {
            previousState,
            nextState: this.clientState,
            code: data.code,
          });
          this.emit('roomCancelled', data);
        },
        onRoomRecovered: (data) => {
          this.logLifecycle('roomRecovered', { code: data.code });
          this.emit('roomRecovered', data);
        },
      }
    );

    // Initialize DesyncDetector
    this.desyncDetector = new DesyncDetector();

    // Initialize RenderLoop
    this.renderLoop = new RenderLoop({
      tickRate: this.config.tickRate,
      debug: this.config.debug,
    });

    // Set up command flushing
    this.renderLoop.setCommandFlushCallback(() => this.flushPendingCommands());

    // Handle OAuth callback if present in URL
    if (config.auth && typeof window !== 'undefined') {
      void this.handleAuthCallback();
    }
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  /**
   * Initialize authentication manager
   */
  private initializeAuth(authConfig: NonNullable<PhalanxClientConfig['auth']>): void {
    if (authConfig.provider !== 'google' || !authConfig.google) {
      console.warn('[PhalanxClient] Invalid auth config - only Google is supported');
      this.authState.isLoading = false;
      return;
    }

    this.authManager = new AuthManager({
      provider: 'google',
      google: {
        clientId: authConfig.google.clientId,
        scopes: authConfig.google.scopes || ['openid', 'profile', 'email'],
        redirectUri: authConfig.google.redirectUri || (typeof window !== 'undefined' ? window.location.origin : undefined),
        tokenExchangeUrl: authConfig.google.tokenExchangeUrl,
      },
      debug: this.config.debug,
      onAuthStateChange: (state: AuthState) => {
        this.handleAuthStateChange(state);
      },
      onAuthError: (error: Error) => {
        this.emit('authError', { message: error.message });
      },
    });

    // Check for existing session
    void this.authManager.checkSession().then(() => {
      // Session check complete - state already updated via onAuthStateChange
    });
  }

  /**
   * Handle auth state changes from AuthManager
   */
  private handleAuthStateChange(state: AuthState): void {
    const user: PhalanxAuthUser | null = state.user ? {
      id: state.user.id,
      username: state.user.username,
      email: state.user.email,
      avatarUrl: state.user.avatarUrl,
      provider: state.provider || 'google',
    } : null;

    this.authState = {
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      user,
    };

    // Update config with auth user info
    if (user) {
      this.config.playerId = user.id;
      this.config.username = user.username || user.email || `Player-${user.id.slice(-6)}`;
      this.config.authToken = state.token || undefined;

      // Update socket manager with new credentials
      this.socketManager.updateCredentials(
        user.id,
        this.config.username,
        state.token || undefined
      );
    }

    this.emit('authStateChanged', this.authState);
  }

  /**
   * Handle OAuth callback from redirect
   */
  private async handleAuthCallback(): Promise<void> {
    if (!this.authManager) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    if (!code && !error) return;

    this.log('Handling OAuth callback...');

    try {
      const result = await this.authManager.handleCallback({
        code: code || undefined,
        state: params.get('state') || undefined,
        error: error || undefined,
        errorDescription: params.get('error_description') || undefined,
        url: window.location.href,
      });

      if (!result.valid) {
        this.emit('authError', { message: result.error || 'Authentication failed' });
      }
    } catch (err) {
      this.emit('authError', {
        message: err instanceof Error ? err.message : 'Authentication failed'
      });
    }

    // Clean up URL
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  /**
   * Start login flow (redirects to OAuth provider)
   */
  login(): void {
    if (!this.authManager) {
      this.emit('authError', { message: 'Authentication not configured' });
      return;
    }
    this.authManager.login();
  }

  /**
   * Log out the current user
   */
  async logout(): Promise<void> {
    if (!this.authManager) return;

    await this.authManager.logout();

    // Reset to anonymous player
    const defaultPlayerId = `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.config.playerId = defaultPlayerId;
    this.config.username = `Player-${defaultPlayerId.slice(-6)}`;
    this.config.authToken = undefined;
  }

  /**
   * Get current authentication state
   */
  getAuthState(): PhalanxAuthState {
    return { ...this.authState };
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  /**
   * Get current user info
   */
  getUser(): PhalanxAuthUser | null {
    return this.authState.user;
  }

  // ============================================
  // STATIC FACTORY
  // ============================================

  /**
   * Create and connect a new PhalanxClient
   * @param config Client configuration
   * @returns Connected PhalanxClient instance
   */
  static async create(config: PhalanxClientConfig): Promise<PhalanxClient> {
    const client = new PhalanxClient(config);
    await client.connect();
    return client;
  }

  // ============================================
  // CONNECTION MANAGEMENT
  // ============================================

  /**
   * Connect to the Phalanx server
   * @returns Promise that resolves when connected
   * @throws Error if connection fails or times out
   */
  async connect(): Promise<void> {
    this.logLifecycle('connect:before', {
      clientState: this.clientState,
      connectionState: this.getConnectionState(),
    });
    await this.socketManager.connect();
    this.logLifecycle('connect:after', {
      clientState: this.clientState,
      connectionState: this.getConnectionState(),
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.logLifecycle('disconnect:before', {
      clientState: this.clientState,
      connectionState: this.getConnectionState(),
      matchId: this.currentMatchId,
    });
    this.renderLoop.stop();
    this.socketManager.disconnect();

    const previousState = this.clientState;
    this.clientState = 'idle';
    this.currentMatchId = null;
    this.currentTick = 0;
    this.pendingCommands = [];
    this.logLifecycle('disconnect:after', {
      previousState,
      nextState: this.clientState,
      connectionState: this.getConnectionState(),
    });
  }

  /**
   * Destroy the client and clean up all resources
   */
  destroy(): void {
    this.renderLoop.dispose();
    this.disconnect();
    this.removeAllListeners();
    this.pendingCommands = [];
  }

  /**
   * Check if client is connected to the server
   */
  isConnected(): boolean {
    return this.socketManager.isConnected();
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.socketManager.getConnectionState();
  }

  /**
   * Get current client state
   */
  getClientState(): ClientState {
    return this.clientState;
  }

  // ============================================
  // QUEUE MANAGEMENT
  // ============================================

  /**
   * Join the matchmaking queue
   * @returns Promise that resolves with queue status
   */
  async joinQueue(): Promise<QueueStatusEvent> {
    const status = await this.socketManager.joinQueue();
    this.clientState = 'in-queue';
    this.emit('queueJoined', status);
    return status;
  }

  /**
   * Leave the matchmaking queue
   */
  leaveQueue(): void {
    this.socketManager.leaveQueue();
    this.clientState = 'idle';
    this.emit('queueLeft');
  }

  // ============================================
  // PRIVATE ROOMS
  // ============================================

  /**
   * Create a private room and wait for the room code.
   * After creation, the host should wait for match-found (when another player joins).
   */
  async createRoom(gameType?: string): Promise<RoomCreatedEvent> {
    this.ensureConnected();
    this.logLifecycle('createRoom:before', {
      clientState: this.clientState,
      gameType,
    });
    const event = await this.socketManager.createRoom(gameType);
    const previousState = this.clientState;
    this.clientState = 'in-queue'; // waiting for opponent
    this.logLifecycle('createRoom:after', {
      previousState,
      nextState: this.clientState,
      code: event.code,
    });
    this.emit('roomCreated', event);
    return event;
  }

  /**
   * Join a private room by code.
   * The server will create a match and emit match-found to both players.
   */
  joinRoom(code: string): void {
    this.ensureConnected();
    this.logLifecycle('joinRoom:emit', {
      code,
      clientState: this.clientState,
    });
    this.socketManager.joinRoom(code);
  }

  /**
   * Cancel a previously created private room.
   */
  cancelRoom(): void {
    this.logLifecycle('cancelRoom:emit', {
      clientState: this.clientState,
      matchId: this.currentMatchId,
    });
    this.socketManager.cancelRoom();
  }

  /**
   * Reclaim a private room after a transient socket disconnect.
   *
   * Call this after `connect()` has re-established the underlying socket
   * (typically inside a `visibilitychange` listener, or the first thing
   * on `pageshow` from bfcache) to tell the server to re-bind the still-
   * living room / in-flight match to this new socket.
   *
   * On success the server emits `match-found` (if a guest had already
   * joined) followed by `reconnect-state` carrying a countdown snapshot,
   * which `SocketManager`'s global `reconnect-state` handler fans out
   * through the local `countdown` and `game-start` listeners so any
   * `waitForCountdown` / `waitForGameStart` promises pending since the
   * original flow resume naturally.
   *
   * Rejects with the server's `room-error` message (e.g. `'Room expired'`)
   * or `'Recover timeout'` if the server doesn't answer before the configured
   * recovery timeout.
   */
  async recoverRoom(
    code: string,
    timeoutMs?: number,
  ): Promise<RoomRecoveredEvent> {
    this.ensureConnected();
    this.logLifecycle('recoverRoom:before', {
      code,
      timeoutMs,
      clientState: this.clientState,
    });
    const event = await this.socketManager.recoverRoom(code, timeoutMs);
    // Host is back in the "waiting for opponent / countdown" flow —
    // mirror the state createRoom would have left us in so downstream
    // isPlaying() checks stay consistent. The server may also have just
    // emitted match-found / reconnect-state (pending-recover path), which
    // will have already advanced `clientState` past 'in-queue' on its
    // own — so only bump it if we're still in a pre-match phase.
    if (this.clientState === 'idle') {
      this.clientState = 'in-queue';
    }
    this.logLifecycle('recoverRoom:after', {
      code: event.code,
      clientState: this.clientState,
    });
    return event;
  }

  // ============================================
  // PAUSE / RESUME
  // ============================================

  /**
   * Request the server to pause the game.
   * The game will not freeze immediately — it freezes only when the server
   * broadcasts the 'game-paused' event back to all clients, ensuring
   * every client pauses at the same deterministic point.
   */
  pauseGame(): void {
    this.ensureConnected();
    this.socketManager.sendPauseGame();
  }

  /**
   * Request the server to resume the game.
   * Same as pause — the actual resume occurs when the server broadcasts
   * 'game-resumed' to all clients.
   */
  resumeGame(): void {
    this.ensureConnected();
    this.socketManager.sendResumeGame();
  }

  /**
   * Notify the server that this client has finished loading and is ready to receive ticks.
   * Must be called after assets are loaded and game systems are initialized.
   * The server will not start the tick loop until all clients report ready.
   */
  sendReady(): void {
    this.ensureConnected();
    this.socketManager.sendReady();
  }

  /**
   * Wait for a match to be found
   * @returns Promise that resolves with match found event
   */
  async waitForMatch(): Promise<MatchFoundEvent> {
    this.logLifecycle('waitForMatch:before', {
      clientState: this.clientState,
    });
    const data = await this.socketManager.waitForMatch();
    const previousState = this.clientState;
    this.currentMatchId = data.matchId;
    this.clientState = 'match-found';
    this.logLifecycle('waitForMatch:after', {
      previousState,
      nextState: this.clientState,
      matchId: data.matchId,
      teamId: data.teamId,
    });
    this.emit('matchFound', data);
    return data;
  }

  /**
   * Join queue and wait for match in one call
   * @returns Promise that resolves with match found event
   */
  async joinQueueAndWaitForMatch(): Promise<MatchFoundEvent> {
    await this.joinQueue();
    return this.waitForMatch();
  }

  // ============================================
  // GAME LIFECYCLE
  // ============================================

  /**
   * Wait for countdown to complete (listening to countdown events)
   * @param onCountdown Optional callback for each countdown tick
   * @returns Promise that resolves when countdown reaches 0
   */
  async waitForCountdown(
    onCountdown?: (event: CountdownEvent) => void
  ): Promise<void> {
    const previousState = this.clientState;
    this.clientState = 'countdown';
    this.logLifecycle('waitForCountdown:before', {
      previousState,
      nextState: this.clientState,
      matchId: this.currentMatchId,
    });
    return this.socketManager.waitForCountdown(onCountdown);
  }

  /**
   * Wait for the game to start
   * @returns Promise that resolves with game start event
   */
  async waitForGameStart(): Promise<GameStartEvent> {
    this.logLifecycle('waitForGameStart:before', {
      clientState: this.clientState,
      matchId: this.currentMatchId,
    });
    const data = await this.socketManager.waitForGameStart();
    const previousState = this.clientState;
    this.clientState = 'playing';
    this.currentTick = 0;
    this.logLifecycle('waitForGameStart:after', {
      previousState,
      nextState: this.clientState,
      matchId: data.matchId,
      randomSeed: data.randomSeed,
    });
    this.emit('gameStart', data);
    return data;
  }

  // ============================================
  // COMMANDS
  // ============================================

  /**
   * Submit commands for a specific tick
   * @param tick The tick number these commands are for
   * @param commands Array of commands to submit
   * @returns Promise that resolves with acknowledgment
   */
  async submitCommands(
    tick: number,
    commands: PlayerCommand[]
  ): Promise<SubmitCommandsAck> {
    this.ensurePlaying();
    return this.socketManager.submitCommands(tick, commands);
  }

  /**
   * Submit commands without waiting for acknowledgment (fire and forget)
   * @param tick The tick number these commands are for
   * @param commands Array of commands to submit
   */
  submitCommandsAsync(tick: number, commands: PlayerCommand[]): void {
    this.ensurePlaying();
    this.socketManager.submitCommandsAsync(tick, commands);
  }

  /**
   * Send a command to the server
   * Commands are buffered and sent automatically each frame
   *
   * @param type Command type (e.g., 'move', 'attack')
   * @param data Command payload
   */
  sendCommand(type: string, data: unknown): void {
    this.pendingCommands.push({ type, data });
  }

  // ============================================
  // SIMPLIFIED API - TICK & FRAME HANDLERS
  // ============================================

  /**
   * Register a callback for simulation ticks
   * Called when the server sends a tick with commands from all players
   *
   * @param handler Callback receiving tick number and commands grouped by player
   * @returns Unsubscribe function
   */
  onTick(handler: TickHandler): Unsubscribe {
    return this.renderLoop.onTick(handler);
  }

  /**
   * Register a callback for render frames
   * Called every animation frame (~60fps) with interpolation alpha
   * Automatically starts the render loop when first handler is added
   *
   * @param handler Callback receiving alpha (0-1) and delta time in seconds
   * @returns Unsubscribe function
   */
  onFrame(handler: FrameHandler): Unsubscribe {
    return this.renderLoop.onFrame(handler);
  }

  // ============================================
  // ITickFrameProvider PAUSE / RESUME
  // ============================================

  /**
   * Request the server to pause the game (ITickFrameProvider contract).
   * The actual pause is signalled asynchronously via onPause when the
   * server broadcasts 'game-paused' to all clients.
   */
  requestPause(): void {
    this.pauseGame();
  }

  /**
   * Request the server to resume the game (ITickFrameProvider contract).
   * The actual resume is signalled asynchronously via onResume when the
   * server broadcasts 'game-resumed' to all clients.
   */
  requestResume(): void {
    this.resumeGame();
  }

  /**
   * Subscribe to the "paused" signal (ITickFrameProvider contract).
   * Fired when the server confirms the pause and broadcasts it.
   */
  onPause(handler: PauseHandler): Unsubscribe {
    this.pauseHandlers.push(handler);
    return () => {
      const idx = this.pauseHandlers.indexOf(handler);
      if (idx !== -1) this.pauseHandlers.splice(idx, 1);
    };
  }

  /**
   * Subscribe to the "resumed" signal (ITickFrameProvider contract).
   * Fired when the server confirms the resume and broadcasts it.
   */
  onResume(handler: PauseHandler): Unsubscribe {
    this.resumeHandlers.push(handler);
    return () => {
      const idx = this.resumeHandlers.indexOf(handler);
      if (idx !== -1) this.resumeHandlers.splice(idx, 1);
    };
  }

  // ============================================
  // RECONNECTION
  // ============================================

  /**
   * Attempt to reconnect to a match after disconnection
   * @param matchId The match ID to reconnect to
   * @returns Promise that resolves with reconnection state
   */
  async reconnectToMatch(matchId: string): Promise<ReconnectStateEvent> {
    this.clientState = 'reconnecting';
    return this.socketManager.reconnectToMatch(matchId);
  }

  /**
   * Attempt automatic reconnection with retries
   * @returns Promise that resolves when reconnected, rejects if all attempts fail
   */
  async attemptReconnection(): Promise<void> {
    return this.socketManager.attemptReconnection();
  }

  // ============================================
  // DESYNC DETECTION
  // ============================================

  /**
   * Submit state hash for desync detection
   * Call this after each simulation tick (or every N ticks based on your preference)
   *
   * The game is responsible for computing the hash using StateHasher or
   * a custom implementation. The SDK just handles transport and comparison.
   *
   * @param tick - The tick this hash is for
   * @param hash - Hash computed by game (any string)
   *
   * @example
   * ```typescript
   * client.onTick((tick, commands) => {
   *   simulation.processTick(tick, commands);
   *
   *   // Submit hash every 20 ticks (once per second at 20 TPS)
   *   if (tick % 20 === 0) {
   *     const hash = computeGameStateHash(tick);
   *     client.submitStateHash(tick, hash);
   *   }
   * });
   * ```
   */
  submitStateHash(tick: number, hash: string): void {
    this.desyncDetector.recordLocalHash(tick, hash);
    if (this.isConnected()) {
      this.socketManager.sendStateHash(tick, hash);
    }
  }

  /**
   * Configure desync detection
   * @param config - Configuration options for desync detection
   *
   * @example
   * ```typescript
   * // Disable desync detection
   * client.configureDesyncDetection({ enabled: false });
   *
   * // Limit stored hashes
   * client.configureDesyncDetection({ maxStoredHashes: 50 });
   * ```
   */
  configureDesyncDetection(config: Partial<DesyncConfig>): void {
    this.desyncDetector.configure(config);
  }

  // ============================================
  // STATE GETTERS
  // ============================================

  /**
   * Get current tick number
   */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Get current match ID
   */
  getMatchId(): string | null {
    return this.currentMatchId;
  }

  /**
   * Get player ID configured for this client
   */
  getPlayerId(): string {
    return this.config.playerId || '';
  }

  /**
   * Get username configured for this client
   */
  getUsername(): string {
    return this.config.username || '';
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private flushPendingCommands(): void {
    if (
      this.pendingCommands.length > 0 &&
      this.isConnected() &&
      this.clientState === 'playing'
    ) {
      this.submitCommandsAsync(this.currentTick, this.pendingCommands);
      this.pendingCommands = [];
    }
  }

  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error('Not connected to server. Call connect() first.');
    }
  }

  private ensurePlaying(): void {
    this.ensureConnected();
    if (
      this.clientState !== 'playing' &&
      this.clientState !== 'paused' &&
      this.clientState !== 'reconnecting'
    ) {
      throw new Error('Not in a game. Join a match first.');
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[PhalanxClient]', ...args);
    }
  }

  private logLifecycle(
    message: string,
    details: Record<string, unknown> = {},
  ): void {
    console.log(`[PhalanxClient][lifecycle] ${message}`, {
      at: new Date().toISOString(),
      playerId: this.config.playerId,
      username: this.config.username,
      clientState: this.clientState,
      connectionState: this.getConnectionState(),
      matchId: this.currentMatchId,
      ...details,
    });
  }
}
