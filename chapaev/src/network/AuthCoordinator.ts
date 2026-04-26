import type { PhalanxAuthState } from 'phalanx-client';
import type { NetworkContext } from './NetworkContext.ts';
import type { UIManager } from '../ui/UIManager.ts';
import type { MainMenuScreen } from '../ui/screens/MainMenu.ts';
import type { AuthModal } from '../ui/screens/AuthModal.ts';

const PENDING_ROOM_STORAGE_KEY = 'pendingRoomCode';

export interface AuthCallbacks {
  /**
   * Called when auth completes (or guest mode is selected) and there
   * was a pending room code from a deep-link. The coordinator hands
   * the code back; caller routes to `joinRoom`.
   */
  onPendingRoomJoin(code: string): void;
  /** Called when guest play is chosen with no pending room — start matchmaking. */
  onGuestQuickMatch(): void;
}

interface UIRefs {
  uiManager: UIManager;
  mainMenu: MainMenuScreen;
  authModal: AuthModal;
}

/**
 * Owns the auth flow: subscriptions to PhalanxClient auth events,
 * deep-link `?ROOM=` handling, and the `pendingRoomCode` lifecycle.
 */
export class AuthCoordinator {
  private pendingRoomCode: string | null = null;
  private isGuestMode = false;
  private authUnsubscribers: (() => void)[] = [];

  constructor(
    private readonly ctx: NetworkContext,
    private readonly ui: UIRefs,
    private readonly callbacks: AuthCallbacks
  ) {}

  /**
   * Read deep-link / sessionStorage room code on cold start. Removes
   * the URL param and storage entry — caller is then expected to
   * either show the auth modal (if not signed in) or join directly.
   */
  consumeDeepLinkRoomCode(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCodeFromUrl = urlParams.get('ROOM') ?? urlParams.get('room');
    const roomCodeFromStorage = sessionStorage.getItem(
      PENDING_ROOM_STORAGE_KEY
    );
    const roomCode = roomCodeFromUrl ?? roomCodeFromStorage;

    if (roomCodeFromUrl) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (roomCodeFromStorage) {
      sessionStorage.removeItem(PENDING_ROOM_STORAGE_KEY);
    }
    return roomCode ? roomCode.toUpperCase() : null;
  }

  /**
   * True when auth is enabled and the user has not signed in nor opted
   * into guest mode — caller should redirect to the auth modal before
   * proceeding with anything that requires identity.
   */
  requiresAuth(): boolean {
    return (
      this.ctx.manager.authEnabled &&
      !this.ctx.manager.getAuthState().isAuthenticated &&
      !this.isGuestMode
    );
  }

  /** Persist a room code to revisit after auth completes. */
  setPendingRoomCode(code: string): void {
    this.pendingRoomCode = code;
    sessionStorage.setItem(PENDING_ROOM_STORAGE_KEY, code);
  }

  getCurrentAuthState(): PhalanxAuthState {
    return this.ctx.manager.getAuthState();
  }

  subscribe(): void {
    this.authUnsubscribers.push(
      this.ctx.manager.onAuthStateChanged((state) => {
        this.ui.mainMenu.updateAuthState(state);

        if (
          state.isAuthenticated &&
          this.ui.uiManager.getCurrentScreen() === 'auth'
        ) {
          this.ui.uiManager.hideScreen('auth');

          if (this.pendingRoomCode) {
            const code = this.pendingRoomCode;
            this.clearPendingRoom();
            this.callbacks.onPendingRoomJoin(code);
            return;
          }

          this.ui.uiManager.showScreen('main-menu');
          this.ui.mainMenu.updateAuthState(state);
        }
      })
    );

    this.authUnsubscribers.push(
      this.ctx.manager.onAuthError((error) => {
        console.error('[Auth] error:', error.message);
        this.ui.authModal.setStatus(`Ошибка: ${error.message}`, true);
      })
    );
  }

  unsubscribe(): void {
    for (const unsub of this.authUnsubscribers) unsub();
    this.authUnsubscribers = [];
  }

  startGoogleSignIn(): void {
    this.ui.authModal.setStatus('Перенаправление на Google...');
    this.ctx.manager.login();
  }

  enterGuestMode(): void {
    this.isGuestMode = true;
    this.ui.uiManager.hideScreen('auth');

    if (this.pendingRoomCode) {
      const code = this.pendingRoomCode;
      this.clearPendingRoom();
      this.callbacks.onPendingRoomJoin(code);
      return;
    }

    this.ui.uiManager.showScreen('main-menu');
    this.callbacks.onGuestQuickMatch();
  }

  cancelAuth(): void {
    this.clearPendingRoom();
    this.ui.uiManager.hideScreen('auth');
    this.ui.uiManager.showScreen('main-menu');
  }

  async signOut(): Promise<void> {
    await this.ctx.manager.logout();
    this.ui.mainMenu.updateAuthState(this.ctx.manager.getAuthState());
  }

  private clearPendingRoom(): void {
    this.pendingRoomCode = null;
    sessionStorage.removeItem(PENDING_ROOM_STORAGE_KEY);
  }
}
