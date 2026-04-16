/**
 * PrivateMatch screen — create or join a private room.
 */

import type { UIManager } from '../UIManager.ts';

export interface PrivateMatchCallbacks {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onCancel: () => void;
  onBack: () => void;
}

type PrivateMatchState = 'menu' | 'waiting' | 'joining';

export class PrivateMatchScreen {
  private readonly uiManager: UIManager;
  private readonly callbacks: PrivateMatchCallbacks;
  private state: PrivateMatchState = 'menu';
  private roomCode = '';

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
    this.roomCode = code;
    this.uiManager.refreshScreen('private-match');
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
    container.innerHTML = `
      <div class="glass-panel">
        <div class="private-match-title">Приватный матч</div>

        <button class="btn-primary" data-ref="create-btn">
          Создать комнату
        </button>

        <div class="private-match-or">
          <span>или</span>
        </div>

        <div class="private-match-join-row">
          <input
            class="private-match-input"
            data-ref="code-input"
            placeholder="Код комнаты..."
            maxlength="6"
            autocomplete="off"
          />
          <button class="btn-primary private-match-join-btn" data-ref="join-btn">
            Войти
          </button>
        </div>

        <div style="margin-top: 16px;">
          <button class="btn-ghost" data-ref="back-btn">← Назад</button>
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
    const shareLink = `${window.location.origin}${window.location.pathname}?room=${this.roomCode}`;

    container.innerHTML = `
      <div class="glass-panel">
        <div class="private-match-title">Комната создана!</div>

        <div class="room-code-display">
          <div class="room-code-value" data-ref="room-code"></div>
          <button class="room-code-copy" data-ref="copy-btn">📋 Копировать код</button>
        </div>

        <div class="room-link-display" style="margin-bottom: 16px;">
          <div style="color: var(--text-muted); font-size: 12px; margin-bottom: 4px;">Ссылка для приглашения:</div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input class="private-match-input" data-ref="link-input" readonly value="${shareLink}" style="flex: 1; font-size: 12px;" />
            <button class="room-code-copy" data-ref="copy-link-btn">📋</button>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px;">
          <div class="matchmaking-spinner" style="width: 20px; height: 20px; margin: 0;"></div>
          <span style="color: var(--text-muted); font-size: 14px;">Ожидание соперника...</span>
        </div>

        <div class="matchmaking-timer" data-ref="timer" style="margin-bottom: 16px;">Время ожидания: 0:00</div>

        <button class="btn-secondary" data-ref="cancel-btn">Отменить</button>
      </div>
    `;

    const roomCodeEl = container.querySelector('[data-ref="room-code"]') as HTMLDivElement;
    roomCodeEl.textContent = this.roomCode;

    const copyBtn = container.querySelector('[data-ref="copy-btn"]') as HTMLButtonElement;
    const copyLinkBtn = container.querySelector('[data-ref="copy-link-btn"]') as HTMLButtonElement;
    const cancelBtn = container.querySelector('[data-ref="cancel-btn"]') as HTMLButtonElement;

    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.roomCode).then(() => {
        copyBtn.textContent = '✅ Скопировано!';
        setTimeout(() => { copyBtn.textContent = '📋 Копировать код'; }, 2000);
      }).catch(() => {
        copyBtn.textContent = '❌ Ошибка';
        setTimeout(() => { copyBtn.textContent = '📋 Копировать код'; }, 2000);
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

    cancelBtn.addEventListener('click', () => this.callbacks.onCancel());

    // Start waiting timer
    this.startWaitingTimer(container);
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
        timerEl.textContent = `Время ожидания: ${mins}:${secs.toString().padStart(2, '0')}`;
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

