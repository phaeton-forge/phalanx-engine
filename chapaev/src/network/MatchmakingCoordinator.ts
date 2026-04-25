import type { CountdownEvent, MatchFoundEvent } from 'phalanx-client';
import type { NetworkContext } from './NetworkContext.ts';
import type { UIManager } from '../ui/UIManager.ts';
import type { MatchmakingScreen } from '../ui/screens/Matchmaking.ts';

export interface MatchmakingCallbacks {
  onMatchReady(matchData: MatchFoundEvent): void;
  onError(): void;
}

interface UIRefs {
  uiManager: UIManager;
  matchmaking: MatchmakingScreen;
}

/** Owns the public matchmaking flow (queue → match → countdown → start). */
export class MatchmakingCoordinator {
  constructor(
    private readonly ctx: NetworkContext,
    private readonly ui: UIRefs,
    private readonly callbacks: MatchmakingCallbacks
  ) {}

  async connectAndStart(): Promise<void> {
    const { uiManager, matchmaking } = this.ui;

    try {
      matchmaking.setStatus('Подключение к серверу...');

      this.ctx.trackConnectListener(
        this.ctx.manager.client.on('disconnected', () => {
          matchmaking.setStatus('Соединение потеряно');
        })
      );
      this.ctx.trackConnectListener(
        this.ctx.manager.client.on('error', (error) => {
          console.error('[Matchmaking] Network error:', error.message);
        })
      );

      await this.ctx.manager.client.connect();
      matchmaking.setStatus('Поиск соперника...');

      await this.ctx.manager.client.joinQueue();

      const matchData = await this.ctx.manager.client.waitForMatch();
      matchmaking.stopTimer();

      uiManager.hideScreen('matchmaking');
      uiManager.destroyScreen('countdown');
      uiManager.showScreen('countdown');

      await this.ctx.manager.client.waitForCountdown(
        (event: CountdownEvent) => {
          matchmaking.updateCountdown(event.seconds);
        }
      );

      const gameStartEvent = await this.ctx.manager.client.waitForGameStart();
      console.log(
        '[Matchmaking] Game start, randomSeed:',
        gameStartEvent.randomSeed
      );

      this.ctx.manager.setMatchData(matchData);
      this.ctx.cleanupConnectListeners();

      uiManager.hideScreen('countdown');
      this.callbacks.onMatchReady(matchData);
    } catch (error) {
      console.error(
        '[Matchmaking] Failed:',
        error instanceof Error ? error.message : JSON.stringify(error),
        error
      );
      matchmaking.setStatus('Ошибка подключения');
      matchmaking.stopTimer();
      this.callbacks.onError();
    }
  }
}
