/**
 * MatchResult screen — shown at end of a match.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface MatchResultData {
  isWinner: boolean;
  score: string;
  matchDuration: string;
}

export interface MatchResultCallbacks {
  onRematch: () => void;
  onNewGame: () => void;
  onMainMenu: () => void | Promise<void>;
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
    const titleText = isWinner ? t('matchResult.victoryTitle') : t('matchResult.defeatTitle');
    const subtitleText = isWinner ? t('matchResult.victorySubtitle') : t('matchResult.defeatSubtitle');

    container.className = 'ui-screen';

    const panel = document.createElement('div');
    panel.className = 'glass-panel';

    const titleDiv = document.createElement('div');
    titleDiv.className = `match-result-title ${titleClass}`;
    titleDiv.textContent = titleText;
    panel.appendChild(titleDiv);

    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'match-result-score';
    scoreDiv.textContent = score;
    panel.appendChild(scoreDiv);

    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'match-result-details';
    detailsDiv.appendChild(document.createTextNode(subtitleText));
    detailsDiv.appendChild(document.createElement('br'));
    const durationText = document.createTextNode(t('matchResult.durationLabel'));
    detailsDiv.appendChild(durationText);
    const durationValue = document.createTextNode(matchDuration);
    detailsDiv.appendChild(durationValue);
    panel.appendChild(detailsDiv);

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'match-result-buttons';

    const rematchBtn = document.createElement('button');
    rematchBtn.className = 'btn-primary';
    rematchBtn.textContent = t('matchResult.rematch');
    rematchBtn.addEventListener('click', () => this.callbacks.onRematch());
    buttonsDiv.appendChild(rematchBtn);

    const newGameBtn = document.createElement('button');
    newGameBtn.className = 'btn-secondary';
    newGameBtn.textContent = t('matchResult.findNew');
    newGameBtn.addEventListener('click', () => this.callbacks.onNewGame());
    buttonsDiv.appendChild(newGameBtn);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'btn-ghost';
    menuBtn.textContent = t('matchResult.toMenu');
    menuBtn.addEventListener('click', () => void this.callbacks.onMainMenu());
    buttonsDiv.appendChild(menuBtn);

    panel.appendChild(buttonsDiv);
    container.appendChild(panel);
  }
}

