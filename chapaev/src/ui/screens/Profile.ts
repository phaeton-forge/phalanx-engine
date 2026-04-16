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

    const panel = document.createElement('div');
    panel.className = 'glass-panel';

    // Avatar
    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'profile-avatar';
      img.setAttribute('src', avatarUrl);
      img.setAttribute('alt', 'Avatar');
      panel.appendChild(img);
    } else {
      const avatarDiv = document.createElement('div');
      avatarDiv.className = 'profile-avatar';
      avatarDiv.style.cssText = 'display: flex; align-items: center; justify-content: center; font-size: 28px; color: var(--text-muted);';
      avatarDiv.textContent = '👤';
      panel.appendChild(avatarDiv);
    }

    // Name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'profile-name';
    nameDiv.textContent = displayName;
    panel.appendChild(nameDiv);

    // Email
    const emailDiv = document.createElement('div');
    emailDiv.className = 'profile-email';
    emailDiv.textContent = email;
    panel.appendChild(emailDiv);

    // Stats section
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'profile-section-title';
    sectionTitle.textContent = 'Статистика';
    panel.appendChild(sectionTitle);

    const statsDiv = document.createElement('div');
    statsDiv.className = 'profile-stats';
    statsDiv.style.cssText = 'text-align: center; color: var(--text-muted); font-size: 14px; padding: 12px 0;';
    statsDiv.textContent = 'Будет позже';
    panel.appendChild(statsDiv);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'profile-actions';

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-ghost profile-logout-btn';
    logoutBtn.textContent = 'Выйти из аккаунта';
    logoutBtn.addEventListener('click', () => this.callbacks.onSignOut());
    actionsDiv.appendChild(logoutBtn);

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-ghost';
    backBtn.textContent = '← Назад';
    backBtn.addEventListener('click', () => this.callbacks.onBack());
    actionsDiv.appendChild(backBtn);

    panel.appendChild(actionsDiv);
    container.appendChild(panel);
  }
}


