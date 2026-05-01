/**
 * PauseOverlay — shown when game is paused.
 * Both players see it; only the player who paused can resume.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface PauseCallbacks {
  onResume: () => void;
  onLeave: () => void | Promise<void>;
}

export class PauseOverlay {
  private readonly uiManager: UIManager;
  private readonly callbacks: PauseCallbacks;
  private canResume = true;

  constructor(uiManager: UIManager, callbacks: PauseCallbacks) {
    this.uiManager = uiManager;
    this.callbacks = callbacks;

    uiManager.registerScreen('pause', (container) => {
      this.render(container);
    });
  }

  /** Set whether the local player can click "Resume" (only the pauser can resume). */
  public setCanResume(canResume: boolean): void {
    this.canResume = canResume;
    // Update button state if already rendered
    const screenEl = this.uiManager.getScreenElement('pause');
    if (!screenEl) return;
    const resumeBtn = screenEl.querySelector('[data-ref="resume-btn"]') as HTMLButtonElement | null;
    if (resumeBtn) {
      resumeBtn.disabled = !canResume;
      resumeBtn.style.opacity = canResume ? '1' : '0.4';
      resumeBtn.style.cursor = canResume ? 'pointer' : 'not-allowed';
    }
    const info = screenEl.querySelector('[data-ref="pause-info"]') as HTMLDivElement | null;
    if (info) {
      info.textContent = canResume ? t('pause.youPaused') : t('pause.opponentPaused');
    }
  }

  private render(container: HTMLDivElement): void {
    container.className = 'pause-overlay';
    container.innerHTML = `
      <div class="glass-panel" style="max-width: 360px; width: 90vw; text-align: center;">
        <div class="pause-title">${t('pause.title')}</div>
        <div class="pause-info" data-ref="pause-info">${t('pause.paused')}</div>
        <div class="pause-buttons">
          <button class="btn-primary" data-ref="resume-btn">${t('pause.resume')}</button>
          <button class="btn-ghost" data-ref="leave-btn" style="color: var(--color-error);">
            ${t('pause.leaveMatch')}
          </button>
        </div>
      </div>
    `;

    const resumeBtn = container.querySelector('[data-ref="resume-btn"]') as HTMLButtonElement;
    const leaveBtn = container.querySelector('[data-ref="leave-btn"]') as HTMLButtonElement;

    resumeBtn.addEventListener('click', () => {
      if (this.canResume) this.callbacks.onResume();
    });
    leaveBtn.addEventListener('click', () => void this.callbacks.onLeave());

    // Apply initial state
    if (!this.canResume) {
      resumeBtn.disabled = true;
      resumeBtn.style.opacity = '0.4';
      resumeBtn.style.cursor = 'not-allowed';
    }
  }
}


