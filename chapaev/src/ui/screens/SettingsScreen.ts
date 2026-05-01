/**
 * SettingsScreen — audio volume controls and rules link.
 */

import type { UIManager } from '../UIManager.ts';
import { audioSettings } from '../../config/AudioSettings.ts';
import { t } from '../../i18n/i18n.ts';

export interface SettingsCallbacks {
  onRules: () => void;
  onBack: () => void;
}

export class SettingsScreen {
  private readonly callbacks: SettingsCallbacks;

  constructor(uiManager: UIManager, callbacks: SettingsCallbacks) {
    this.callbacks = callbacks;

    uiManager.registerScreen('settings', (container) => {
      this.render(container);
    });
  }

  private render(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel settings-panel">
        <div class="settings-title">${t('settings.title')}</div>

        <div class="settings-group">
          <label class="settings-label">
            ${t('settings.music')}
            <span class="settings-value" data-ref="music-value">${Math.round(audioSettings.musicVolume * 100)}%</span>
          </label>
          <input
            type="range"
            class="settings-slider"
            data-ref="music-slider"
            min="0" max="100" step="1"
            value="${Math.round(audioSettings.musicVolume * 100)}"
          />
        </div>

        <div class="settings-group">
          <label class="settings-label">
            ${t('settings.sounds')}
            <span class="settings-value" data-ref="sfx-value">${Math.round(audioSettings.sfxVolume * 100)}%</span>
          </label>
          <input
            type="range"
            class="settings-slider"
            data-ref="sfx-slider"
            min="0" max="100" step="1"
            value="${Math.round(audioSettings.sfxVolume * 100)}"
          />
        </div>

        <hr class="settings-divider" />

        <button class="btn-secondary" data-ref="rules-btn" style="width: 100%;">
          ${t('settings.rules')}
        </button>

        <div style="margin-top: 16px;">
          <button class="btn-ghost" data-ref="back-btn">${t('common.back')}</button>
        </div>
      </div>
    `;

    const musicSlider = container.querySelector('[data-ref="music-slider"]') as HTMLInputElement;
    const sfxSlider = container.querySelector('[data-ref="sfx-slider"]') as HTMLInputElement;
    const musicValue = container.querySelector('[data-ref="music-value"]') as HTMLSpanElement;
    const sfxValue = container.querySelector('[data-ref="sfx-value"]') as HTMLSpanElement;
    const rulesBtn = container.querySelector('[data-ref="rules-btn"]') as HTMLButtonElement;
    const backBtn = container.querySelector('[data-ref="back-btn"]') as HTMLButtonElement;

    musicSlider.addEventListener('input', () => {
      const val = parseInt(musicSlider.value, 10);
      musicValue.textContent = `${val}%`;
      audioSettings.musicVolume = val / 100;
    });

    sfxSlider.addEventListener('input', () => {
      const val = parseInt(sfxSlider.value, 10);
      sfxValue.textContent = `${val}%`;
      audioSettings.sfxVolume = val / 100;
    });

    rulesBtn.addEventListener('click', () => this.callbacks.onRules());
    backBtn.addEventListener('click', () => this.callbacks.onBack());
  }
}



