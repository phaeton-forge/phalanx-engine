/**
 * Matchmaking screen — shown while searching for an opponent.
 * Also handles countdown display when match is found.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface MatchmakingCallbacks {
  onCancel: () => void;
}

/** Seconds shown before match start — keep in sync with server countdown UX. */
const LOCAL_MATCH_COUNTDOWN_START = 3;

export class MatchmakingScreen {
  private readonly uiManager: UIManager;
  private readonly callbacks: MatchmakingCallbacks;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private localCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private localCountdownPlayer1 = '';
  private localCountdownPlayer2 = '';

  constructor(uiManager: UIManager, callbacks: MatchmakingCallbacks) {
    this.uiManager = uiManager;
    this.callbacks = callbacks;

    uiManager.registerScreen('matchmaking', (container) => {
      this.renderSearching(container);
    });

    uiManager.registerScreen('countdown', (container) => {
      this.renderCountdown(container);
    });

    uiManager.registerScreen('countdown-local', (container) => {
      this.renderCountdownLocal(container);
    });
  }

  private renderSearching(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel">
        <div class="matchmaking-spinner"></div>
        <div class="matchmaking-title">${t('matchmaking.searching')}</div>
        <div class="matchmaking-timer" data-ref="timer">${t('matchmaking.waitingTime', { time: '0:00' })}</div>
        <button class="btn-secondary matchmaking-cancel" data-ref="cancel-btn">
          ${t('matchmaking.cancel')}
        </button>
      </div>
    `;

    const cancelBtn = container.querySelector(
      '[data-ref="cancel-btn"]'
    ) as HTMLButtonElement;
    cancelBtn.addEventListener('click', () => {
      this.stopTimer();
      this.callbacks.onCancel();
    });

    this.startTimer(container);
  }

  private renderCountdown(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel">
        <div class="countdown-title">${t('matchmaking.found')}</div>
        <div class="countdown-players">
          <span>${t('matchmaking.player1')}</span>
          <span class="countdown-vs">⚔️</span>
          <span>${t('matchmaking.player2')}</span>
        </div>
        <div class="countdown-number" data-ref="countdown-number">3</div>
      </div>
    `;
  }

  /** Same layout as server-driven countdown, but player names come from matchmaking / bot substitute. */
  private renderCountdownLocal(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    const p1 = this.localCountdownPlayer1;
    const p2 = this.localCountdownPlayer2;
    container.innerHTML = `
      <div class="glass-panel">
        <div class="countdown-title">${t('matchmaking.found')}</div>
        <div class="countdown-players">
          <span>${p1}</span>
          <span class="countdown-vs">⚔️</span>
          <span>${p2}</span>
        </div>
        <div class="countdown-number" data-ref="countdown-number">${LOCAL_MATCH_COUNTDOWN_START}</div>
      </div>
    `;
  }

  /**
   * Full-screen countdown driven by `setInterval` (no server `countdown` events).
   * Shows 3 → 0 inclusive, one tick per second, then resolves.
   */
  public runLocalCountdown(player1: string, player2: string): Promise<void> {
    this.cancelLocalCountdown();
    this.localCountdownPlayer1 = player1;
    this.localCountdownPlayer2 = player2;
    this.uiManager.destroyScreen('countdown-local');
    this.uiManager.showScreen('countdown-local');

    return new Promise((resolve) => {
      let seconds = LOCAL_MATCH_COUNTDOWN_START;
      this.updateCountdownDisplay(seconds, 'countdown-local');

      this.localCountdownInterval = setInterval(() => {
        seconds -= 1;
        this.updateCountdownDisplay(seconds, 'countdown-local');
        if (seconds <= 0) {
          this.cancelLocalCountdown();
          resolve();
        }
      }, 1000);
    });
  }

  public cancelLocalCountdown(): void {
    if (this.localCountdownInterval !== null) {
      clearInterval(this.localCountdownInterval);
      this.localCountdownInterval = null;
    }
  }

  /** Update countdown number */
  public updateCountdown(seconds: number): void {
    this.updateCountdownDisplay(seconds, 'countdown');
  }

  private updateCountdownDisplay(
    seconds: number,
    screen: 'countdown' | 'countdown-local'
  ): void {
    const screenEl = this.uiManager.getScreenElement(screen);
    if (!screenEl) return;
    const numberEl = screenEl.querySelector('[data-ref="countdown-number"]');
    if (numberEl) {
      numberEl.textContent = String(seconds);
      // Re-trigger animation
      numberEl.classList.remove('countdown-number');
      void (numberEl as HTMLElement).offsetWidth;
      numberEl.classList.add('countdown-number');
    }
  }

  /** Update status text */
  public setStatus(message: string): void {
    const screenEl = this.uiManager.getScreenElement('matchmaking');
    if (!screenEl) return;
    const titleEl = screenEl.querySelector('.matchmaking-title');
    if (titleEl) {
      titleEl.textContent = message;
    }
  }

  private startTimer(container: HTMLDivElement): void {
    this.startTime = Date.now();
    const timerEl = container.querySelector('[data-ref="timer"]');
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      if (timerEl) {
        const time = `${mins}:${secs.toString().padStart(2, '0')}`;
        timerEl.textContent = t('matchmaking.waitingTime', { time });
      }
    }, 1000);
  }

  public stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.cancelLocalCountdown();
  }

  public dispose(): void {
    this.stopTimer();
  }
}
