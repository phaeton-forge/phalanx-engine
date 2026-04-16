/**
 * MainMenu screen — the first screen shown when the game loads.
 *
 * Shows title, navigation buttons, and auth status.
 */

import type { PhalanxAuthState } from 'phalanx-client';
import type { UIManager } from '../UIManager.ts';

export interface MainMenuCallbacks {
  onFindMatch: () => void;
  onPrivateMatch: () => void;
  onLocalGame: () => void;
  onSettings: () => void;
  onProfile: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export class MainMenuScreen {
  private readonly uiManager: UIManager;
  private readonly callbacks: MainMenuCallbacks;

  constructor(uiManager: UIManager, callbacks: MainMenuCallbacks) {
    this.uiManager = uiManager;
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

        <div class="user-info-row" style="display: none;" data-ref="user-info">
          <img class="user-avatar" data-ref="user-avatar" src="" alt="Avatar" />
          <span class="user-name" data-ref="user-name">Player</span>
          <button class="btn-ghost" data-ref="sign-out-btn">Выйти</button>
        </div>

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
          <button class="btn-ghost" data-ref="profile-btn" style="display: none;">
            👤 Профиль
          </button>
        </div>

        <div class="main-menu-footer" data-ref="footer">
          <span>Не авторизован</span>
          <button class="btn-ghost" data-ref="sign-in-footer-btn">Войти</button>
        </div>
      </div>
    `;

    // Wire up events
    const findMatchBtn = container.querySelector('[data-ref="find-match-btn"]') as HTMLButtonElement;
    const privateMatchBtn = container.querySelector('[data-ref="private-match-btn"]') as HTMLButtonElement;
    const localGameBtn = container.querySelector('[data-ref="local-game-btn"]') as HTMLButtonElement;
    const settingsBtn = container.querySelector('[data-ref="settings-btn"]') as HTMLButtonElement;
    const profileBtn = container.querySelector('[data-ref="profile-btn"]') as HTMLButtonElement;
    const signInFooterBtn = container.querySelector('[data-ref="sign-in-footer-btn"]') as HTMLButtonElement;
    const signOutBtn = container.querySelector('[data-ref="sign-out-btn"]') as HTMLButtonElement;

    findMatchBtn.addEventListener('click', () => this.callbacks.onFindMatch());
    privateMatchBtn.addEventListener('click', () => this.callbacks.onPrivateMatch());
    localGameBtn.addEventListener('click', () => this.callbacks.onLocalGame());
    settingsBtn.addEventListener('click', () => this.callbacks.onSettings());
    profileBtn.addEventListener('click', () => this.callbacks.onProfile());
    signInFooterBtn.addEventListener('click', () => this.callbacks.onSignIn());
    signOutBtn.addEventListener('click', () => this.callbacks.onSignOut());
  }

  /** Update UI based on authentication state */
  public updateAuthState(authState: PhalanxAuthState): void {
    const screenEl = this.uiManager.getScreenElement('main-menu');
    if (!screenEl) return;

    const userInfoRow = screenEl.querySelector('[data-ref="user-info"]') as HTMLDivElement | null;
    const footer = screenEl.querySelector('[data-ref="footer"]') as HTMLDivElement | null;
    const profileBtn = screenEl.querySelector('[data-ref="profile-btn"]') as HTMLButtonElement | null;
    const avatarImg = screenEl.querySelector('[data-ref="user-avatar"]') as HTMLImageElement | null;
    const userName = screenEl.querySelector('[data-ref="user-name"]') as HTMLSpanElement | null;

    if (!userInfoRow || !footer) return;

    if (authState.isLoading) {
      userInfoRow.style.display = 'none';
      footer.style.display = 'flex';
      footer.innerHTML = '<span>Загрузка...</span>';
      return;
    }

    if (authState.isAuthenticated && authState.user) {
      // Signed in
      userInfoRow.style.display = 'flex';
      if (avatarImg && authState.user.avatarUrl) {
        avatarImg.src = authState.user.avatarUrl;
        avatarImg.style.display = 'block';
      } else if (avatarImg) {
        avatarImg.style.display = 'none';
      }
      if (userName) {
        userName.textContent = authState.user.username || authState.user.email || 'Игрок';
      }
      if (profileBtn) {
        profileBtn.style.display = 'flex';
      }
      footer.style.display = 'none';
    } else {
      // Not signed in
      userInfoRow.style.display = 'none';
      if (profileBtn) {
        profileBtn.style.display = 'none';
      }
      footer.style.display = 'flex';
      footer.innerHTML = `
        <span>Не авторизован</span>
        <button class="btn-ghost" data-ref="sign-in-footer-btn">Войти</button>
      `;
      const signInBtn = footer.querySelector('[data-ref="sign-in-footer-btn"]') as HTMLButtonElement;
      signInBtn?.addEventListener('click', () => this.callbacks.onSignIn());
    }
  }
}



