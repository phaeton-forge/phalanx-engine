import type { CountdownEvent, MatchFoundEvent } from '@phalanx-engine/client';
import type { NetworkContext } from './NetworkContext.ts';
import type { UIManager } from '../ui/UIManager.ts';
import type { MatchmakingScreen } from '../ui/screens/Matchmaking.ts';
import { trackMatchFound } from '../analytics/yandexMetrika.ts';
import { t } from '../i18n/i18n.ts';

export interface MatchmakingCallbacks {
  onMatchReady(matchData: MatchFoundEvent, origin: 'public' | 'private'): void;
  onError(): void;
  /** Queue waited too long with no opponent — leave queue and start local AI substitute. */
  onQueueTimeoutFallbackAI(): void | Promise<void>;
}

/** How long to wait for a second player before falling back to AI (ms). */
const PUBLIC_QUEUE_MATCH_TIMEOUT_MS = 15_000;

interface UIRefs {
  uiManager: UIManager;
  matchmaking: MatchmakingScreen;
}

/** Owns the public matchmaking flow (queue → match → countdown → start). */
export class MatchmakingCoordinator {
  /** Set when the user leaves the matchmaking UI so late async errors are ignored. */
  private cancelledByUser = false;

  /** AI fallback timer — must be cleared on cancel or `Promise.race` still wins with `'timeout'`. */
  private queueFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: NetworkContext,
    private readonly ui: UIRefs,
    private readonly callbacks: MatchmakingCallbacks
  ) {}

  /**
   * Call before tearing down the socket from the matchmaking screen so a
   * racing `connectAndStart` failure does not fire `onError` / main-menu redirect.
   */
  markCancelledByUser(): void {
    this.cancelledByUser = true;
    this.clearQueueFallbackTimer();
  }

  private clearQueueFallbackTimer(): void {
    if (this.queueFallbackTimer !== null) {
      clearTimeout(this.queueFallbackTimer);
      this.queueFallbackTimer = null;
    }
  }

  async connectAndStart(): Promise<void> {
    const { uiManager, matchmaking } = this.ui;

    this.cancelledByUser = false;
    this.clearQueueFallbackTimer();

    try {
      matchmaking.setStatus(t('net.connecting'));

      this.ctx.trackConnectListener(
        this.ctx.manager.client.on('disconnected', () => {
          matchmaking.setStatus(t('net.connectionLost'));
        })
      );
      this.ctx.trackConnectListener(
        this.ctx.manager.client.on('error', (error) => {
          console.error('[Matchmaking] Network error:', error.message);
        })
      );

      await this.ctx.manager.client.connect();
      matchmaking.setStatus(t('net.searchingOpponent'));

      await this.ctx.manager.client.joinQueue();

      const clearQueueTimer = (): void => {
        this.clearQueueFallbackTimer();
      };

      const queueTimeoutPromise = new Promise<'timeout'>((resolve) => {
        this.queueFallbackTimer = setTimeout(() => {
          this.queueFallbackTimer = null;
          resolve('timeout');
        }, PUBLIC_QUEUE_MATCH_TIMEOUT_MS);
      });

      const matchPromise = this.ctx.manager.client.waitForMatch();

      const matchOrTimeout = await Promise.race([
        matchPromise.then(
          (data) => {
            clearQueueTimer();
            return data;
          },
          (err) => {
            clearQueueTimer();
            throw err;
          }
        ),
        queueTimeoutPromise,
      ]);

      if (matchOrTimeout === 'timeout') {
        if (this.cancelledByUser) {
          this.cancelledByUser = false;
          return;
        }
        clearQueueTimer();
        try {
          this.ctx.manager.client.leaveQueue();
        } catch {
          // Socket may already be gone; still replace below.
        }
        this.ctx.cleanupConnectListeners();
        this.ctx.replace();
        matchmaking.stopTimer();
        uiManager.hideScreen('matchmaking');
        await Promise.resolve(this.callbacks.onQueueTimeoutFallbackAI());
        return;
      }

      const matchData = matchOrTimeout;
      matchmaking.stopTimer();

      trackMatchFound('public');

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
      this.callbacks.onMatchReady(matchData, 'public');
    } catch (error) {
      if (this.cancelledByUser) {
        this.cancelledByUser = false;
        return;
      }
      console.error(
        '[Matchmaking] Failed:',
        error instanceof Error ? error.message : JSON.stringify(error),
        error
      );
      matchmaking.setStatus(t('net.connectionError'));
      matchmaking.stopTimer();
      this.callbacks.onError();
    }
  }
}
