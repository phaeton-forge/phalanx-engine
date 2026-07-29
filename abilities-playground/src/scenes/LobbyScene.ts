import { PhalanxClient } from '@phalanx-engine/client';
import type { CountdownEvent, MatchFoundEvent } from '@phalanx-engine/client';
import { SERVER_URL, networkConfig, pauseConfig } from '../config/constants';

export class LobbyScene {
  private client: PhalanxClient;
  private matchData: MatchFoundEvent | null = null;

  private lobbyElement: HTMLElement;
  private gameContainer: HTMLElement;
  private findMatchButton: HTMLButtonElement;
  private statusElement: HTMLElement;

  private onGameStart:
    | ((
        client: PhalanxClient,
        matchData: MatchFoundEvent
      ) => void | Promise<void>)
    | null = null;

  private networkUnsubscribers: (() => void)[] = [];

  constructor() {
    this.lobbyElement = document.getElementById('lobby')!;
    this.gameContainer = document.getElementById('game-container')!;
    this.findMatchButton = document.getElementById(
      'find-match-btn'
    ) as HTMLButtonElement;
    this.statusElement = document.getElementById('status')!;

    this.client = new PhalanxClient({
      serverUrl: SERVER_URL,
      tickRate: networkConfig.tickRate,
      pause: pauseConfig,
    });

    this.setupEventListeners();
  }

  setOnGameStart(
    callback: (
      client: PhalanxClient,
      matchData: MatchFoundEvent
    ) => void | Promise<void>
  ): void {
    this.onGameStart = callback;
  }

  getClient(): PhalanxClient {
    return this.client;
  }

  private setupEventListeners(): void {
    this.findMatchButton.addEventListener('click', () => {
      void this.handleFindMatch();
    });
  }

  private async handleFindMatch(): Promise<void> {
    this.findMatchButton.disabled = true;

    try {
      await this.connectToServer();
    } catch (error) {
      this.setStatus(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'error'
      );
      this.findMatchButton.disabled = false;
    }
  }

  private async connectToServer(): Promise<void> {
    this.setStatus('Connecting...');

    this.networkUnsubscribers.push(
      this.client.on('disconnected', () => {
        this.setStatus('Disconnected from server', 'error');
        this.findMatchButton.disabled = false;
      })
    );

    this.networkUnsubscribers.push(
      this.client.on('error', (error) => {
        this.setStatus(`Error: ${error.message}`, 'error');
      })
    );

    await this.client.connect();

    this.setStatus('In queue...');
    await this.client.joinQueue();

    this.matchData = await this.client.waitForMatch();
    this.setStatus('Match found!');

    await this.client.waitForCountdown((event: CountdownEvent) => {
      this.setStatus(`Starting in ${event.seconds}...`);
    });

    await this.client.waitForGameStart();

    this.transitionToGame();
  }

  private transitionToGame(): void {
    this.lobbyElement.style.display = 'none';
    this.gameContainer.style.display = 'block';

    if (!this.onGameStart || !this.matchData) {
      return;
    }

    const result = this.onGameStart(this.client, this.matchData);
    if (result instanceof Promise) {
      result.catch((error) => {
        console.error('[LobbyScene] Game initialization failed:', error);
        this.gameContainer.style.display = 'none';
        this.lobbyElement.style.display = 'flex';
        this.setStatus(
          `Failed to start game: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'error'
        );
        this.findMatchButton.disabled = false;
      });
    }
  }

  private setStatus(message: string, type: 'info' | 'error' = 'info'): void {
    this.statusElement.textContent = message;
    this.statusElement.style.color = type === 'error' ? '#ff6b6b' : '#ccc';
  }

  show(): void {
    for (const unsubscribe of this.networkUnsubscribers) {
      unsubscribe();
    }
    this.networkUnsubscribers = [];

    this.lobbyElement.style.display = 'flex';
    this.gameContainer.style.display = 'none';
    this.findMatchButton.disabled = false;
    this.setStatus('');
    this.matchData = null;
  }
}
