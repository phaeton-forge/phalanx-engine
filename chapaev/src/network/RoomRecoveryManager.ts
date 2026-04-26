import {
  saveRoom as saveActiveRoom,
  loadRoom as loadActiveRoom,
  clearRoom as clearActiveRoom,
} from './RoomPersistence.ts';
import type { NetworkContext } from './NetworkContext.ts';

interface NetworkInformationLike {
  readonly effectiveType?: string;
  readonly rtt?: number;
}

interface NavigatorWithConnection extends Navigator {
  readonly connection?: NetworkInformationLike;
  readonly mozConnection?: NetworkInformationLike;
  readonly webkitConnection?: NetworkInformationLike;
}

export interface RecoveryUI {
  /** Show transient recovery status text on the waiting screen. Pass null to clear. */
  setRecoveryStatus(text: string | null): void;
  /** Show a status string on the matchmaking screen (used for terminal failures). */
  setMatchmakingStatus(text: string): void;
}

export interface RecoveryCallbacks {
  /** Called on terminal recovery outcomes (room expired / cancelled by server). */
  onRoomTerminated(): void;
}

/**
 * Manages every aspect of recovering a private room after a transport
 * interruption: visibilitychange / pageshow listeners, socket
 * connect/disconnect hooks, retry backoff, and the localStorage
 * persistence record. Owns its own state — `Game` no longer needs
 * to track any of this.
 */
export class RoomRecoveryManager {
  private static readonly MAX_RECOVER_ATTEMPTS = 5;
  private static readonly NETWORK_STABILIZE_DELAY_MS = 300;
  private static readonly CONNECTED_RECOVER_DELAY_MS = 300;
  private static readonly DISCONNECTED_RECOVER_DELAY_MS = 300;
  private static readonly OFFLINE_WAIT_TIMEOUT_MS = 30_000;
  private static readonly DEFAULT_RECOVER_TIMEOUT_MS = 10_000;
  private static readonly DEGRADED_RECOVER_TIMEOUT_MS = 15_000;
  private static readonly SLOW_RECOVER_TIMEOUT_MS = 25_000;

  private activeRoomCode: string | null = null;
  private isRecovering = false;
  private pendingRecoverRequested = false;
  private recoverAttempt = 0;
  private recoverRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoverScheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityRecoverHandler: (() => void) | null = null;
  private privateRoomEventUnsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: NetworkContext,
    private readonly ui: RecoveryUI,
    private readonly callbacks: RecoveryCallbacks
  ) {}

  /** True if a private room is being tracked for potential recovery. */
  hasActiveRoom(): boolean {
    return this.activeRoomCode !== null;
  }

  getActiveRoomCode(): string | null {
    return this.activeRoomCode;
  }

  /**
   * Cold-start recovery: read the persisted record (mobile killed the
   * tab while the user was in a messenger) and validate it against the
   * current playerId. Returns the code to recover, or null when there's
   * nothing to do (no record, expired, or playerId drift).
   */
  loadColdStartCode(): string | null {
    const persisted = loadActiveRoom();
    if (!persisted) {
      this.log('loadColdStartCode:empty');
      return null;
    }
    if (persisted.role !== 'host') {
      this.log('loadColdStartCode:non-host-record', {
        role: persisted.role,
        code: persisted.code,
      });
      return null;
    }

    const currentPlayerId = this.ctx.manager.localPlayerId;
    if (currentPlayerId && currentPlayerId === persisted.playerId) {
      this.log('loadColdStartCode:found', { code: persisted.code });
      return persisted.code;
    }
    // playerId mismatch — abandon the stale entry rather than letting
    // the user stare at a permanently-failing waiting screen.
    this.log('loadColdStartCode:playerId-mismatch', {
      code: persisted.code,
      persistedPlayerId: persisted.playerId,
      currentPlayerId,
    });
    clearActiveRoom();
    return null;
  }

  /**
   * Begin tracking `code` as the active host-side room and arm both
   * recovery channels (visibility + socket events). Persists to
   * localStorage so a subsequent cold start can reclaim it.
   */
  startTrackingHostRoom(code: string): void {
    this.activeRoomCode = code;
    this.log('startTrackingHostRoom', { code });
    saveActiveRoom({
      code,
      role: 'host',
      playerId: this.ctx.manager.localPlayerId,
    });
    this.armPrivateRoomEventHooks();
    this.armVisibilityRecover();
  }

  /**
   * Variant used by cold-start recover: assumes `saveActiveRoom` was
   * already written by a previous tab and just rearms the hooks.
   */
  resumeTrackingHostRoom(code: string): void {
    this.activeRoomCode = code;
    this.log('resumeTrackingHostRoom', { code });
    this.armPrivateRoomEventHooks();
    this.armVisibilityRecover();
  }

  /** Persist a guest-side join attempt for cold-start surface. */
  trackGuestJoin(code: string): void {
    this.log('trackGuestJoin', { code });
    saveActiveRoom({
      code,
      role: 'guest',
      playerId: this.ctx.manager.localPlayerId,
    });
  }

  /**
   * Stop all recovery machinery and forget the active room. Idempotent.
   */
  stop(): void {
    this.log('stop', { activeRoomCode: this.activeRoomCode });
    this.disarmVisibilityRecover();
    this.disarmPrivateRoomEventHooks();
    this.activeRoomCode = null;
    this.pendingRecoverRequested = false;
    this.recoverAttempt = 0;
    clearActiveRoom();
  }

  /**
   * Attempt one recovery cycle. Idempotent against concurrent calls
   * (the visibility and `connected` hooks may fire near-simultaneously
   * on mobile). Schedules its own backoff retry on transient failure.
   */
  async tryRecover(): Promise<void> {
    const code = this.activeRoomCode;
    if (!code) {
      this.log('tryRecover:skip-no-active-room');
      return;
    }
    if (this.isRecovering) {
      this.log('tryRecover:already-running', { code });
      this.pendingRecoverRequested = true;
      return;
    }

    this.isRecovering = true;
    this.pendingRecoverRequested = false;
    if (this.recoverRetryTimer) {
      clearTimeout(this.recoverRetryTimer);
      this.recoverRetryTimer = null;
    }

    try {
      console.log(
        `[RoomRecovery] Attempting to recover room ${code} (attempt ${this.recoverAttempt + 1})`
      );
      this.log('tryRecover:start', {
        code,
        attempt: this.recoverAttempt + 1,
        navigatorOnline: RoomRecoveryManager.isOnline(),
      });
      this.ui.setRecoveryStatus('Восстановление подключения…');
      await this.waitForOnlineAndStabilize();
      if (this.activeRoomCode !== code) {
        this.log('tryRecover:active-room-changed', {
          expectedCode: code,
          activeRoomCode: this.activeRoomCode,
        });
        return;
      }

      // NOTE: we deliberately do NOT short-circuit on
      // `client.isConnected()`. socket.io auto-reconnect can produce
      // a fresh connection while we were backgrounded — that socket
      // has no record of being this room's host, so we must send
      // `room-recover` on it either way; the server's recover path
      // is idempotent and rebinds on the live socket.
      const client = this.ctx.manager.client;
      if (!client.isConnected()) {
        this.log('tryRecover:client-connect-before', { code });
        await client.connect();
        this.log('tryRecover:client-connect-after', { code });
      }
      this.log('tryRecover:recoverRoom-before', {
        code,
        timeoutMs: RoomRecoveryManager.getRecoverTimeoutMs(),
      });
      await client.recoverRoom(code, RoomRecoveryManager.getRecoverTimeoutMs());

      console.log(`[RoomRecovery] Room ${code} recovered`);
      this.log('tryRecover:success', { code });
      this.recoverAttempt = 0;
      this.ui.setRecoveryStatus(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[RoomRecovery] Recover failed: ${message}`);
      this.log('tryRecover:error', { code, message });

      // Only TERMINAL failure: server explicitly says the room is gone.
      // Anything else (timeouts, dropped sockets) is transient.
      if (message === 'Room expired' || message === 'Room not found') {
        this.log('tryRecover:terminal', { code, message });
        this.stop();
        this.ui.setRecoveryStatus(null);
        this.ui.setMatchmakingStatus('Комната истекла');
        this.callbacks.onRoomTerminated();
        return;
      }

      this.recoverAttempt += 1;
      if (this.recoverAttempt >= RoomRecoveryManager.MAX_RECOVER_ATTEMPTS) {
        console.warn('[RoomRecovery] Gave up after max attempts');
        this.recoverAttempt = 0;
        this.ui.setRecoveryStatus('Не удалось восстановить соединение');
        // Even after giving up we don't redirect — user has explicit
        // "Cancel" on the waiting screen if they want to bail.
        return;
      }
      const delay = Math.min(2_000 * 2 ** (this.recoverAttempt - 1), 30_000);
      this.log('tryRecover:retry-scheduled', {
        code,
        attempt: this.recoverAttempt,
        delayMs: delay,
      });
      this.ui.setRecoveryStatus(
        `Соединение потеряно. Повтор через ${Math.ceil(delay / 1000)}с…`
      );
      this.recoverRetryTimer = setTimeout(() => {
        this.recoverRetryTimer = null;
        void this.tryRecover();
      }, delay);
    } finally {
      this.isRecovering = false;
      if (
        this.pendingRecoverRequested &&
        this.activeRoomCode &&
        !this.recoverRetryTimer
      ) {
        this.log('tryRecover:pending-request-reschedule', {
          activeRoomCode: this.activeRoomCode,
        });
        this.scheduleRecover(RoomRecoveryManager.NETWORK_STABILIZE_DELAY_MS);
      }
    }
  }

  // ── Internal arming/disarming ───────────────────────────────────

  private armVisibilityRecover(): void {
    if (this.visibilityRecoverHandler) return;
    if (typeof document === 'undefined') return;

    const handler = (): void => {
      this.log('visibility/pageshow:event', {
        visibilityState: document.visibilityState,
        activeRoomCode: this.activeRoomCode,
      });
      if (document.visibilityState !== 'visible') return;
      this.scheduleRecover();
    };

    document.addEventListener('visibilitychange', handler);
    // iOS Safari fires `pageshow` more reliably than `visibilitychange`
    // when returning from bfcache.
    window.addEventListener('pageshow', handler);
    this.visibilityRecoverHandler = handler;
    this.log('armVisibilityRecover');
  }

  private disarmVisibilityRecover(): void {
    if (!this.visibilityRecoverHandler) return;
    if (typeof document !== 'undefined') {
      document.removeEventListener(
        'visibilitychange',
        this.visibilityRecoverHandler
      );
      window.removeEventListener('pageshow', this.visibilityRecoverHandler);
    }
    this.visibilityRecoverHandler = null;
    this.log('disarmVisibilityRecover');
  }

  private armPrivateRoomEventHooks(): void {
    if (this.privateRoomEventUnsubs.length > 0) return;
    const client = this.ctx.manager.client;
    this.log('armPrivateRoomEventHooks');

    // Auto-reconnect produced a fresh socket — claim back the room.
    this.privateRoomEventUnsubs.push(
      client.on('connected', () => {
        if (!this.activeRoomCode) return;
        this.log('client.connected:event', {
          activeRoomCode: this.activeRoomCode,
        });
        // Defer through the shared scheduler so a socket reconnect racing
        // with visibility/pageshow does not start duplicate recoveries.
        this.scheduleRecover(RoomRecoveryManager.CONNECTED_RECOVER_DELAY_MS);
      })
    );

    // Mobile networks can drop the transport during the private-room
    // countdown before PhalanxClient reaches `playing`. The generic
    // SocketManager reconnect path intentionally only handles in-game
    // reconnects, so host-side private rooms must proactively recover
    // themselves as soon as this pre-game disconnect is observed.
    this.privateRoomEventUnsubs.push(
      client.on('disconnected', () => {
        if (!this.activeRoomCode) return;
        this.log('client.disconnected:event', {
          activeRoomCode: this.activeRoomCode,
        });
        this.scheduleRecover(RoomRecoveryManager.DISCONNECTED_RECOVER_DELAY_MS);
      })
    );

    this.privateRoomEventUnsubs.push(
      client.on('roomExpired', () => {
        this.log('roomExpired:event', { activeRoomCode: this.activeRoomCode });
        this.stop();
        this.ui.setMatchmakingStatus('Комната истекла');
        this.callbacks.onRoomTerminated();
      })
    );

    this.privateRoomEventUnsubs.push(
      client.on('roomCancelled', () => {
        this.log('roomCancelled:event', { activeRoomCode: this.activeRoomCode });
        this.stop();
      })
    );
  }

  // TODO: consider moving room recovery logic to the engine

  private disarmPrivateRoomEventHooks(): void {
    this.log('disarmPrivateRoomEventHooks', {
      unsubscribeCount: this.privateRoomEventUnsubs.length,
    });
    for (const unsub of this.privateRoomEventUnsubs) unsub();
    this.privateRoomEventUnsubs = [];
    if (this.recoverRetryTimer) {
      clearTimeout(this.recoverRetryTimer);
      this.recoverRetryTimer = null;
    }
    if (this.recoverScheduleTimer) {
      clearTimeout(this.recoverScheduleTimer);
      this.recoverScheduleTimer = null;
    }
  }

  private scheduleRecover(delayMs = 0): void {
    if (!this.activeRoomCode) {
      this.log('scheduleRecover:skip-no-active-room', { delayMs });
      return;
    }
    this.log('scheduleRecover:request', {
      delayMs,
      activeRoomCode: this.activeRoomCode,
      isRecovering: this.isRecovering,
      hasScheduleTimer: this.recoverScheduleTimer !== null,
    });
    this.pendingRecoverRequested = true;
    if (this.isRecovering || this.recoverScheduleTimer) return;

    this.recoverScheduleTimer = setTimeout(() => {
      this.recoverScheduleTimer = null;
      if (!this.pendingRecoverRequested) {
        this.log('scheduleRecover:timer-fired-skip-no-pending');
        return;
      }
      this.log('scheduleRecover:timer-fired', {
        activeRoomCode: this.activeRoomCode,
      });
      void this.tryRecover();
    }, delayMs);
  }

  private async waitForOnlineAndStabilize(): Promise<void> {
    if (!RoomRecoveryManager.isOnline()) {
      this.log('waitForOnlineAndStabilize:offline');
      this.ui.setRecoveryStatus('Ожидание сети…');
      await RoomRecoveryManager.waitForOnlineEvent();
      if (!RoomRecoveryManager.isOnline()) {
        this.log('waitForOnlineAndStabilize:still-offline');
        throw new Error('Network offline');
      }
    }
    this.log('waitForOnlineAndStabilize:delay', {
      delayMs: RoomRecoveryManager.NETWORK_STABILIZE_DELAY_MS,
    });
    await RoomRecoveryManager.delay(
      RoomRecoveryManager.NETWORK_STABILIZE_DELAY_MS,
    );
  }

  private log(message: string, details: Record<string, unknown> = {}): void {
    console.log(`[RoomRecovery][trace] ${message}`, {
      at: new Date().toISOString(),
      activeRoomCode: this.activeRoomCode,
      isRecovering: this.isRecovering,
      pendingRecoverRequested: this.pendingRecoverRequested,
      recoverAttempt: this.recoverAttempt,
      playerId: this.ctx.manager.localPlayerId,
      clientConnected: this.ctx.manager.client.isConnected(),
      clientState: this.ctx.manager.client.getClientState(),
      ...details,
    });
  }

  private static async waitForOnlineEvent(): Promise<void> {
    if (typeof window === 'undefined') return;
    await Promise.race([
      new Promise<void>((resolve) => {
        window.addEventListener('online', () => resolve(), { once: true });
      }),
      RoomRecoveryManager.delay(RoomRecoveryManager.OFFLINE_WAIT_TIMEOUT_MS),
    ]);
  }

  private static isOnline(): boolean {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  }

  private static getRecoverTimeoutMs(): number {
    if (typeof navigator === 'undefined') {
      return RoomRecoveryManager.DEFAULT_RECOVER_TIMEOUT_MS;
    }
    const nav = navigator as NavigatorWithConnection;
    const connection =
      nav.connection ?? nav.mozConnection ?? nav.webkitConnection;

    if (
      connection?.effectiveType === 'slow-2g' ||
      connection?.effectiveType === '2g'
    ) {
      return RoomRecoveryManager.SLOW_RECOVER_TIMEOUT_MS;
    }
    if (typeof connection?.rtt === 'number' && connection.rtt >= 600) {
      return RoomRecoveryManager.SLOW_RECOVER_TIMEOUT_MS;
    }
    if (
      connection?.effectiveType === '3g' ||
      (typeof connection?.rtt === 'number' && connection.rtt >= 300)
    ) {
      return RoomRecoveryManager.DEGRADED_RECOVER_TIMEOUT_MS;
    }
    return RoomRecoveryManager.DEFAULT_RECOVER_TIMEOUT_MS;
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
