/**
 * Matchmaking screen — shown while searching for an opponent.
 * Also handles countdown display when match is found.
 */

import type { UIManager } from '../UIManager.ts';

export interface MatchmakingCallbacks {
  onCancel: () => void;
}

export class MatchmakingScreen {
  private readonly uiManager: UIManager;
  private readonly callbacks: MatchmakingCallbacks;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;

  constructor(uiManager: UIManager, callbacks: MatchmakingCallbacks) {
    this.uiManager = uiManager;
    this.callbacks = callbacks;

    uiManager.registerScreen('matchmaking', (container) => {
      this.renderSearching(container);
    });

    uiManager.registerScreen('countdown', (container) => {
      this.renderCountdown(container);
    });
  }

  private renderSearching(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel">
        <div class="matchmaking-spinner"></div>
        <div class="matchmaking-title">Поиск соперника...</div>
        <div class="matchmaking-timer" data-ref="timer">Время ожидания: 0:00</div>
        <button class="btn-secondary matchmaking-cancel" data-ref="cancel-btn">
          Отменить
        </button>
      </div>
    `;

    const cancelBtn = container.querySelector('[data-ref="cancel-btn"]') as HTMLButtonElement;
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
        <div class="countdown-title">Соперник найден!</div>
        <div class="countdown-players">
          <span>Игрок 1</span>
          <span class="countdown-vs">⚔️</span>
          <span>Игрок 2</span>
        </div>
        <div class="countdown-number" data-ref="countdown-number">3</div>
      </div>
    `;
  }

  /** Update countdown number */
  public updateCountdown(seconds: number): void {
    const screenEl = this.uiManager.getScreenElement('countdown');
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
        timerEl.textContent = `Время ожидания: ${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }, 1000);
  }

  public stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  public dispose(): void {
    this.stopTimer();
  }
}

