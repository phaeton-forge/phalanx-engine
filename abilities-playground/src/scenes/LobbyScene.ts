import { PhalanxClient } from 'phalanx-client';
import type { MatchFoundEvent, CountdownEvent } from 'phalanx-client';
import { SERVER_URL } from '../config/constants';

export class LobbyScene {
  private client: PhalanxClient | null = null;
  private matchData: MatchFoundEvent | null = null;
  private readonly lobbyElement: HTMLElement;
  private readonly gameContainer: HTMLElement;
  private readonly findMatchButton: HTMLButtonElement;
  private readonly statusElement: HTMLElement;
  private onGameStart:
    | ((
        client: PhalanxClient,
        matchData: MatchFoundEvent
      ) => Promise<void> | void)
    | null = null;
  private unsubscribers: Array<() => void> = [];

  public constructor() {
    this.lobbyElement = document.getElementById('lobby')!;
    this.gameContainer = document.getElementById('game-container')!;
    this.findMatchButton = document.getElementById(
      'find-match-btn'
    ) as HTMLButtonElement;
    this.statusElement = document.getElementById('status')!;

    this.findMatchButton.addEventListener('click', () => {
      void this.handleFindMatch();
    });
  }

  public setOnGameStart(
    callback: (
      client: PhalanxClient,
      matchData: MatchFoundEvent
    ) => Promise<void> | void
  ): void {
    this.onGameStart = callback;
  }

  private async handleFindMatch(): Promise<void> {
    this.findMatchButton.disabled = true;
    try {
      this.client = new PhalanxClient({ serverUrl: SERVER_URL });
      this.unsubscribers.push(
        this.client.on('disconnected', () => {
          this.setStatus('Disconnected', true);
          this.findMatchButton.disabled = false;
        })
      );
      this.unsubscribers.push(
        this.client.on('error', (error) => {
          this.setStatus(`Error: ${error.message}`, true);
        })
      );

      this.setStatus('Connecting...');
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.setStatus(`Error: ${message}`, true);
      this.findMatchButton.disabled = false;
    }
  }

  private transitionToGame(): void {
    this.lobbyElement.style.display = 'none';
    this.gameContainer.style.display = 'block';
    if (this.client && this.matchData && this.onGameStart) {
      const result = this.onGameStart(this.client, this.matchData);
      if (result instanceof Promise) {
        void result;
      }
    }
  }

  private setStatus(message: string, isError = false): void {
    this.statusElement.textContent = message;
    this.statusElement.style.color = isError ? '#f87171' : '#cbd5e1';
  }

  public show(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.client = null;
    this.matchData = null;
    this.setStatus('');
    this.findMatchButton.disabled = false;
    this.gameContainer.style.display = 'none';
    this.lobbyElement.style.display = 'flex';
  }
}
