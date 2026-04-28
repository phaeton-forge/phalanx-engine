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
  private pendingForceReconnectRequested = false;
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
    if (!persisted || persisted.role !== 'host') return null;

    const currentPlayerId = this.ctx.manager.localPlayerId;
    if (currentPlayerId && currentPlayerId === persisted.playerId) {
      return persisted.code;
    }
    // playerId mismatch — abandon the stale entry rather than letting
    // the user stare at a permanently-failing waiting screen.
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
    this.armPrivateRoomEventHooks();
    this.armVisibilityRecover();
  }

  /** Persist a guest-side join attempt for cold-start surface. */
  trackGuestJoin(code: string): void {
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
    this.disarmVisibilityRecover();
    this.disarmPrivateRoomEventHooks();
    this.activeRoomCode = null;
    this.pendingRecoverRequested = false;
    this.pendingForceReconnectRequested = false;
    this.recoverAttempt = 0;
    clearActiveRoom();
  }

  /**
   * Recover through a fresh socket even if Socket.IO still reports the
   * current one as connected. This handles mobile carrier/WebView stalls
   * where server→client packets stop arriving but heartbeat timeout has not
   * fired yet, so the normal `disconnected` hook would be too late.
   */
  forceRecover(reason: string): void {
    if (!this.activeRoomCode) return;
    void reason;
    this.pendingForceReconnectRequested = true;
    this.scheduleRecover(RoomRecoveryManager.NETWORK_STABILIZE_DELAY_MS);
  }

  /**
   * Attempt one recovery cycle. Idempotent against concurrent calls
   * (the visibility and `connected` hooks may fire near-simultaneously
   * on mobile). Schedules its own backoff retry on transient failure.
   */
  async tryRecover(): Promise<void> {
    const code = this.activeRoomCode;
    if (!code) return;
    if (this.isRecovering) {
      this.pendingRecoverRequested = true;
      return;
    }

    this.isRecovering = true;
    const forceReconnect = this.pendingForceReconnectRequested;
    this.pendingRecoverRequested = false;
    this.pendingForceReconnectRequested = false;
    if (this.recoverRetryTimer) {
      clearTimeout(this.recoverRetryTimer);
      this.recoverRetryTimer = null;
    }

    try {
      console.log(
        `[RoomRecovery] Attempting to recover room ${code} (attempt ${this.recoverAttempt + 1})`
      );
      this.ui.setRecoveryStatus('Восстановление подключения…');
      await this.waitForOnlineAndStabilize();
      if (this.activeRoomCode !== code) return;

      // NOTE: we deliberately do NOT short-circuit on
      // `client.isConnected()`. socket.io auto-reconnect can produce
      // a fresh connection while we were backgrounded — that socket
      // has no record of being this room's host, so we must send
      // `room-recover` on it either way; the server's recover path
      // is idempotent and rebinds on the live socket.
      const client = this.ctx.manager.client;
      if (forceReconnect && client.isConnected()) {
        client.disconnect();
        await RoomRecoveryManager.delay(
          RoomRecoveryManager.NETWORK_STABILIZE_DELAY_MS,
        );
      }
      if (!client.isConnected()) {
        await client.connect();
      }
      await client.recoverRoom(code, RoomRecoveryManager.getRecoverTimeoutMs());

      console.log(`[RoomRecovery] Room ${code} recovered`);
      this.recoverAttempt = 0;
      this.ui.setRecoveryStatus(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[RoomRecovery] Recover failed: ${message}`);

      // Only TERMINAL failure: server explicitly says the room is gone.
      // Anything else (timeouts, dropped sockets) is transient.
      if (message === 'Room expired' || message === 'Room not found') {
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
        this.scheduleRecover(RoomRecoveryManager.NETWORK_STABILIZE_DELAY_MS);
      }
    }
  }

  // ── Internal arming/disarming ───────────────────────────────────

  private armVisibilityRecover(): void {
    if (this.visibilityRecoverHandler) return;
    if (typeof document === 'undefined') return;

    const handler = (): void => {
      if (document.visibilityState !== 'visible') return;
      this.scheduleRecover();
    };

    document.addEventListener('visibilitychange', handler);
    // iOS Safari fires `pageshow` more reliably than `visibilitychange`
    // when returning from bfcache.
    window.addEventListener('pageshow', handler);
    this.visibilityRecoverHandler = handler;
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
  }

  private armPrivateRoomEventHooks(): void {
    if (this.privateRoomEventUnsubs.length > 0) return;
    const client = this.ctx.manager.client;

    // Auto-reconnect produced a fresh socket — claim back the room.
    this.privateRoomEventUnsubs.push(
      client.on('connected', () => {
        if (!this.activeRoomCode) return;
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
        this.scheduleRecover(RoomRecoveryManager.DISCONNECTED_RECOVER_DELAY_MS);
      })
    );

    this.privateRoomEventUnsubs.push(
      client.on('roomExpired', () => {
        this.stop();
        this.ui.setMatchmakingStatus('Комната истекла');
        this.callbacks.onRoomTerminated();
      })
    );

    this.privateRoomEventUnsubs.push(
      client.on('roomCancelled', () => {
        this.stop();
      })
    );
  }

  // TODO: consider moving room recovery logic to the engine

  private disarmPrivateRoomEventHooks(): void {
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
    if (!this.activeRoomCode) return;
    this.pendingRecoverRequested = true;
    if (this.isRecovering || this.recoverScheduleTimer) return;

    this.recoverScheduleTimer = setTimeout(() => {
      this.recoverScheduleTimer = null;
      if (!this.pendingRecoverRequested) return;
      void this.tryRecover();
    }, delayMs);
  }

  private async waitForOnlineAndStabilize(): Promise<void> {
    if (!RoomRecoveryManager.isOnline()) {
      this.ui.setRecoveryStatus('Ожидание сети…');
      await RoomRecoveryManager.waitForOnlineEvent();
      if (!RoomRecoveryManager.isOnline()) {
        throw new Error('Network offline');
      }
    }
    await RoomRecoveryManager.delay(
      RoomRecoveryManager.NETWORK_STABILIZE_DELAY_MS,
    );
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

