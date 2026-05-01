/**
 * MainMenu screen — the first screen shown when the game loads.
 *
 * Shows title, navigation buttons, and auth status.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface MainMenuCallbacks {
  onFindMatch: () => void;
  onPrivateMatch: () => void;
  onLocalGame: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}

export class MainMenuScreen {
  private readonly callbacks: MainMenuCallbacks;

  constructor(uiManager: UIManager, callbacks: MainMenuCallbacks) {
    this.callbacks = callbacks;

    uiManager.registerScreen('main-menu', (container) => {
      this.render(container);
    });
  }

  private render(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel" style="position: relative;">
        <div class="main-menu-title" aria-label="${t('mainMenu.titleText')}">
          <span class="main-menu-title__crown" aria-hidden="true">♔</span>
          <span class="main-menu-title__text">${t('mainMenu.titleText')}</span>
          <span class="main-menu-title__crown" aria-hidden="true">♔</span>
        </div>
        <div class="main-menu-subtitle">${t('mainMenu.subtitle')}</div>
        <hr class="main-menu-divider" />

        <div class="main-menu-buttons">
          <button class="btn-primary" data-ref="find-match-btn">
            ${t('mainMenu.findOpponent')}
          </button>
          <button class="btn-secondary" data-ref="private-match-btn">
            ${t('mainMenu.privateMatch')}
          </button>
          <button class="btn-secondary" data-ref="local-game-btn">
            ${t('mainMenu.localGame')}
          </button>
          <button class="btn-secondary" data-ref="settings-btn">
            ${t('mainMenu.settings')}
          </button>
        </div>
      </div>
    `;

    // Wire up events
    const findMatchBtn = container.querySelector('[data-ref="find-match-btn"]') as HTMLButtonElement;
    const privateMatchBtn = container.querySelector('[data-ref="private-match-btn"]') as HTMLButtonElement;
    const localGameBtn = container.querySelector('[data-ref="local-game-btn"]') as HTMLButtonElement;
    const settingsBtn = container.querySelector('[data-ref="settings-btn"]') as HTMLButtonElement;

    findMatchBtn.addEventListener('click', () => this.callbacks.onFindMatch());
    privateMatchBtn.addEventListener('click', () => this.callbacks.onPrivateMatch());
    localGameBtn.addEventListener('click', () => this.callbacks.onLocalGame());
    settingsBtn.addEventListener('click', () => this.callbacks.onSettings());
  }
}



