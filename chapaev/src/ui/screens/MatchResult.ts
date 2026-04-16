/**
 * MatchResult screen — shown at end of a match.
 */

import type { UIManager } from '../UIManager.ts';

export interface MatchResultData {
  isWinner: boolean;
  score: string;
  matchDuration: string;
}

export interface MatchResultCallbacks {
  onRematch: () => void;
  onNewGame: () => void;
  onMainMenu: () => void;
}

export class MatchResultScreen {
  private readonly uiManager: UIManager;
  private readonly callbacks: MatchResultCallbacks;
  private resultData: MatchResultData = { isWinner: false, score: '0:0', matchDuration: '0:00' };

  constructor(uiManager: UIManager, callbacks: MatchResultCallbacks) {
    this.uiManager = uiManager;
    this.callbacks = callbacks;

    uiManager.registerScreen('match-result', (container) => {
      this.render(container);
    });
  }

  /** Set data before showing */
  public setResultData(data: MatchResultData): void {
    this.resultData = data;
    // Re-render if already shown
    this.uiManager.refreshScreen('match-result');
  }

  private render(container: HTMLDivElement): void {
    const { isWinner, score, matchDuration } = this.resultData;
    const titleClass = isWinner ? 'victory' : 'defeat';
    const titleText = isWinner ? '🏆 ПОБЕДА! 🏆' : 'ПОРАЖЕНИЕ';
    const subtitleText = isWinner ? 'Отличная игра!' : 'В следующий раз повезёт!';

    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel">
        <div class="match-result-title ${titleClass}">${titleText}</div>
        <div class="match-result-score">${score}</div>
        <div class="match-result-details">
          ${subtitleText}<br/>
          Время матча: ${matchDuration}
        </div>
        <div class="match-result-buttons">
          <button class="btn-primary" data-ref="rematch-btn">🔄 Реванш</button>
          <button class="btn-secondary" data-ref="new-game-btn">🔍 Найти нового</button>
          <button class="btn-ghost" data-ref="menu-btn">🏠 В меню</button>
        </div>
      </div>
    `;

    const rematchBtn = container.querySelector('[data-ref="rematch-btn"]') as HTMLButtonElement;
    const newGameBtn = container.querySelector('[data-ref="new-game-btn"]') as HTMLButtonElement;
    const menuBtn = container.querySelector('[data-ref="menu-btn"]') as HTMLButtonElement;

    rematchBtn.addEventListener('click', () => this.callbacks.onRematch());
    newGameBtn.addEventListener('click', () => this.callbacks.onNewGame());
    menuBtn.addEventListener('click', () => this.callbacks.onMainMenu());
  }
}

