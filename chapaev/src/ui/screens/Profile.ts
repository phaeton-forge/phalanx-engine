/**
 * Profile screen — shows player info and basic stats.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface ProfileCallbacks {
  onBack: () => void;
}

export class ProfileScreen {
  private readonly callbacks: ProfileCallbacks;

  constructor(uiManager: UIManager, callbacks: ProfileCallbacks) {
    this.callbacks = callbacks;

    uiManager.registerScreen('profile', (container) => {
      this.render(container);
    });
  }

  private render(container: HTMLDivElement): void {
    const displayName = t('profile.guest');

    container.className = 'ui-screen';

    const panel = document.createElement('div');
    panel.className = 'glass-panel';

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'profile-avatar';
    avatarDiv.style.cssText =
      'display: flex; align-items: center; justify-content: center; font-size: 28px; color: var(--text-muted);';
    avatarDiv.textContent = '👤';
    panel.appendChild(avatarDiv);

    // Name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'profile-name';
    nameDiv.textContent = displayName;
    panel.appendChild(nameDiv);

    // Stats section
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'profile-section-title';
    sectionTitle.textContent = t('profile.statsTitle');
    panel.appendChild(sectionTitle);

    const statsDiv = document.createElement('div');
    statsDiv.className = 'profile-stats';
    statsDiv.style.cssText = 'text-align: center; color: var(--text-muted); font-size: 14px; padding: 12px 0;';
    statsDiv.textContent = t('profile.comingSoon');
    panel.appendChild(statsDiv);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'profile-actions';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn-ghost';
    backBtn.textContent = t('common.back');
    backBtn.addEventListener('click', () => this.callbacks.onBack());
    actionsDiv.appendChild(backBtn);

    panel.appendChild(actionsDiv);
    container.appendChild(panel);
  }
}


