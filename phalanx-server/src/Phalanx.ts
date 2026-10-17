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
import type {
  PhalanxConfig,
  MatchInfo,
  RoomCreatedEvent,
  PlayerCommand,
  PhalanxEventType,
  PhalanxEventHandlers,
  SubmitCommandsEvent,
} from './types/index.js';
import { validateConfig } from './config/validation.js';
import { MatchmakingService } from './services/MatchmakingService.js';
import { PrivateRoomService } from './services/PrivateRoomService.js';
import { GameRoom } from './services/GameRoom.js';
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

    // Wire up match-ended event to prune finished matches from both services
    this.on(
      'match-ended' as PhalanxEventType,
      ((matchId: string) => {
        this.matchmaking?.removeMatch(matchId);
        this.privateRooms?.removeMatch(matchId);
      }) as PhalanxEventHandlers[PhalanxEventType]
    );

    // Setup socket handlers
    this.setupSocketHandlers();

    // Start matchmaking
    this.matchmaking.start();

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.port, () => {
        this.isRunning = true;
        this.registerSigterm();
        resolve();
      });

      this.httpServer!.on('error', (err) => {
        reject(err);
      });
    });
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
   * `shutdownGraceMs`, then `stop()`. A second call returns the same
   * promise and does not emit again. Does not call `process.exit`.
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
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop matchmaking first
    if (this.matchmaking) {
      this.matchmaking.stop();
      this.matchmaking = null;
    }

    // Stop private rooms
    if (this.privateRooms) {
      this.privateRooms.stop();
      this.privateRooms = null;
    }

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
        }) => {
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.privateRooms!.createRoom(
            playerId,
            username,
            socket,
            data.gameType,
            readOptionalBuildId(data.buildId)
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
        const recovered = this.privateRooms!.recoverRoom(
          data.playerId,
          socket,
          data.code
        );
        if (recovered) {
          playerId = data.playerId;
        }
      });

      // Handle player command
      socket.on('player-command', (command: PlayerCommand) => {
        if (!playerId) return;

        // Find the match this player is in (check both matchmaking and private rooms)
        const matchId = (socket.data as SocketData).matchId;
        const gameRoom = matchId ? this.findMatch(matchId) : undefined;
        if (gameRoom) {
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
        if (!gameRoom) {
          socket.emit('submit-commands-ack', {
            tick,
            accepted: false,
            reason: 'Match not found',
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
      socket.on('match-log', (payload: unknown) => {
        this.handleMatchLog(socket, payload);
      });

      // Handle reconnection
      socket.on(
        'reconnect-match',
        (data: { playerId: string; matchId: string }) => {
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
   */
  private handleMatchLog(socket: Socket, payload: unknown): void {
    const parsed = parseMatchLogRequest(payload);
    if (!parsed.ok) {
      socket.emit('match-log-error', {
        ...nonEmptyMatchId(parsed.matchId),
        reason: 'invalid',
      });
      return;
    }

    const gameRoom = this.findMatch(parsed.matchId);
    if (!gameRoom) {
      socket.emit('match-log-error', {
        matchId: parsed.matchId,
        reason: 'not-found',
      });
      return;
    }

    const socketData = socket.data as SocketData;
    if (
      socketData.matchId !== parsed.matchId ||
      !gameRoom.isParticipantSocket(socket.id)
    ) {
      socket.emit('match-log-error', {
        matchId: parsed.matchId,
        reason: 'not-member',
      });
      return;
    }

    if (gameRoom.isLogTruncated(parsed.fromTick)) {
      socket.emit('match-log-error', {
        matchId: parsed.matchId,
        reason: 'truncated',
      });
      return;
    }

    const currentTick = gameRoom.getCurrentTick();
    const requestedEnd =
      parsed.maxTicks === undefined
        ? currentTick - 1
        : Math.min(currentTick - 1, parsed.fromTick + parsed.maxTicks - 1);

    if (requestedEnd < parsed.fromTick) {
      socket.emit('match-log-chunk', {
        matchId: parsed.matchId,
        fromTick: parsed.fromTick,
        toTick: parsed.fromTick - 1,
        entries: [],
        done: true,
      });
      return;
    }

    const matchId = parsed.matchId;
    let cursor = parsed.fromTick;
    const sendNext = (): void => {
      if (socket.disconnected) return;
      const chunkEnd = Math.min(
        requestedEnd,
        cursor + MATCH_LOG_CHUNK_SPAN - 1
      );
      const entries = gameRoom.getLogRange(cursor, chunkEnd);
      const done = chunkEnd >= requestedEnd;
      socket.emit('match-log-chunk', {
        matchId,
        fromTick: cursor,
        toTick: chunkEnd,
        entries,
        done,
      });
      if (!done) {
        cursor = chunkEnd + 1;
        setImmediate(sendNext);
      }
    };
    sendNext();
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

function isIntAtLeast(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function parseMatchLogRequest(
  payload: unknown
):
  | { ok: true; matchId: string; fromTick: number; maxTicks?: number }
  | { ok: false; matchId?: string } {
  if (!payload || typeof payload !== 'object') return { ok: false };
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
    return { ok: false };
  }
  if (!isIntAtLeast(data.fromTick, 0)) {
    return { ok: false, matchId };
  }
  if (data.maxTicks !== undefined && !isIntAtLeast(data.maxTicks, 1)) {
    return { ok: false, matchId };
  }
  return {
    ok: true,
    matchId,
    fromTick: data.fromTick,
    ...(data.maxTicks !== undefined ? { maxTicks: data.maxTicks } : {}),
  };
}
