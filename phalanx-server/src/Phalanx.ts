import { EventEmitter } from 'events';
import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  createServer as createHttpServer,
  Server as HttpServer,
  IncomingMessage,
  ServerResponse,
} from 'http';
import {
  createServer as createHttpsServer,
  Server as HttpsServer,
} from 'https';
import { readFileSync } from 'fs';
import {
  DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS,
  type AnyGameDefinition,
} from '@phalanx-engine/runtime';
import { reservedPlayerMessage } from './reservedPlayerId.js';
import type {
  PhalanxConfig,
  MatchInfo,
  RoomCreatedEvent,
  PlayerCommand,
  PhalanxEventType,
  PhalanxEventHandlers,
  SubmitCommandsEvent,
  MatchArchive,
  MatchResumeErrorReason,
  MatchResumeStateEvent,
  EndMatchResult,
} from './types/index.js';
import { validateConfig } from './config/validation.js';
import { MatchmakingService } from './services/MatchmakingService.js';
import { PrivateRoomService } from './services/PrivateRoomService.js';
import { GameRoom } from './services/GameRoom.js';
import { loadGameCatalog, type RegisteredGame } from './sim/loadGames.js';
import { createSimHost, type SimHost } from './sim/SimHost.js';
import { RoomSim } from './sim/RoomSim.js';
import { SnapshotStore } from './sim/SnapshotStore.js';
import type { PreparedServerMatch } from './sim/serverMatch.js';
import {
  SessionTokens,
  SESSION_TOMBSTONE_TTL_MS,
} from './services/SessionTokens.js';
import { TokenValidatorService } from './services/TokenValidator.js';
import {
  OAuthExchangeService,
  type TokenExchangeRequest,
} from './services/OAuthExchangeService.js';

/**
 * Socket data interface for type safety
 */
interface SocketData {
  matchId?: string;
  playerId?: string;
  /** Authenticated user ID from token validation */
  userId?: string;
  /** Authenticated username from token validation */
  username?: string;
  /** Whether this socket is authenticated */
  authenticated?: boolean;
}

/** One in-flight `match-log` read on a socket. */
interface MatchLogStream {
  generation: number;
  requestId?: string;
}

/**
 * Phalanx Engine
 * A game-agnostic deterministic lockstep multiplayer engine
 */
export class Phalanx extends EventEmitter {
  private readonly config: PhalanxConfig;
  private httpServer: HttpServer | HttpsServer | null = null;
  private io: SocketIOServer | null = null;
  private matchmaking: MatchmakingService | null = null;
  private privateRooms: PrivateRoomService | null = null;
  private tokenValidator: TokenValidatorService | null = null;
  private oauthExchange: OAuthExchangeService | null = null;
  private isRunning: boolean = false;
  /** In-flight or finished `shutdown()` for this start/stop cycle. */
  private shutdownPromise: Promise<void> | null = null;
  /** `process.once('SIGTERM')` listener installed when `handleSignals` is set. */
  private sigtermHandler: (() => void) | null = null;
  /**
   * The match-log stream currently allowed to emit on this socket.
   * A new request or `match-log-cancel` bumps `generation`, which
   * stops the previous `sendNext` chain.
   */
  private readonly matchLogStreams = new WeakMap<Socket, MatchLogStream>();
  /**
   * Archive hooks whose call has been scheduled and not yet settled.
   * Sync hooks leave the set inside the turn that runs them.
   */
  private readonly pendingArchives = new Set<Promise<void>>();
  /** Hooks queued by `scheduleArchiveHook` and not yet entered. */
  private archiveHooksScheduled: number = 0;
  /** Hooks whose function has been entered (sync or async). */
  private archiveHooksStarted: number = 0;
  /** Present only when `config.session` is set. The rooms never see it. */
  private sessionTokens: SessionTokens | null = null;
  /** Ended match → epoch ms it ended. Answers `'match-ended'` for 10 min. */
  private readonly endedMatches = new Map<string, number>();
  /** Sweeps `endedMatches`. Not tied to the tick loop. */
  private tombstoneTimer: NodeJS.Timeout | null = null;
  /** Present only when `games` is non-empty. */
  private simHost: SimHost | null = null;
  private simUnsub: (() => void) | null = null;
  private readonly snapshots = new SnapshotStore();
  private readonly serverSims = new Map<string, RoomSim>();
  private catalog: readonly RegisteredGame[] = [];
  private snapshotRequestSeq = 1;

  constructor(config?: Partial<PhalanxConfig>) {
    super();
    this.config = validateConfig(config);
  }

  /**
   * Create HTTP or HTTPS server based on TLS configuration
   */
  private createServer(): HttpServer | HttpsServer {
    const requestHandler = async (
      req: IncomingMessage,
      res: ServerResponse
    ) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        this.setCorsHeaders(res, req);
        res.writeHead(204);
        res.end();
        return;
      }

      // Delegate to consumer-provided handler first (e.g. bot webhook)
      if (this.config.extraRequestHandler) {
        try {
          const consumed = await this.config.extraRequestHandler(req, res);
          if (consumed) return;
        } catch (err) {
          console.error('[Phalanx] extraRequestHandler threw an error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
          return;
        }
      }

      // Health check endpoint
      if (req.url === '/' || req.url === '/health') {
        this.setCorsHeaders(res, req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            tls: !!this.config.tls?.enabled,
          })
        );
        return;
      }

      // OAuth token exchange endpoint
      if (req.url === '/auth/token' && req.method === 'POST') {
        await this.handleTokenExchange(req, res);
        return;
      }

      // 404 for other routes
      this.setCorsHeaders(res, req);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    };

    if (this.config.tls?.enabled) {
      try {
        const tlsOptions = {
          key: readFileSync(this.config.tls.keyPath),
          cert: readFileSync(this.config.tls.certPath),
          ca: this.config.tls.caPath
            ? readFileSync(this.config.tls.caPath)
            : undefined,
        };

        console.log('[Phalanx] Starting with TLS enabled (WSS)');
        return createHttpsServer(
          tlsOptions,
          (req, res) => void requestHandler(req, res)
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to load TLS certificates: ${message}`);
      }
    }

    console.log('[Phalanx] Starting without TLS (development mode)');
    return createHttpServer((req, res) => void requestHandler(req, res));
  }

  /**
   * Set CORS headers on response
   */
  private setCorsHeaders(res: ServerResponse, req?: IncomingMessage): void {
    const configuredOrigins = Array.isArray(this.config.cors.origin)
      ? this.config.cors.origin
      : [this.config.cors.origin];

    // Get the request Origin header
    const requestOrigin = req?.headers.origin;

    // Check if the request origin is in our allowed list
    let allowedOrigin: string;
    if (requestOrigin && configuredOrigins.includes(requestOrigin)) {
      allowedOrigin = requestOrigin;
    } else if (configuredOrigins.includes('*')) {
      allowedOrigin = '*';
    } else {
      // Default to first configured origin (for preflight without Origin header)
      allowedOrigin = configuredOrigins[0] || '*';
    }

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (this.config.cors.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  /**
   * Handle OAuth token exchange request
   */
  private async handleTokenExchange(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    this.setCorsHeaders(res, req);

    if (!this.oauthExchange) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: 'OAuth not configured',
          errorCode: 'not_configured',
        })
      );
      return;
    }

    try {
      // Read request body
      const body = await this.readRequestBody(req);
      const request = JSON.parse(body) as TokenExchangeRequest;

      // Validate required fields
      if (
        !request.code ||
        !request.codeVerifier ||
        !request.redirectUri ||
        !request.provider
      ) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error:
              'Missing required fields: code, codeVerifier, redirectUri, provider',
            errorCode: 'invalid_request',
          })
        );
        return;
      }

      // Exchange the code for tokens
      const result = await this.oauthExchange.exchangeCode(request);

      res.writeHead(result.success ? 200 : 400, {
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error('[Phalanx] Token exchange error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: 'Internal server error',
          errorCode: 'server_error',
        })
      );
    }
  }

  /**
   * Read the full request body as a string
   */
  private readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
        // Limit body size to 1MB
        if (body.length > 1024 * 1024) {
          reject(new Error('Request body too large'));
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Start the Phalanx server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Phalanx server is already running');
    }

    this.shutdownPromise = null;
    this.pendingArchives.clear();
    this.archiveHooksScheduled = 0;
    this.archiveHooksStarted = 0;

    // Create HTTP/HTTPS server with health check endpoint
    this.httpServer = this.createServer();

    // Create Socket.IO server
    this.io = new SocketIOServer(this.httpServer, {
      cors: this.config.cors,
    });

    // Setup authentication if enabled
    if (this.config.auth?.enabled) {
      this.tokenValidator = new TokenValidatorService(this.config.auth);
      this.oauthExchange = new OAuthExchangeService(this.config.auth);
      this.setupAuthMiddleware();
      console.log('[Phalanx] Authentication enabled');
      if (this.config.auth.google?.clientSecret) {
        console.log(
          '[Phalanx] OAuth token exchange endpoint available at /auth/token'
        );
      }
    } else {
      console.log('[Phalanx] Authentication disabled (development mode)');
    }

    // Task 9. No `session` config: no tokens, no tombstones, and
    // `match-resume` answers `'invalid'`.
    this.sessionTokens = this.config.session
      ? new SessionTokens(this.config.session)
      : null;
    if (this.sessionTokens) {
      this.tombstoneTimer = setInterval(() => {
        this.pruneTombstones(Date.now());
      }, TOMBSTONE_SWEEP_MS);
      this.tombstoneTimer.unref();
    }

    // Create matchmaking service
    this.matchmaking = new MatchmakingService(
      this.io,
      this.config,
      (event: string, ...args: unknown[]) => this.emit(event, ...args)
    );

    // Create private room service
    this.privateRooms = new PrivateRoomService(
      this.io,
      this.config,
      (event: string, ...args: unknown[]) => this.emit(event, ...args),
      (gameType: string) => this.matchmaking!.resolveGameTypeConfig(gameType),
      (playerId: string) => this.matchmaking!.isInAnyQueue(playerId)
    );

    // Archive a started match, tombstone the id so a session token
    // answers `'match-ended'`, then prune both services. One listener
    // covers every ending, including `stop()` during countdown.
    this.on(
      'match-ended' as PhalanxEventType,
      ((matchId: string, reason: string) => {
        const room = this.findMatch(matchId);
        if (room) {
          room.endServerSim();
          const taken = room.takeArchive(reason);
          if (taken) this.scheduleArchiveHook(taken.archive, taken.hook);
        }
        if (this.sessionTokens) {
          this.endedMatches.set(matchId, Date.now());
        }
        this.matchmaking?.removeMatch(matchId);
        this.privateRooms?.removeMatch(matchId);
      }) as PhalanxEventHandlers[PhalanxEventType]
    );

    // `match-created` is emitted before `GameRoom.start()`, so the
    // issuer is installed before the `match-found` token.
    this.on('match-created', (match) => {
      this.bindSessionIssuer(match.id);
    });

    // Setup socket handlers
    this.setupSocketHandlers();

    // Start matchmaking
    this.matchmaking.start();

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.port, () => {
        this.isRunning = true;
        void this.bootSim()
          .then(() => {
            this.registerSigterm();
            resolve();
          })
          .catch((error: unknown) => {
            void this.stop().then(() => {
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          });
      });

      this.httpServer!.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Load configured games and start the sim host. No `games` means the
   * relay is unchanged and no worker is spawned.
   */
  private async bootSim(): Promise<void> {
    const games = this.config.games;
    if (games === undefined || games.length === 0) return;
    this.catalog = await loadGameCatalog(this.config);
    const inline = new Map<string, AnyGameDefinition>();
    for (const game of this.catalog) {
      if (game.inline) inline.set(game.id, game.definition);
    }
    const mode = this.config.simHost?.mode ?? 'worker';
    const limits = this.config.simHost?.resourceLimits;
    this.simHost = createSimHost({
      mode,
      inline,
      ...(limits !== undefined ? { resourceLimits: limits } : {}),
    });
    this.simUnsub = this.simHost.subscribe((message) => {
      if (!('matchId' in message)) return;
      this.serverSims.get(message.matchId)?.onMessage(message);
    });
    const every =
      this.config.simHost?.snapshotEveryTicks ??
      DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS;
    this.privateRooms?.setServerSim({
      catalog: this.catalog,
      ...(this.config.simHost?.maxMatches !== undefined
        ? { maxMatches: this.config.simHost.maxMatches }
        : {}),
      available: () => this.simHost?.healthy() ?? false,
      attach: (room, prepared) => {
        this.attachPrepared(room, prepared, every);
      },
    });
  }

  private attachPrepared(
    room: GameRoom,
    prepared: PreparedServerMatch,
    snapshotEveryTicks: number
  ): void {
    const host = this.simHost;
    if (host === null) return;
    const matchId = room.getId();
    const rooms = this.privateRooms;
    const session = new RoomSim({
      matchId,
      host,
      store: this.snapshots,
      game: prepared.game,
      seed: room.getRandomSeed(),
      slots: prepared.slots,
      inputDelayTicks: prepared.inputDelayTicks,
      maxTickAhead: this.config.maxTickAhead,
      snapshotEveryTicks,
      extras: prepared.extras,
      enqueue: (commands) => {
        room.enqueueStamped(commands);
      },
      currentTick: () => room.getCurrentTick(),
      endMatch: (result) => room.endMatch(result),
      haltRelay: () => {
        room.haltForSim();
      },
      releaseHold: () => {
        room.releaseSimHold();
      },
      emitPlayer: (playerId, event, payload) => {
        room.emitToPlayer(playerId, event, payload);
      },
      emitServer: (event, ...args) => {
        this.emit(event, ...args);
      },
      onClosed: () => {
        this.serverSims.delete(matchId);
        this.snapshots.delete(matchId);
        rooms?.releaseServerMatch();
      },
    });
    this.serverSims.set(matchId, session);
    room.attachServerSim(session);
    const policyName = prepared.absencePolicy;
    if (policyName !== undefined && this.config.absence) {
      room.setAbsencePolicy({
        onAbsent: (playerId) => {
          session.setController(playerId, 'bot', policyName);
        },
        onReturn: (playerId) => {
          session.setController(playerId, 'human');
        },
        onExpire: (playerId) => {
          room.forfeitAbsent(playerId);
        },
      });
    }
  }

  /**
   * End each server match and wait for the sim to drop it, close the
   * host, then detach. Unsubscribing first would discard `ended`.
   */
  private async closeSimHost(): Promise<void> {
    const host = this.simHost;
    const endings = [...this.serverSims.values()].map((session) =>
      session.end()
    );
    await Promise.all(endings);
    if (host) await host.close();
    this.simUnsub?.();
    this.simUnsub = null;
    this.simHost = null;
    this.serverSims.clear();
  }

  /**
   * End a live match. Returns false when the id is unknown or the match
   * has already finished. The sim outcome path uses the same room method.
   */
  endMatch(matchId: string, result: EndMatchResult): boolean {
    const room = this.findMatch(matchId);
    if (!room) return false;
    return room.endMatch(result);
  }

  /** Bound port. `0` in config becomes the ephemeral port after `start()`. */
  getPort(): number {
    const address = this.httpServer?.address();
    if (address && typeof address === 'object') return address.port;
    return this.config.port;
  }

  /**
   * Create or reuse a private room for a host that will connect later.
   * Intended for trusted server-side integrations such as Telegram bot
   * commands; browser clients should continue using the Socket.IO flow.
   */
  createPrivateRoomForHost(params: {
    playerId: string;
    username?: string;
    gameType?: string;
  }): RoomCreatedEvent {
    if (!this.privateRooms) {
      throw new Error('Private room service is not running');
    }

    return this.privateRooms.createRoomForDisconnectedHost(
      params.playerId,
      params.username ?? params.playerId,
      params.gameType
    );
  }

  /**
   * Tell every active match the process is going away, wait
   * `shutdownGraceMs`, then `stop()`. After `stop()`, wait for archive
   * hooks that are still running, again up to `shutdownGraceMs`.
   * Hooks for matches this call stops are queued inside `stop()`, so
   * the wait has to follow it. A second call returns the same promise
   * and does not emit again. Does not call `process.exit`.
   */
  shutdown(reason: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.performShutdown(reason);
    return this.shutdownPromise;
  }

  private async performShutdown(reason: string): Promise<void> {
    const matchIds = this.getActiveMatches().map((match) => match.id);
    const payload = { reason, matchIds };
    if (this.io) {
      for (const matchId of matchIds) {
        this.io.to(matchId).emit('server-shutdown', payload);
      }
    }

    const grace = this.config.shutdownGraceMs ?? 0;
    if (grace > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, grace);
      });
    } else {
      // Yield once so `server-shutdown` can be written to sockets
      // before `stop()` tears the rooms down.
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }

    await this.stop();
    // Matches stopped above queue their hooks inside `stop()`. Waiting
    // before `stop()` would drop those logs. Worst case is about
    // 2 × `shutdownGraceMs` plus closing the server.
    await this.waitForArchiveHooks();
  }

  /**
   * Run `onMatchArchived` after `match-end` has been emitted.
   * `stop()` emits `match-ended` before `match-end`, so the call is
   * deferred. A second `setImmediate` lands in the check phase after
   * the poll that delivers `match-end` to local clients.
   * The tracked promise stays in `pendingArchives` until the hook
   * returns or its promise settles, including a throw or rejection.
   * `hook` is the function `takeArchive` used to build `archive`.
   */
  private scheduleArchiveHook(
    archive: MatchArchive,
    hook: (rec: MatchArchive) => void | Promise<void>
  ): void {
    let settle = (): void => {};
    const tracked = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.pendingArchives.add(tracked);
    this.archiveHooksScheduled += 1;

    const finish = (): void => {
      this.pendingArchives.delete(tracked);
      settle();
    };
    const run = (): void => {
      this.archiveHooksStarted += 1;
      try {
        const result = hook(archive);
        if (isThenable(result)) {
          void result
            .then(
              () => undefined,
              (error: unknown) => {
                this.logArchiveHookError(archive.matchId, error);
              }
            )
            .finally(finish);
          return;
        }
        finish();
      } catch (error) {
        this.logArchiveHookError(archive.matchId, error);
        finish();
      }
    };

    setImmediate(() => {
      setImmediate(run);
    });
  }

  /**
   * Let scheduled hooks start, then wait up to `shutdownGraceMs`.
   * Grace `0` or unset returns once the hooks have been called and
   * does not await async hooks. The timer is cleared when the hooks
   * finish first so it does not hold the process.
   */
  private async waitForArchiveHooks(): Promise<void> {
    while (this.archiveHooksStarted < this.archiveHooksScheduled) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }

    const grace = this.config.shutdownGraceMs ?? 0;
    if (grace === 0 || this.pendingArchives.size === 0) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, grace);
      void Promise.allSettled([...this.pendingArchives]).then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private logArchiveHookError(matchId: string, error: unknown): void {
    console.error(
      `[Phalanx] onMatchArchived failed for match ${matchId}:`,
      error
    );
  }

  private registerSigterm(): void {
    if (!(this.config.handleSignals ?? false)) return;
    if (this.sigtermHandler) return;
    this.sigtermHandler = () => {
      void this.shutdown('sigterm');
    };
    process.once('SIGTERM', this.sigtermHandler);
  }

  private unregisterSigterm(): void {
    if (!this.sigtermHandler) return;
    process.removeListener('SIGTERM', this.sigtermHandler);
    this.sigtermHandler = null;
  }

  /**
   * Stop the Phalanx server
   */
  async stop(): Promise<void> {
    this.unregisterSigterm();
    this.clearSessionBookkeeping();
    if (!this.isRunning) {
      await this.closeSimHost();
      return;
    }

    this.isRunning = false;

    // Stop matchmaking first
    if (this.matchmaking) {
      this.matchmaking.stop();
      this.matchmaking = null;
    }

    // Stop private rooms while the sim host can still take `end`.
    if (this.privateRooms) {
      this.privateRooms.stop();
      this.privateRooms = null;
    }

    await this.closeSimHost();

    // Disconnect all sockets first
    if (this.io) {
      this.io.disconnectSockets(true);
    }

    // Close HTTP server (this also closes Socket.IO)
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.io = null;
  }

  /**
   * Setup authentication middleware for Socket.IO connections.
   * Validates tokens before allowing connections.
   */
  private setupAuthMiddleware(): void {
    if (!this.io || !this.tokenValidator) return;

    this.io.use(async (socket, next) => {
      const token = socket.handshake.auth?.token as string | undefined;

      // Check if token is provided
      if (!token) {
        // Allow anonymous if configured
        if (this.config.auth?.allowAnonymous) {
          console.log(`[Phalanx] Anonymous connection allowed: ${socket.id}`);
          (socket.data as SocketData).authenticated = false;
          return next();
        }

        console.log(`[Phalanx] Connection rejected - no token: ${socket.id}`);
        return next(new Error('Authentication required'));
      }

      // Validate the token
      const result = await this.tokenValidator!.validate(token);

      if (!result.valid) {
        console.log(
          `[Phalanx] Connection rejected - invalid token: ${socket.id} - ${result.error}`
        );
        return next(new Error(result.error || 'Invalid token'));
      }

      // Store authenticated user info on socket
      (socket.data as SocketData).authenticated = true;
      (socket.data as SocketData).userId = result.userId;
      (socket.data as SocketData).username = result.username;

      console.log(
        `[Phalanx] Authenticated connection: ${socket.id} - User: ${result.userId}`
      );
      next();
    });
  }

  /**
   * Setup socket event handlers
   */
  private setupSocketHandlers(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      let playerId: string | null = null;

      // Track activity on ANY message from client (LOCKSTEP-5)
      // This replaces tick-ack - any message = player is alive
      socket.onAny(() => {
        if (playerId && (socket.data as SocketData).matchId) {
          const gameRoom = this.findMatch((socket.data as SocketData).matchId!);
          if (gameRoom) {
            gameRoom.updatePlayerActivity(playerId);
          }
        }
      });

      // Handle join queue (MATCH-1)
      socket.on(
        'queue-join',
        (data: {
          playerId: string;
          username?: string;
          gameType?: string;
          buildId?: unknown;
        }) => {
          const reserved = reservedPlayerMessage(data.playerId);
          if (reserved !== null) {
            socket.emit('error', { message: reserved });
            return;
          }
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.matchmaking!.joinQueue(
            playerId,
            username,
            socket,
            data.gameType,
            readOptionalBuildId(data.buildId)
          );
        }
      );

      // Handle leave queue (MATCH-2)
      socket.on('queue-leave', () => {
        if (playerId) {
          this.matchmaking!.leaveQueue(playerId, socket);
        }
      });

      // Handle room-create (private match)
      socket.on(
        'room-create',
        (data: {
          playerId: string;
          username?: string;
          gameType?: string;
          buildId?: unknown;
          matchConfig?: unknown;
        }) => {
          const reserved = reservedPlayerMessage(data.playerId);
          if (reserved !== null) {
            socket.emit('room-error', { message: reserved });
            return;
          }
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.privateRooms!.createRoom(
            playerId,
            username,
            socket,
            data.gameType,
            readOptionalBuildId(data.buildId),
            data.matchConfig
          );
        }
      );

      // Handle room-join (private match)
      socket.on(
        'room-join',
        (data: {
          playerId: string;
          username?: string;
          code: string;
          buildId?: unknown;
        }) => {
          const reserved = reservedPlayerMessage(data.playerId);
          if (reserved !== null) {
            socket.emit('room-error', { message: reserved });
            return;
          }
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.privateRooms!.joinRoom(
            playerId,
            username,
            socket,
            data.code,
            readOptionalBuildId(data.buildId)
          );
        }
      );

      // Handle room-cancel (private match)
      socket.on('room-cancel', () => {
        if (playerId) {
          this.privateRooms!.cancelRoom(playerId, socket);
        }
      });

      // Handle room-recover (private match)
      // Called when a host reconnects after a transient socket disconnect
      // (e.g. mobile browser killing the WebSocket when the user switches
      // to a messenger to share the invite link) and wants to reclaim
      // their still-alive room. `code` is required to prove the caller
      // is actually the host who created the room — in an anonymous
      // socket environment, `playerId` alone is not an authentication
      // token. If it's missing we reject with the same `Room expired`
      // error the service itself uses, so clients can't distinguish
      // "wrong code" from "missing code" from "no such room".
      socket.on('room-recover', (payload: unknown) => {
        // The payload is untrusted — a client can emit literally
        // anything (including `null`, a primitive, or a missing
        // argument, which Socket.IO will surface as `undefined`).
        // Guard the top-level shape before dereferencing any field
        // so a malformed message can't crash the connection
        // handler, and validate each field before touching state
        // on this connection. A failed recover must not mutate the
        // captured `playerId` — otherwise a later handler like
        // `room-cancel` would act on a playerId the socket was
        // never authenticated to own.
        if (!payload || typeof payload !== 'object') {
          socket.emit('room-error', { message: 'Room expired' });
          return;
        }
        const data = payload as {
          playerId?: unknown;
          username?: unknown;
          code?: unknown;
        };
        if (typeof data.code !== 'string' || data.code.length === 0) {
          socket.emit('room-error', { message: 'Room expired' });
          return;
        }
        if (typeof data.playerId !== 'string' || data.playerId.length === 0) {
          socket.emit('room-error', { message: 'Room expired' });
          return;
        }
        const reserved = reservedPlayerMessage(data.playerId);
        if (reserved !== null) {
          socket.emit('room-error', { message: reserved });
          return;
        }
        const recovered = this.privateRooms!.recoverRoom(
          data.playerId,
          socket,
          data.code
        );
        if (recovered) {
          playerId = data.playerId;
        }
      });

      // Handle player command. A superseded socket still has a closure
      // `playerId`; only the socket currently in `socketToPlayer` may act.
      socket.on('player-command', (command: PlayerCommand) => {
        if (!playerId) return;

        // Find the match this player is in (check both matchmaking and private rooms)
        const matchId = (socket.data as SocketData).matchId;
        const gameRoom = matchId ? this.findMatch(matchId) : undefined;
        if (gameRoom && gameRoom.isParticipantSocket(socket.id)) {
          const accepted = gameRoom.handleCommand(playerId, command);
          socket.emit('command-ack', {
            tick: command.tick,
            accepted,
          });
          return;
        }

        socket.emit('command-ack', { tick: command.tick, accepted: false });
      });

      // Handle submit-commands (LOCKSTEP-2): batch command submission for a specific tick
      // Clients can submit empty arrays if they have no commands for this tick
      socket.on('submit-commands', (data: SubmitCommandsEvent) => {
        if (!playerId) return;

        const { tick, commands } = data;

        // Validate input
        if (!Number.isFinite(tick) || !Array.isArray(commands)) {
          socket.emit('submit-commands-ack', {
            tick,
            accepted: false,
            reason: 'Invalid data',
          });
          return;
        }

        // Find the match this player is in via socket.data
        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) {
          socket.emit('submit-commands-ack', {
            tick,
            accepted: false,
            reason: 'Not in a match',
          });
          return;
        }

        const gameRoom = this.findMatch(matchId);
        if (!gameRoom || !gameRoom.isParticipantSocket(socket.id)) {
          socket.emit('submit-commands-ack', {
            tick,
            accepted: false,
            reason: gameRoom ? 'Not in a match' : 'Match not found',
          });
          return;
        }

        // Validate each command (NET-1)
        const validCommands: PlayerCommand[] = [];
        for (const cmd of commands) {
          // Validate required fields
          if (typeof cmd.type !== 'string' || cmd.data === undefined) {
            socket.emit('command-rejected', {
              reason: 'Missing required fields (type, data)',
              tick,
              type: cmd.type,
            });
            continue;
          }

          // Enrich command with playerId and tick, preserve sequence if present
          const enrichedCommand: PlayerCommand = {
            type: cmd.type,
            data: cmd.data,
            playerId: playerId,
            tick,
            ...(cmd.sequence !== undefined && { sequence: cmd.sequence }),
          };

          validCommands.push(enrichedCommand);
        }

        const result = gameRoom.receivePlayerCommands(
          playerId,
          tick,
          validCommands
        );
        socket.emit('submit-commands-ack', {
          tick,
          accepted: result.accepted,
          ...(result.invalidCommands && {
            rejectedCount: result.invalidCommands.length,
          }),
        });
      });

      socket.on('match-snapshot-request', (payload: unknown) => {
        if (!playerId) return;
        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) return;
        const gameRoom = this.findMatch(matchId);
        if (!gameRoom || !gameRoom.isParticipantSocket(socket.id)) return;
        gameRoom.requestSnapshot(playerId, this.readSnapshotRequestId(payload));
      });

      // Handle state-hash for desync detection (2.1.3)
      socket.on('state-hash', (data: { tick: number; hash: string }) => {
        if (!playerId) return;

        const { tick, hash } = data;

        // Validate input
        if (typeof tick !== 'number' || typeof hash !== 'string') {
          return;
        }

        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) return;

        const gameRoom = this.findMatch(matchId);
        if (gameRoom) {
          gameRoom.receiveStateHash(playerId, tick, hash);
        }
      });

      // Note: tick-ack is no longer needed - we use socket.onAny() to track activity
      // Any message from client (including Socket.IO ping) = player is alive

      // Handle pause request
      socket.on('pause-game', () => {
        if (!playerId) return;
        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) return;
        const gameRoom = this.findMatch(matchId);
        if (gameRoom) {
          gameRoom.pause(playerId);
        }
      });

      // Handle resume request
      socket.on('resume-game', () => {
        if (!playerId) return;
        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) return;
        const gameRoom = this.findMatch(matchId);
        if (gameRoom) {
          gameRoom.resume(playerId);
        }
      });

      // Handle client-ready (ready handshake after asset loading)
      socket.on('client-ready', () => {
        if (!playerId) return;
        const matchId = (socket.data as SocketData).matchId;
        if (!matchId) return;
        const gameRoom = this.findMatch(matchId);
        if (gameRoom) {
          gameRoom.handlePlayerReady(playerId);
        }
      });

      // Command log for catch-up (Task 8). Only the requesting socket
      // receives chunks; the tick loop of other matches is not blocked.
      // A new request or `match-log-cancel` stops the previous stream.
      socket.on('match-log', (payload: unknown) => {
        this.handleMatchLog(socket, payload);
      });
      socket.on('match-log-cancel', (payload: unknown) => {
        this.cancelMatchLog(socket, readOptionalRequestId(payload));
      });

      // Resume into a live match by session token. The body `playerId`
      // is ignored. With no `session` config every request is `'invalid'`.
      socket.on('match-resume', (payload: unknown) => {
        const bound = this.handleMatchResume(socket, payload);
        if (bound !== null) playerId = bound;
      });

      // Handle reconnection. `requireSessionToken` closes this body-id
      // path; the default leaves it unchanged and logs nothing.
      socket.on(
        'reconnect-match',
        (data: { playerId: string; matchId: string }) => {
          if (this.config.reconnect?.requireSessionToken === true) {
            socket.emit('reconnect-status', {
              success: false,
              reason: 'session-token-required',
            });
            return;
          }
          playerId = data.playerId;
          const gameRoom = this.findMatch(data.matchId);
          if (gameRoom) {
            const success = gameRoom.handleReconnect(playerId, socket.id);
            socket.emit('reconnect-status', { success });
          } else {
            socket.emit('reconnect-status', {
              success: false,
              reason: 'Match not found',
            });
          }
        }
      );

      // Handle disconnect
      socket.on('disconnect', () => {
        if (this.matchmaking) {
          this.matchmaking.handleDisconnect(socket.id);
        }
        if (this.privateRooms) {
          this.privateRooms.handleDisconnect(socket.id);
        }
      });
    });
  }

  /**
   * Stream `match-log-chunk` events to the requesting socket.
   * One chunk is sent immediately; the next is scheduled with
   * `setImmediate` so a long log does not stall other matches.
   * Starting this request invalidates any stream already running
   * on the same socket.
   */
  private handleMatchLog(socket: Socket, payload: unknown): void {
    const parsed = parseMatchLogRequest(payload);
    const generation = this.beginMatchLog(socket, parsed.requestId);
    const requestField = requestIdField(parsed.requestId);

    const emitError = (
      matchId: string | undefined,
      reason: 'invalid' | 'not-found' | 'not-member' | 'truncated'
    ): void => {
      if (!this.matchLogIsCurrent(socket, generation)) return;
      socket.emit('match-log-error', {
        ...nonEmptyMatchId(matchId),
        ...requestField,
        reason,
      });
    };

    if (!parsed.ok) {
      emitError(parsed.matchId, 'invalid');
      return;
    }

    const gameRoom = this.findMatch(parsed.matchId);
    if (!gameRoom) {
      emitError(parsed.matchId, 'not-found');
      return;
    }

    const socketData = socket.data as SocketData;
    if (
      socketData.matchId !== parsed.matchId ||
      !gameRoom.isParticipantSocket(socket.id)
    ) {
      emitError(parsed.matchId, 'not-member');
      return;
    }

    if (gameRoom.isLogTruncated(parsed.fromTick)) {
      emitError(parsed.matchId, 'truncated');
      return;
    }

    const currentTick = gameRoom.getCurrentTick();
    const requestedEnd =
      parsed.maxTicks === undefined
        ? currentTick - 1
        : Math.min(currentTick - 1, parsed.fromTick + parsed.maxTicks - 1);

    const emitChunk = (
      fromTick: number,
      toTick: number,
      entries: { tick: number; commands: PlayerCommand[] }[],
      done: boolean
    ): boolean => {
      if (socket.disconnected) return false;
      if (!this.matchLogIsCurrent(socket, generation)) return false;
      socket.emit('match-log-chunk', {
        matchId: parsed.matchId,
        ...requestField,
        fromTick,
        toTick,
        entries,
        done,
      });
      return true;
    };

    if (requestedEnd < parsed.fromTick) {
      emitChunk(parsed.fromTick, parsed.fromTick - 1, [], true);
      return;
    }

    let cursor = parsed.fromTick;
    const sendNext = (): void => {
      // Match end drops the history. Do not emit an empty tail from
      // the cleared map; the read is over.
      if (gameRoom.isLogReleased()) {
        emitError(parsed.matchId, 'not-found');
        return;
      }
      const chunkEnd = Math.min(
        requestedEnd,
        cursor + MATCH_LOG_CHUNK_SPAN - 1
      );
      const entries = gameRoom.getLogRange(cursor, chunkEnd);
      const done = chunkEnd >= requestedEnd;
      if (!emitChunk(cursor, chunkEnd, entries, done)) return;
      if (!done) {
        cursor = chunkEnd + 1;
        setImmediate(sendNext);
      }
    };
    sendNext();
  }

  /** Bump the per-socket generation so the previous `sendNext` stops. */
  private beginMatchLog(socket: Socket, requestId: string | undefined): number {
    const generation = (this.matchLogStreams.get(socket)?.generation ?? 0) + 1;
    const stream: MatchLogStream = { generation };
    if (requestId !== undefined) stream.requestId = requestId;
    this.matchLogStreams.set(socket, stream);
    return generation;
  }

  private matchLogIsCurrent(socket: Socket, generation: number): boolean {
    return this.matchLogStreams.get(socket)?.generation === generation;
  }

  /**
   * Stop the active stream. A `requestId` only cancels that request,
   * so a late cancel cannot kill the read that replaced it.
   */
  private cancelMatchLog(socket: Socket, requestId: string | undefined): void {
    const active = this.matchLogStreams.get(socket);
    if (!active) return;
    if (requestId !== undefined && active.requestId !== requestId) return;
    this.matchLogStreams.set(socket, { generation: active.generation + 1 });
  }

  /**
   * Bind `playerId` from a verified token and answer `match-resume-state`.
   * Returns the bound player id, or `null` when the resume was refused.
   * Check order: verify, tombstone, build id, `handleReconnect`.
   * `haveTick` is only checked for shape. The client catches up with
   * `match-log` from `haveTick + 1`. It is not logged: a log line here
   * would sit next to the token.
   */
  private handleMatchResume(socket: Socket, payload: unknown): string | null {
    const fail = (reason: MatchResumeErrorReason): null => {
      socket.emit('match-resume-error', { reason });
      return null;
    };

    if (!payload || typeof payload !== 'object') return fail('invalid');
    const data = payload as {
      token?: unknown;
      buildId?: unknown;
      haveTick?: unknown;
    };
    if (typeof data.token !== 'string' || data.token.length === 0) {
      return fail('invalid');
    }
    if (!isHaveTick(data.haveTick)) return fail('invalid');
    if (data.buildId !== undefined && typeof data.buildId !== 'string') {
      return fail('invalid');
    }
    if (!this.sessionTokens) return fail('invalid');

    const nowMs = Date.now();
    const verified = this.sessionTokens.verify(data.token, nowMs);
    if (!verified.ok) return fail(verified.reason);

    const gameRoom = this.findMatch(verified.claims.matchId);
    if (!gameRoom) {
      return fail(
        this.hasFreshTombstone(verified.claims.matchId, nowMs)
          ? 'match-ended'
          : 'invalid'
      );
    }

    const clientBuildId =
      typeof data.buildId === 'string' ? data.buildId : undefined;
    const matchBuildId = gameRoom.getBuildId();
    if (
      matchBuildId !== undefined &&
      clientBuildId !== undefined &&
      clientBuildId !== matchBuildId
    ) {
      return fail('build-mismatch');
    }
    if (clientBuildId === undefined && (this.config.requireBuildId ?? false)) {
      return fail('build-mismatch');
    }

    const tokenPlayerId = verified.claims.playerId;
    if (!gameRoom.handleReconnect(tokenPlayerId, socket.id)) {
      return fail('invalid');
    }

    const info = gameRoom.getMatchInfo();
    const response: MatchResumeStateEvent = {
      matchId: verified.claims.matchId,
      slot: gameRoom.getPlayerSlot(tokenPlayerId),
      currentTick: info.currentTick,
      state: info.state,
    };
    const absentDeadline = nearestOtherAbsence(gameRoom, tokenPlayerId);
    if (absentDeadline !== undefined) {
      response.absentDeadline = absentDeadline;
    }
    const snapshotTick = gameRoom.latestSnapshotTick();
    if (snapshotTick !== undefined) {
      response.snapshot = { tick: snapshotTick };
    }
    socket.emit('match-resume-state', response);
    return tokenPlayerId;
  }

  private readSnapshotRequestId(payload: unknown): number {
    if (payload && typeof payload === 'object' && 'requestId' in payload) {
      const requestId = (payload as { requestId?: unknown }).requestId;
      if (
        typeof requestId === 'number' &&
        Number.isInteger(requestId) &&
        requestId >= 0
      ) {
        return requestId;
      }
    }
    const requestId = this.snapshotRequestSeq;
    this.snapshotRequestSeq += 1;
    return requestId;
  }

  private bindSessionIssuer(matchId: string): void {
    const tokens = this.sessionTokens;
    if (!tokens) return;
    const room = this.findMatch(matchId);
    if (!room) return;
    room.setSessionIssuer((claims) => tokens.issue(claims));
  }

  private hasFreshTombstone(matchId: string, nowMs: number): boolean {
    const endedAt = this.endedMatches.get(matchId);
    if (endedAt === undefined) return false;
    if (nowMs >= endedAt + SESSION_TOMBSTONE_TTL_MS) {
      this.endedMatches.delete(matchId);
      return false;
    }
    return true;
  }

  private pruneTombstones(nowMs: number): void {
    for (const [matchId, endedAt] of this.endedMatches) {
      if (nowMs >= endedAt + SESSION_TOMBSTONE_TTL_MS) {
        this.endedMatches.delete(matchId);
      }
    }
  }

  private clearSessionBookkeeping(): void {
    if (this.tombstoneTimer) {
      clearInterval(this.tombstoneTimer);
      this.tombstoneTimer = null;
    }
    this.endedMatches.clear();
    this.sessionTokens = null;
  }

  /**
   * Find a GameRoom by matchId across both matchmaking and private room services.
   */
  private findMatch(matchId: string): GameRoom | undefined {
    return (
      this.matchmaking?.getMatch(matchId) ??
      this.privateRooms?.getMatch(matchId)
    );
  }

  /**
   * Register an event handler
   */
  override on<E extends PhalanxEventType>(
    event: E,
    handler: PhalanxEventHandlers[E]
  ): this {
    return super.on(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Remove an event handler
   */
  override off<E extends PhalanxEventType>(
    event: E,
    handler: PhalanxEventHandlers[E]
  ): this {
    return super.off(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Get all active matches (from both matchmaking and private rooms)
   */
  getActiveMatches(): MatchInfo[] {
    const matchmakingMatches = this.matchmaking?.getActiveMatches() ?? [];
    const privateMatches =
      this.privateRooms?.getActiveMatches().map((m) => m.getMatchInfo()) ?? [];
    return [...matchmakingMatches, ...privateMatches];
  }

  /**
   * Get current matchmaking queue size
   */
  getQueueSize(): number {
    return this.matchmaking?.getQueueSize() ?? 0;
  }

  /**
   * Get the current configuration
   */
  getConfig(): PhalanxConfig {
    return { ...this.config };
  }
}

/** Inclusive tick span of one `match-log-chunk`. */
const MATCH_LOG_CHUNK_SPAN = 2000;
/** How often ended-match tombstones are dropped. Not a simulation tick. */
const TOMBSTONE_SWEEP_MS = 60_000;

function isThenable(value: unknown): value is PromiseLike<void> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isHaveTick(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1;
}

/**
 * Soonest `deadlineMs` among absences that are not `selfId`.
 * `handleReconnect` has already stopped `selfId`'s timer.
 * Omitted when nobody else is absent.
 */
function nearestOtherAbsence(
  room: GameRoom,
  selfId: string
): number | undefined {
  let nearest: number | undefined;
  for (const row of room.getAbsences()) {
    if (row.playerId === selfId) continue;
    if (nearest === undefined || row.deadlineMs < nearest) {
      nearest = row.deadlineMs;
    }
  }
  return nearest;
}
const BUILD_ID_MAX_LENGTH = 128;

/**
 * `buildId` from a join payload. Anything that is not a string of length
 * 1–128 is ignored, the same way unknown extra fields are ignored today.
 */
function readOptionalBuildId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length < 1 || value.length > BUILD_ID_MAX_LENGTH) return undefined;
  return value;
}

/** `matchId` is sent only when the request carried a non-empty string. */
function nonEmptyMatchId(
  matchId: string | undefined
): { matchId: string } | Record<string, never> {
  if (matchId === undefined || matchId.length === 0) return {};
  return { matchId };
}

function requestIdField(
  requestId: string | undefined
): { requestId: string } | Record<string, never> {
  if (requestId === undefined || requestId.length === 0) return {};
  return { requestId };
}

/** Non-empty `requestId` from a `match-log` or `match-log-cancel` payload. */
function readOptionalRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as { requestId?: unknown }).requestId;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

function isIntAtLeast(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function parseMatchLogRequest(payload: unknown):
  | {
      ok: true;
      matchId: string;
      fromTick: number;
      maxTicks?: number;
      requestId?: string;
    }
  | { ok: false; matchId?: string; requestId?: string } {
  const requestId = readOptionalRequestId(payload);
  if (!payload || typeof payload !== 'object') {
    return { ok: false, ...requestIdField(requestId) };
  }
  const data = payload as {
    matchId?: unknown;
    fromTick?: unknown;
    maxTicks?: unknown;
  };
  const matchId =
    typeof data.matchId === 'string' && data.matchId.length > 0
      ? data.matchId
      : undefined;
  if (matchId === undefined) {
    return { ok: false, ...requestIdField(requestId) };
  }
  if (!isIntAtLeast(data.fromTick, 0)) {
    return { ok: false, matchId, ...requestIdField(requestId) };
  }
  if (data.maxTicks !== undefined && !isIntAtLeast(data.maxTicks, 1)) {
    return { ok: false, matchId, ...requestIdField(requestId) };
  }
  return {
    ok: true,
    matchId,
    fromTick: data.fromTick,
    ...requestIdField(requestId),
    ...(data.maxTicks !== undefined ? { maxTicks: data.maxTicks } : {}),
  };
}
