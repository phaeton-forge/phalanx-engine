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

  constructor(config?: Partial<PhalanxConfig>) {
    super();
    this.config = validateConfig(config);
  }

  /**
   * Create HTTP or HTTPS server based on TLS configuration
   */
  private createServer(): HttpServer | HttpsServer {
    const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        this.setCorsHeaders(res, req);
        res.writeHead(204);
        res.end();
        return;
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
        return createHttpsServer(tlsOptions, (req, res) => void requestHandler(req, res));
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
  private async handleTokenExchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.setCorsHeaders(res, req);

    if (!this.oauthExchange) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'OAuth not configured',
        errorCode: 'not_configured'
      }));
      return;
    }

    try {
      // Read request body
      const body = await this.readRequestBody(req);
      const request = JSON.parse(body) as TokenExchangeRequest;

      // Validate required fields
      if (!request.code || !request.codeVerifier || !request.redirectUri || !request.provider) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Missing required fields: code, codeVerifier, redirectUri, provider',
          errorCode: 'invalid_request'
        }));
        return;
      }

      // Exchange the code for tokens
      const result = await this.oauthExchange.exchangeCode(request);

      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      console.error('[Phalanx] Token exchange error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Internal server error',
        errorCode: 'server_error'
      }));
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
        console.log('[Phalanx] OAuth token exchange endpoint available at /auth/token');
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
      (playerId: string) => this.matchmaking!.isInAnyQueue(playerId),
    );

    // Wire up match-ended event to prune finished matches from both services
    this.on('match-ended' as PhalanxEventType, ((matchId: string) => {
      this.matchmaking?.removeMatch(matchId);
      this.privateRooms?.removeMatch(matchId);
    }) as PhalanxEventHandlers[PhalanxEventType]);

    // Setup socket handlers
    this.setupSocketHandlers();

    // Start matchmaking
    this.matchmaking.start();

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.port, () => {
        this.isRunning = true;
        resolve();
      });

      this.httpServer!.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Stop the Phalanx server
   */
  async stop(): Promise<void> {
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
          console.log(
            `[Phalanx] Anonymous connection allowed: ${socket.id}`
          );
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
          const gameRoom = this.findMatch(
            (socket.data as SocketData).matchId!
          );
          if (gameRoom) {
            gameRoom.updatePlayerActivity(playerId);
          }
        }
      });

      // Handle join queue (MATCH-1)
      socket.on(
        'queue-join',
        (data: { playerId: string; username?: string; gameType?: string }) => {
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.matchmaking!.joinQueue(playerId, username, socket, data.gameType);
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
        (data: { playerId: string; username?: string; gameType?: string }) => {
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.privateRooms!.createRoom(playerId, username, socket, data.gameType);
        }
      );

      // Handle room-join (private match)
      socket.on(
        'room-join',
        (data: { playerId: string; username?: string; code: string }) => {
          playerId = data.playerId;
          const username = data.username ?? data.playerId;
          this.privateRooms!.joinRoom(playerId, username, socket, data.code);
        }
      );

      // Handle room-cancel (private match)
      socket.on('room-cancel', () => {
        if (playerId) {
          this.privateRooms!.cancelRoom(playerId, socket);
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
   * Find a GameRoom by matchId across both matchmaking and private room services.
   */
  private findMatch(matchId: string): GameRoom | undefined {
    return this.matchmaking?.getMatch(matchId) ?? this.privateRooms?.getMatch(matchId);
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
    const privateMatches = this.privateRooms?.getActiveMatches().map((m) => m.getMatchInfo()) ?? [];
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
