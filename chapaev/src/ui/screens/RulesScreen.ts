/**
 * RulesScreen — displays game rules for Chapayev Checkers.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface RulesCallbacks {
  onBack: () => void;
}

export class RulesScreen {
  private readonly callbacks: RulesCallbacks;

  constructor(uiManager: UIManager, callbacks: RulesCallbacks) {
    this.callbacks = callbacks;

    uiManager.registerScreen('rules', (container) => {
      this.render(container);
    });
  }

  private render(container: HTMLDivElement): void {
    container.className = 'ui-screen';
    container.innerHTML = `
      <div class="glass-panel rules-panel">
        <div class="rules-title">${t('rules.title')}</div>
        <div class="rules-content">${t('rules.html')}</div>
        <button class="btn-ghost" data-ref="back-btn">${t('common.back')}</button>
      </div>
    `;

    const backBtn = container.querySelector('[data-ref="back-btn"]') as HTMLButtonElement;
    backBtn.addEventListener('click', () => this.callbacks.onBack());
  }
}

