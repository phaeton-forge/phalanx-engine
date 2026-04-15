import { PhalanxClient } from 'phalanx-client';
import type { MatchFoundEvent, CountdownEvent, GameStartEvent, CommandsBatchEvent } from 'phalanx-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

/**
 * NetworkManager — wraps PhalanxClient for Chapayev online mode.
 *
 * Handles connection, matchmaking, and exposes the client as
 * ITickFrameProvider for GameWorld integration.
 */
export class NetworkManager {
  public readonly client: PhalanxClient;
  private _matchData: MatchFoundEvent | null = null;
  private _localPlayerIndex = -1;
  private networkUnsubscribers: (() => void)[] = [];

  constructor() {
    this.client = new PhalanxClient({
      serverUrl: SERVER_URL,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 1000,
    });
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

  /**
   * Clean up all event subscriptions and disconnect.
   */
  public dispose(): void {
    for (const unsub of this.networkUnsubscribers) {
      unsub();
    }
    this.networkUnsubscribers = [];
    this.client.disconnect();
  }
}
