/**
 * LocalGameMode screen — choose between AI opponent and local hot-seat.
 *
 * Shown after the user clicks "Local game" on the main menu. Functions as a
 * thin sub-menu and emits one of three callbacks: vs-AI, hot-seat, or back.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface LocalGameModeCallbacks {
  onSelectAI: () => void;
  onSelectHotseat: () => void;
  onBack: () => void;
}

export class LocalGameModeScreen {
  private readonly callbacks: LocalGameModeCallbacks;

  constructor(uiManager: UIManager, callbacks: LocalGameModeCallbacks) {
    this.callbacks = callbacks;

    uiManager.registerScreen('local-game-mode', (container) => {
      this.render(container);
    });
  }

  private render(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel">
        <div class="main-menu-title" aria-label="${t('localMode.title')}">
          <span class="main-menu-title__text">${t('localMode.title')}</span>
        </div>
        <div class="main-menu-subtitle">${t('localMode.subtitle')}</div>
        <hr class="main-menu-divider" />

        <div class="main-menu-buttons">
          <button class="btn-primary" data-ref="ai-btn">
            ${t('localMode.vsAi')}
          </button>
          <button class="btn-secondary" data-ref="hotseat-btn">
            ${t('localMode.hotseat')}
          </button>
        </div>

        <div style="margin-top: 16px;">
          <button class="btn-ghost" data-ref="back-btn">${t('common.back')}</button>
        </div>
      </div>
    `;

    const aiBtn = container.querySelector(
      '[data-ref="ai-btn"]'
    ) as HTMLButtonElement;
    const hotseatBtn = container.querySelector(
      '[data-ref="hotseat-btn"]'
    ) as HTMLButtonElement;
    const backBtn = container.querySelector(
      '[data-ref="back-btn"]'
    ) as HTMLButtonElement;

    aiBtn.addEventListener('click', () => this.callbacks.onSelectAI());
    hotseatBtn.addEventListener('click', () =>
      this.callbacks.onSelectHotseat()
    );
    backBtn.addEventListener('click', () => this.callbacks.onBack());
  }
}
