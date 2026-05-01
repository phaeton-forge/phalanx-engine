/**
 * PrivateMatch screen — create or join a private room.
 */

import type { UIManager } from '../UIManager.ts';
import { t } from '../../i18n/i18n.ts';

export interface PrivateMatchCallbacks {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onCancel: () => void;
  onBack: () => void;
  getPrivateRoomShareUrl: (roomCode: string) => string;
}

type PrivateMatchState = 'menu' | 'waiting' | 'joining';

export class PrivateMatchScreen {
  private readonly uiManager: UIManager;
  private readonly callbacks: PrivateMatchCallbacks;
  private state: PrivateMatchState = 'menu';
  private roomCode = '';
  /**
   * Inline status message shown on the waiting screen during a recover
   * cycle ("connection lost / restoring / failed"). `null` hides the
   * banner. Lives outside `state` because it can flip arbitrarily often
   * during a single waiting session and we don't want to redraw the
   * whole screen for it.
   */
  private recoveryStatus: string | null = null;

  constructor(uiManager: UIManager, callbacks: PrivateMatchCallbacks) {
    this.uiManager = uiManager;
    this.callbacks = callbacks;

    uiManager.registerScreen('private-match', (container) => {
      this.render(container);
    });
  }

  /** Show the initial menu */
  public showMenu(): void {
    this.state = 'menu';
    this.uiManager.refreshScreen('private-match');
  }

  /** Show waiting for opponent with room code */
  public showWaiting(code: string): void {
    this.state = 'waiting';
    this.roomCode = code.trim().toUpperCase();
    this.uiManager.refreshScreen('private-match');
  }

  /**
   * Surface a recover-in-progress / recover-failed message on the
   * waiting screen without redrawing it. Pass `null` to clear.
   *
   * Idempotent: only mutates the DOM if the banner element is present
   * (i.e., the waiting screen is the active state) — otherwise we
   * just remember the value so the next render picks it up.
   */
  public setRecoveryStatus(status: string | null): void {
    this.recoveryStatus = status;
    if (this.state !== 'waiting') return;
    const container = document.querySelector(
      '[data-screen="private-match"]',
    ) as HTMLElement | null;
    if (!container) return;
    const banner = container.querySelector(
      '[data-ref="recovery-status"]',
    ) as HTMLDivElement | null;
    if (!banner) return;
    if (status) {
      banner.textContent = status;
      banner.style.display = '';
    } else {
      banner.textContent = '';
      banner.style.display = 'none';
    }
  }

  private render(container: HTMLDivElement): void {
    container.className = 'ui-screen';

    switch (this.state) {
      case 'menu':
        this.renderMenu(container);
        break;
      case 'waiting':
        this.renderWaiting(container);
        break;
      default:
        this.renderMenu(container);
    }
  }

  private renderMenu(container: HTMLDivElement): void {
    this.stopWaitingTimer();
    container.innerHTML = `
      <div class="glass-panel">
        <div class="private-match-title">${t('privateMatch.title')}</div>

        <button class="btn-primary" data-ref="create-btn">
          ${t('privateMatch.createRoom')}
        </button>

        <div class="private-match-or">
          <span>${t('privateMatch.or')}</span>
        </div>

        <div class="private-match-join-row">
          <input
            class="private-match-input"
            data-ref="code-input"
            placeholder="${t('privateMatch.roomCodePlaceholder')}"
            maxlength="6"
            autocomplete="off"
          />
          <button class="btn-primary private-match-join-btn" data-ref="join-btn">
            ${t('privateMatch.join')}
          </button>
        </div>

        <div style="margin-top: 16px;">
          <button class="btn-ghost" data-ref="back-btn">${t('common.back')}</button>
        </div>
      </div>
    `;

    const createBtn = container.querySelector('[data-ref="create-btn"]') as HTMLButtonElement;
    const joinBtn = container.querySelector('[data-ref="join-btn"]') as HTMLButtonElement;
    const codeInput = container.querySelector('[data-ref="code-input"]') as HTMLInputElement;
    const backBtn = container.querySelector('[data-ref="back-btn"]') as HTMLButtonElement;

    createBtn.addEventListener('click', () => this.callbacks.onCreateRoom());

    joinBtn.addEventListener('click', () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length >= 4) {
        this.callbacks.onJoinRoom(code);
      }
    });

    codeInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const code = codeInput.value.trim().toUpperCase();
        if (code.length >= 4) {
          this.callbacks.onJoinRoom(code);
        }
      }
    });

    backBtn.addEventListener('click', () => this.callbacks.onBack());
  }

  private renderWaiting(container: HTMLDivElement): void {
    const roomCode = this.roomCode;
    const shareLink = this.callbacks.getPrivateRoomShareUrl(roomCode);

    container.innerHTML = `
      <div class="glass-panel">
        <div class="private-match-title">${t('privateMatch.roomCreated')}</div>

        <div class="room-code-display">
          <div class="room-code-value" data-ref="room-code"></div>
          <button class="room-code-copy" data-ref="copy-btn">${t('privateMatch.copyCode')}</button>
        </div>

        <div class="room-link-display" style="margin-bottom: 16px;">
          <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 4px;">${t('privateMatch.copyLinkLabel')}</div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input class="private-match-input" data-ref="link-input" readonly style="flex: 1; font-size: 12px; letter-spacing: normal; text-transform: none;" />
            <button class="room-code-copy" data-ref="copy-link-btn">📋</button>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px;">
          <div class="matchmaking-spinner" style="width: 20px; height: 20px; margin: 0;"></div>
          <span style="color: var(--text-muted); font-size: 14px;">${t('privateMatch.waitingOpponent')}</span>
        </div>

        <div class="matchmaking-timer" data-ref="timer" style="margin-bottom: 16px;">${t('matchmaking.waitingTime', { time: '0:00' })}</div>

        <div data-ref="recovery-status" style="display: none; color: var(--text-muted); font-size: 13px; margin-bottom: 12px; text-align: center;"></div>

        <button class="btn-secondary" data-ref="cancel-btn">${t('matchmaking.cancel')}</button>
      </div>
    `;

    const roomCodeEl = container.querySelector('[data-ref="room-code"]') as HTMLDivElement;
    roomCodeEl.textContent = roomCode;

    const linkInput = container.querySelector('[data-ref="link-input"]') as HTMLInputElement;
    linkInput.value = shareLink;

    const copyBtn = container.querySelector('[data-ref="copy-btn"]') as HTMLButtonElement;
    const copyLinkBtn = container.querySelector('[data-ref="copy-link-btn"]') as HTMLButtonElement;
    const cancelBtn = container.querySelector('[data-ref="cancel-btn"]') as HTMLButtonElement;

    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(roomCode).then(() => {
        copyBtn.textContent = t('privateMatch.copied');
        setTimeout(() => { copyBtn.textContent = t('privateMatch.copyCode'); }, 2000);
      }).catch(() => {
        copyBtn.textContent = t('privateMatch.error');
        setTimeout(() => { copyBtn.textContent = t('privateMatch.copyCode'); }, 2000);
      });
    });

    copyLinkBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(shareLink).then(() => {
        copyLinkBtn.textContent = '✅';
        setTimeout(() => { copyLinkBtn.textContent = '📋'; }, 2000);
      }).catch(() => {
        copyLinkBtn.textContent = '❌';
        setTimeout(() => { copyLinkBtn.textContent = '📋'; }, 2000);
      });
    });

    cancelBtn.addEventListener('click', () => {
      this.stopWaitingTimer();
      this.callbacks.onCancel();
    });

    // Start waiting timer
    this.startWaitingTimer(container);

    // Re-apply any recovery status that was set before this render
    // (e.g. cold-start path: status set, then UI mounts).
    if (this.recoveryStatus) {
      const banner = container.querySelector(
        '[data-ref="recovery-status"]',
      ) as HTMLDivElement | null;
      if (banner) {
        banner.textContent = this.recoveryStatus;
        banner.style.display = '';
      }
    }
  }

  private waitingTimerInterval: ReturnType<typeof setInterval> | null = null;

  private startWaitingTimer(container: HTMLDivElement): void {
    this.stopWaitingTimer();
    const startTime = Date.now();
    const timerEl = container.querySelector('[data-ref="timer"]');
    this.waitingTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      if (timerEl) {
        const time = `${mins}:${secs.toString().padStart(2, '0')}`;
        timerEl.textContent = t('matchmaking.waitingTime', { time });
      }
    }, 1000);
  }

  public stopWaitingTimer(): void {
    if (this.waitingTimerInterval !== null) {
      clearInterval(this.waitingTimerInterval);
      this.waitingTimerInterval = null;
    }
  }
}

