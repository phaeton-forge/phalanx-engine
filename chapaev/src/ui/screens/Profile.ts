/**
 * Profile screen — shows player info and basic stats.
 */

import type { PhalanxAuthState } from 'phalanx-client';
import type { UIManager } from '../UIManager.ts';

export interface ProfileCallbacks {
  onBack: () => void;
  onSignOut: () => void;
}

export class ProfileScreen {
  private readonly callbacks: ProfileCallbacks;
  private authState: PhalanxAuthState | null = null;

  constructor(uiManager: UIManager, callbacks: ProfileCallbacks) {
    this.callbacks = callbacks;

    uiManager.registerScreen('profile', (container) => {
      this.render(container);
    });
  }

  /** Set auth state before showing */
  public setAuthState(state: PhalanxAuthState): void {
    this.authState = state;
  }

  private render(container: HTMLDivElement): void {
    const user = this.authState?.user;
    const avatarUrl = user?.avatarUrl || '';
    const displayName = user?.username || user?.email || 'Игрок';
    const email = user?.email || '';

    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel">
        ${avatarUrl
          ? `<img class="profile-avatar" src="${avatarUrl}" alt="Avatar" />`
          : `<div class="profile-avatar" style="display: flex; align-items: center; justify-content: center; font-size: 28px; color: var(--text-muted);">👤</div>`
        }
        <div class="profile-name">${displayName}</div>
        <div class="profile-email">${email}</div>

        <div class="profile-section-title">Статистика</div>
        <div class="profile-stats" style="text-align: center; color: var(--text-muted); font-size: 14px; padding: 12px 0;">
          Будет позже
        </div>

        <div class="profile-actions">
          <button class="btn-ghost profile-logout-btn" data-ref="logout-btn">
            Выйти из аккаунта
          </button>
          <button class="btn-ghost" data-ref="back-btn">← Назад</button>
        </div>
      </div>
    `;

    const logoutBtn = container.querySelector('[data-ref="logout-btn"]') as HTMLButtonElement;
    const backBtn = container.querySelector('[data-ref="back-btn"]') as HTMLButtonElement;

    logoutBtn.addEventListener('click', () => this.callbacks.onSignOut());
    backBtn.addEventListener('click', () => this.callbacks.onBack());
  }
}


