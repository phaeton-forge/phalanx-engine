/**
 * GameHUD — minimal in-game overlay during matches.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface GameHUDCallbacks {
  onPause: () => void;
  onSettings: () => void;
}

export class GameHUDScreen {
  private readonly uiManager: UIManager;
  private readonly callbacks: GameHUDCallbacks;
  private isHotseat = false;
  /** When true, pause button looks like “exit” but turn wording stays online-style. */
  private pauseShowsExit = false;

  constructor(uiManager: UIManager, callbacks: GameHUDCallbacks) {
    this.uiManager = uiManager;
    this.callbacks = callbacks;

    uiManager.registerScreen('game', (container) => {
      this.render(container);
    });
  }

  private render(container: HTMLDivElement): void {
    container.className = 'hud-container';
    container.innerHTML = `
      <!-- Top Bar -->
      <div class="hud-top-bar">
        <div class="hud-player-info" data-ref="player1-info">
          <div class="avatar" data-ref="player1-avatar" style="display: flex; align-items: center; justify-content: center; font-size: 14px;">⬜</div>
          <span class="player-name" data-ref="player1-name">${t('hud.player1')}</span>
          <div class="hud-checker-indicators" data-ref="player1-checkers"></div>
        </div>
        <div class="hud-round-info" data-ref="round-info">${t('hud.round', { round: 1 })}</div>
        <div class="hud-player-info" data-ref="player2-info">
          <div class="hud-checker-indicators" data-ref="player2-checkers"></div>
          <span class="player-name" data-ref="player2-name">${t('hud.player2')}</span>
          <div class="avatar" data-ref="player2-avatar" style="display: flex; align-items: center; justify-content: center; font-size: 14px;">⬛</div>
        </div>
      </div>

      <!-- Turn Indicator -->
      <div class="hud-turn-indicator your-turn" data-ref="turn-indicator">
        ${t('hud.yourTurn')}
      </div>

      <!-- Toast container for round/match notifications -->
      <div class="hud-toast-container" data-ref="toast-container"></div>

      <!-- Bottom Bar -->
      <div class="hud-bottom-bar">
        <button data-ref="settings-btn" title="${t('hud.settingsTitle')}">⚙️</button>
        <button data-ref="pause-btn" title="${t('hud.pauseTitle')}">⏸️</button>
      </div>
    `;

    // Initialize checker indicators
    this.initCheckerIndicators(container, 'player1-checkers', 8);
    this.initCheckerIndicators(container, 'player2-checkers', 8);

    // Events
    const settingsBtn = container.querySelector(
      '[data-ref="settings-btn"]'
    ) as HTMLButtonElement;
    const pauseBtn = container.querySelector(
      '[data-ref="pause-btn"]'
    ) as HTMLButtonElement;

    settingsBtn.addEventListener('click', () => this.callbacks.onSettings());
    pauseBtn.addEventListener('click', () => this.callbacks.onPause());
  }

  private initCheckerIndicators(
    container: HTMLDivElement,
    ref: string,
    total: number
  ): void {
    const el = container.querySelector(`[data-ref="${ref}"]`);
    if (!el) return;
    el.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'hud-checker-dot alive';
      el.appendChild(dot);
    }
  }

  /** Update checker count for a player */
  public updateCheckerCount(
    playerIndex: number,
    alive: number,
    total: number
  ): void {
    const screenEl = this.uiManager.getScreenElement('game');
    if (!screenEl) return;

    const ref = playerIndex === 0 ? 'player1-checkers' : 'player2-checkers';
    const el = screenEl.querySelector(`[data-ref="${ref}"]`);
    if (!el) return;

    const dots = el.querySelectorAll('.hud-checker-dot');
    dots.forEach((dot, i) => {
      dot.className =
        i < alive ? 'hud-checker-dot alive' : 'hud-checker-dot dead';
    });

    // Ensure correct total number of dots
    while (el.children.length < total) {
      const dot = document.createElement('div');
      dot.className =
        el.children.length < alive
          ? 'hud-checker-dot alive'
          : 'hud-checker-dot dead';
      el.appendChild(dot);
    }
  }

  /** Enable hotseat mode (changes turn indicator text) */
  public setHotseatMode(enabled: boolean): void {
    this.isHotseat = enabled;
    if (enabled) {
      this.pauseShowsExit = true;
      this.applyPauseButtonStyle();
    } else {
      this.pauseShowsExit = false;
      this.applyPauseButtonStyle();
    }
  }

  /**
   * Use online turn strings (your turn / opponent) but show the door control
   * instead of network pause — for local AI that mimics online matchmaking.
   */
  public setPauseAsMenuExit(exit: boolean): void {
    this.pauseShowsExit = exit;
    this.applyPauseButtonStyle();
  }

  private applyPauseButtonStyle(): void {
    const screenEl = this.uiManager.getScreenElement('game');
    if (!screenEl) return;
    const pauseBtn = screenEl.querySelector(
      '[data-ref="pause-btn"]'
    ) as HTMLButtonElement | null;
    if (!pauseBtn) return;
    if (this.pauseShowsExit) {
      pauseBtn.title = t('hud.exitTitle');
      pauseBtn.textContent = '🚪';
    } else {
      pauseBtn.title = t('hud.pauseTitle');
      pauseBtn.textContent = '⏸️';
    }
  }

  /** Update turn indicator */
  public updateTurnIndicator(
    isLocalTurn: boolean,
    team?: 'white' | 'black'
  ): void {
    const screenEl = this.uiManager.getScreenElement('game');
    if (!screenEl) return;

    const indicator = screenEl.querySelector('[data-ref="turn-indicator"]');
    if (!indicator) return;

    if (this.isHotseat) {
      const teamKey = team === 'black' ? 'hud.team.black' : 'hud.team.white';
      indicator.textContent = t('hud.turnTeam', { team: t(teamKey) });
      indicator.className = 'hud-turn-indicator your-turn';
    } else if (isLocalTurn) {
      indicator.textContent = t('hud.yourTurn');
      indicator.className = 'hud-turn-indicator your-turn';
    } else {
      indicator.textContent = t('hud.opponentTurn');
      indicator.className = 'hud-turn-indicator opponent-turn';
    }
  }

  /** Update round display */
  public updateRound(round: number): void {
    const screenEl = this.uiManager.getScreenElement('game');
    if (!screenEl) return;

    const roundEl = screenEl.querySelector('[data-ref="round-info"]');
    if (roundEl) {
      roundEl.textContent = t('hud.round', { round });
    }
  }

  /** Set player names */
  public setPlayerNames(player1: string, player2: string): void {
    const screenEl = this.uiManager.getScreenElement('game');
    if (!screenEl) return;

    const name1 = screenEl.querySelector('[data-ref="player1-name"]');
    const name2 = screenEl.querySelector('[data-ref="player2-name"]');
    if (name1) name1.textContent = player1;
    if (name2) name2.textContent = player2;
  }

  /** Show a temporary toast message (round win/loss, match result, etc.) */
  public showToast(
    message: string,
    type: 'success' | 'defeat' | 'info' = 'info',
    durationMs = 2500
  ): void {
    const screenEl = this.uiManager.getScreenElement('game');
    if (!screenEl) return;

    const container = screenEl.querySelector('[data-ref="toast-container"]');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `hud-toast hud-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      toast.classList.add('hud-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('hud-toast-visible');
      toast.classList.add('hud-toast-exit');
      toast.addEventListener('animationend', () => toast.remove(), {
        once: true,
      });
      // Fallback removal
      setTimeout(() => toast.remove(), 500);
    }, durationMs);
  }
}
