/**
 * MainMenu screen — the first screen shown when the game loads.
 *
 * Shows title, navigation buttons, and auth status.
 */

import type { UIManager } from '../UIManager.ts';

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
        <div class="main-menu-title">♔ Ч А П А Е В ♔</div>
        <div class="main-menu-subtitle">Настольная игра онлайн</div>
        <hr class="main-menu-divider" />

        <div class="main-menu-buttons">
          <button class="btn-primary" data-ref="find-match-btn">
            🔍 Найти соперника
          </button>
          <button class="btn-secondary" data-ref="private-match-btn">
            🔑 Приватный матч
          </button>
          <button class="btn-secondary" data-ref="local-game-btn">
            🎮 Локальная игра
          </button>
          <button class="btn-secondary" data-ref="settings-btn">
            ⚙️ Настройки
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



