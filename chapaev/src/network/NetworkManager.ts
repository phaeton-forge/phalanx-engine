import { PhalanxClient } from 'phalanx-client';
import type {
  MatchFoundEvent,
  CountdownEvent,
  GameStartEvent,
  CommandsBatchEvent,
  PhalanxAuthState,
  RoomCreatedEvent,
  SocketTransport,
} from 'phalanx-client';
import { SERVER_URL, AUTH_CONFIG } from '../config/constants.ts';

/**
 * localStorage key for the anonymous (guest-mode) playerId.
 *
 * PhalanxClient generates a fresh `player-${Date.now()}-...` id in its
 * constructor when none is supplied. That id changes on every page
 * reload, which silently breaks any server-side state keyed by
 * playerId — most importantly, the host record inside a private room.
 *
 * For authenticated users, PhalanxClient overrides this id with the
 * stable auth user.id once auth resolves, so the value persisted here
 * is only used until that override (and as a fallback for guests).
 */
const GUEST_PLAYER_ID_STORAGE_KEY = 'chapaev:guestPlayerId:v1';
const DESKTOP_SOCKET_TRANSPORTS = ['websocket'] as const satisfies readonly SocketTransport[];
const MOBILE_SOCKET_TRANSPORTS = ['polling', 'websocket'] as const satisfies readonly SocketTransport[];

function getSocketTransports(): readonly SocketTransport[] {
  return isMobileBrowser() ? MOBILE_SOCKET_TRANSPORTS : DESKTOP_SOCKET_TRANSPORTS;
}

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  const hasTouchScreen = navigator.maxTouchPoints > 1;
  const isIpadOS = platform === 'MacIntel' && hasTouchScreen;
  return (
    isIpadOS ||
    /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)
  );
}

function loadOrCreateGuestPlayerId(): string {
  try {
    if (typeof localStorage === 'undefined') {
      return `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    const existing = localStorage.getItem(GUEST_PLAYER_ID_STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(GUEST_PLAYER_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return `player-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * NetworkManager — wraps PhalanxClient for Chapayev online mode.
 *
 * Handles connection, matchmaking, authentication, and exposes the client as
 * ITickFrameProvider for GameWorld integration.
 */
export class NetworkManager {
  public readonly client: PhalanxClient;
  private _matchData: MatchFoundEvent | null = null;
  private _localPlayerIndex = -1;
  private networkUnsubscribers: (() => void)[] = [];

  constructor() {
    const playerId = loadOrCreateGuestPlayerId();
    const socketTransports = getSocketTransports();
    console.log('[ChapaevNetwork] constructor', {
      at: new Date().toISOString(),
      serverUrl: SERVER_URL,
      playerId,
      socketTransports,
      authEnabled: AUTH_CONFIG.authEnabled,
    });
    this.client = new PhalanxClient({
      serverUrl: SERVER_URL,
      // Stable across page reloads — required for private-room recovery
      // after the mobile browser killed the tab while the user was in
      // a messenger sharing the invite link. Auth, when enabled, will
      // overwrite this with the real user id once the auth flow
      // resolves; until then (and for guests forever) we keep the
      // same anonymous id across reloads.
      playerId,
      socketTransports,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 1000,
      auth: AUTH_CONFIG.authEnabled ? {
        provider: 'google',
        google: {
          clientId: AUTH_CONFIG.googleClientId,
          tokenExchangeUrl: AUTH_CONFIG.tokenExchangeUrl,
        },
      } : undefined,
    });
  }

  // ── Authentication ───────────────────────────────────────────────

  /** Start Google OAuth login flow */
  public login(): void {
    this.client.login();
  }

  /** Logout current user */
  public async logout(): Promise<void> {
    await this.client.logout();
  }

  /** Get current auth state */
  public getAuthState(): PhalanxAuthState {
    return this.client.getAuthState();
  }

  /** Check if auth is enabled */
  public get authEnabled(): boolean {
    return AUTH_CONFIG.authEnabled;
  }

  /** Subscribe to auth state changes */
  public onAuthStateChanged(handler: (state: PhalanxAuthState) => void): () => void {
    const unsub = this.client.on('authStateChanged', handler);
    this.networkUnsubscribers.push(unsub);
    return unsub;
  }

  /** Subscribe to auth errors */
  public onAuthError(handler: (error: { message: string }) => void): () => void {
    const unsub = this.client.on('authError', handler);
    this.networkUnsubscribers.push(unsub);
    return unsub;
  }

  /**
   * Connect to server, join queue, wait for match, countdown, and game-start.
   * Returns the GameStartEvent (includes randomSeed).
   */
  public async connectAndWaitForMatch(
    onStatus?: (msg: string) => void,
    onCountdown?: (event: CountdownEvent) => void,
  ): Promise<GameStartEvent> {
    onStatus?.('Connecting to server...');

    this.networkUnsubscribers.push(
      this.client.on('disconnected', () => {
        console.warn('[Network] Disconnected from server');
      }),
    );

    this.networkUnsubscribers.push(
      this.client.on('error', (error) => {
        console.error('[Network] Error:', error.message);
      }),
    );

    await this.client.connect();
    onStatus?.('Connected! Joining queue...');

    await this.client.joinQueue();
    onStatus?.('In queue. Waiting for opponent...');

    this._matchData = await this.client.waitForMatch();
    onStatus?.('Match found! Starting countdown...');

    await this.client.waitForCountdown((event: CountdownEvent) => {
      onStatus?.(`Game starting in ${event.seconds}...`);
      onCountdown?.(event);
    });

    const gameStartEvent = await this.client.waitForGameStart();
    onStatus?.('Game started!');

    return gameStartEvent;
  }

  /**
   * Signal to the server that this client is ready (assets loaded, ECS initialized).
   */
  public sendReady(): void {
    this.client.sendReady();
  }

  /**
   * Send a flick command via the lockstep channel.
   */
  public sendCommand(type: string, data: unknown): void {
    this.client.sendCommand(type, data);
  }

  /**
   * Submit a state hash for desync detection.
   */
  public submitStateHash(tick: number, hash: string): void {
    this.client.submitStateHash(tick, hash);
  }

  /** The match data from matchmaking. */
  public get matchData(): MatchFoundEvent | null {
    return this._matchData;
  }

  /** Set match data externally (used when matchmaking is handled outside connectAndWaitForMatch). */
  public setMatchData(data: MatchFoundEvent): void {
    this._matchData = data;
    this._localPlayerIndex = -1; // reset cached value
  }

  /** The local player ID assigned by the server. */
  public get localPlayerId(): string {
    return this.client.getPlayerId();
  }

  /**
   * Determine local player index (0 or 1) based on sorted player IDs.
   * Player 0 = white (goes first), Player 1 = black.
   */
  public get localPlayerIndex(): number {
    if (this._localPlayerIndex !== -1) return this._localPlayerIndex;
    if (!this._matchData) return 0;

    // Collect all player IDs: self + teammates + opponents
    const allPlayerIds = [
      this._matchData.playerId,
      ...this._matchData.teammates.map((p) => p.playerId),
      ...this._matchData.opponents.map((p) => p.playerId),
    ].sort();

    this._localPlayerIndex = allPlayerIds.indexOf(this._matchData.playerId);
    return this._localPlayerIndex;
  }

  /**
   * Register a handler for network events (playerDisconnected, matchEnd, etc).
   */
  public onPlayerDisconnected(handler: () => void): () => void {
    const unsub = this.client.on('playerDisconnected', () => handler());
    this.networkUnsubscribers.push(unsub);
    return unsub;
  }

  public onPlayerReconnected(handler: () => void): () => void {
    const unsub = this.client.on('playerReconnected', () => handler());
    this.networkUnsubscribers.push(unsub);
    return unsub;
  }

  public onMatchEnd(handler: (reason: string) => void): () => void {
    const unsub = this.client.on('matchEnd', (event) => handler(event.reason));
    this.networkUnsubscribers.push(unsub);
    return unsub;
  }

  public onDesync(handler: (tick: number) => void): () => void {
    const unsub = this.client.on('desync', (event) => handler(event.tick));
    this.networkUnsubscribers.push(unsub);
    return unsub;
  }

  /**
   * Subscribe to incoming commands-batch events from the server.
   * In event tick mode, the server broadcasts each command immediately
   * rather than batching on a tick loop.
   */
  public onCommandsBatch(handler: (event: CommandsBatchEvent) => void): () => void {
    const unsub = this.client.on('commands', handler);
    this.networkUnsubscribers.push(unsub);
    return unsub;
  }

  // ── Private Rooms ──────────────────────────────────────────────────

  /** Create a private room. Returns the room code. */
  public async createRoom(): Promise<RoomCreatedEvent> {
    console.log('[ChapaevNetwork] createRoom:before', {
      at: new Date().toISOString(),
      playerId: this.localPlayerId,
      clientState: this.client.getClientState(),
      isConnected: this.client.isConnected(),
    });
    const event = await this.client.createRoom();
    console.log('[ChapaevNetwork] createRoom:after', {
      at: new Date().toISOString(),
      playerId: this.localPlayerId,
      code: event.code,
      clientState: this.client.getClientState(),
      isConnected: this.client.isConnected(),
    });
    return event;
  }

  /** Join a private room by code. Server will emit match-found. */
  public joinRoom(code: string): void {
    console.log('[ChapaevNetwork] joinRoom:emit', {
      at: new Date().toISOString(),
      playerId: this.localPlayerId,
      code,
      clientState: this.client.getClientState(),
      isConnected: this.client.isConnected(),
    });
    this.client.joinRoom(code);
  }

  /** Cancel a previously created private room. */
  public cancelRoom(): void {
    console.log('[ChapaevNetwork] cancelRoom:emit', {
      at: new Date().toISOString(),
      playerId: this.localPlayerId,
      clientState: this.client.getClientState(),
      isConnected: this.client.isConnected(),
    });
    this.client.cancelRoom();
  }

  /**
   * Clean up all event subscriptions and disconnect.
   */
  public dispose(): void {
    console.log('[ChapaevNetwork] dispose', {
      at: new Date().toISOString(),
      playerId: this.localPlayerId,
      clientState: this.client.getClientState(),
      isConnected: this.client.isConnected(),
      subscriptions: this.networkUnsubscribers.length,
    });
    for (const unsub of this.networkUnsubscribers) {
      unsub();
    }
    this.networkUnsubscribers = [];
    this.client.disconnect();
  }
}
