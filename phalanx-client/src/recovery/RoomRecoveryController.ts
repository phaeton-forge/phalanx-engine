import {
  armBrowserLifecycle,
  isOnline,
  waitForOnlineEvent,
  type BrowserLifecycleHandle,
} from './BrowserLifecycle.js';
import {
  DEFAULT_RECOVER_TIMEOUT_BUDGET,
  getRecoverTimeoutMs,
  type RecoverTimeoutBudget,
} from './NetworkQuality.js';
import { RoomPersistence } from './RoomPersistence.js';
import type { KeyValueStorage } from './KeyValueStorage.js';
import type {
  PhalanxClientEvents,
  RoomRecoveredEvent,
  Unsubscribe,
} from '../types.js';

/**
 * Slim port describing the subset of `PhalanxClient` that the
 * recovery controller actually drives. Defining it here decouples
 * the controller from the rest of the client surface and keeps unit
 * testing trivial.
 */
export interface RecoveryClientPort {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  recoverRoom(code: string, timeoutMs?: number): Promise<RoomRecoveredEvent>;
  getPlayerId(): string;
  on<K extends keyof PhalanxClientEvents>(
    event: K,
    handler: PhalanxClientEvents[K]
  ): Unsubscribe;
}

/**
 * Phase emitted via `recoveryStatus` so games can render localized
 * strings without re-implementing the state machine.
 */
export type RoomRecoveryPhase =
  | 'idle'
  | 'recovering'
  | 'waiting-network'
  | 'retrying'
  | 'gave-up';

export interface RoomRecoveryStatusEvent {
  phase: RoomRecoveryPhase;
  /** Current attempt number (1-based) when phase is 'recovering' / 'retrying'. */
  attempt?: number;
  /** Delay until the next automatic retry, in ms (only when phase is 'retrying'). */
  nextRetryMs?: number;
}

export interface RoomTerminatedEvent {
  reason: 'expired' | 'not-found' | 'cancelled';
}

export interface RoomRecoveryControllerEvents {
  recoveryStatus: (event: RoomRecoveryStatusEvent) => void;
  roomTerminated: (event: RoomTerminatedEvent) => void;
}

export interface RoomRecoveryConfig {
  /** Storage key for the persisted active-room record. */
  storageKey: string;
  /** Local TTL mirroring server RoomService.ROOM_TTL_MS. */
  roomTtlMs: number;
  /** Storage adapter for the persistence layer. */
  storage?: KeyValueStorage;
  /** Per-quality recover timeouts. */
  recoverTimeoutBudget?: RecoverTimeoutBudget;
  /** Max recover attempts before giving up (still leaves the user on screen). */
  maxRecoverAttempts?: number;
  /**
   * Auto-arm a "pre-game stall" watchdog when tracking starts. If the
   * matchFound→countdown→gameStart sequence stalls longer than
   * `preGameStallMs` we trigger a `forceRecover` to dodge silent
   * mid-flow socket failures.
   * @default true
   */
  preGameStallWatchdog?: boolean;
  /** @default 4500 */
  preGameStallMs?: number;
}

const NETWORK_STABILIZE_DELAY_MS = 300;
const CONNECTED_RECOVER_DELAY_MS = 300;
const DISCONNECTED_RECOVER_DELAY_MS = 300;
const OFFLINE_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RECOVER_ATTEMPTS = 5;
const DEFAULT_PRE_GAME_STALL_MS = 4_500;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Owns the entire mobile-friendly recovery state machine for a single
 * private room: visibility/pageshow/online listeners, socket connect/
 * disconnect hooks, exponential-backoff retry, and the localStorage
 * persistence record. Emits typed status events instead of touching
 * UI directly so each game can render its own strings.
 *
 * Lifecycle:
 *   client.roomRecovery.startTrackingHost(code)  // host created room
 *   client.roomRecovery.trackGuestJoin(code)     // guest is mid-join
 *   client.roomRecovery.resumeTrackingHost(code) // cold-start recover
 *   client.roomRecovery.stop()                   // cancel / match started
 *
 * The pre-game stall watchdog is auto-armed on every matchFound and
 * disarmed on gameStart, so games no longer need their own
 * `armPreGameStallWatchdog` helper.
 */
export class RoomRecoveryController {
  private readonly persistence: RoomPersistence;
  private readonly recoverBudget: RecoverTimeoutBudget;
  private readonly maxRecoverAttempts: number;
  private readonly preGameStallEnabled: boolean;
  private readonly preGameStallMs: number;
  private readonly emit: <K extends keyof RoomRecoveryControllerEvents>(
    event: K,
    ...args: Parameters<RoomRecoveryControllerEvents[K]>
  ) => void;

  private activeRoomCode: string | null = null;
  private isRecovering = false;
  private pendingRecoverRequested = false;
  private pendingForceReconnectRequested = false;
  private recoverAttempt = 0;
  private recoverRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoverScheduleTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleHandle: BrowserLifecycleHandle | null = null;
  private clientEventUnsubs: Unsubscribe[] = [];
  private preGameStallTimer: ReturnType<typeof setTimeout> | null = null;
  private hasGameStartedSinceTracking = false;

  constructor(
    private readonly client: RecoveryClientPort,
    config: RoomRecoveryConfig,
    emit: <K extends keyof RoomRecoveryControllerEvents>(
      event: K,
      ...args: Parameters<RoomRecoveryControllerEvents[K]>
    ) => void
  ) {
    this.persistence = new RoomPersistence({
      storageKey: config.storageKey,
      roomTtlMs: config.roomTtlMs,
      storage: config.storage,
    });
    this.recoverBudget =
      config.recoverTimeoutBudget ?? DEFAULT_RECOVER_TIMEOUT_BUDGET;
    this.maxRecoverAttempts =
      config.maxRecoverAttempts ?? DEFAULT_MAX_RECOVER_ATTEMPTS;
    this.preGameStallEnabled = config.preGameStallWatchdog ?? true;
    this.preGameStallMs = config.preGameStallMs ?? DEFAULT_PRE_GAME_STALL_MS;
    this.emit = emit;
  }

  // ── Public surface ──────────────────────────────────────────────

  hasActiveRoom(): boolean {
    return this.activeRoomCode !== null;
  }

  getActiveRoomCode(): string | null {
    return this.activeRoomCode;
  }

  /**
   * Cold-start recovery: read the persisted host record (mobile killed
   * the tab while the user was in a messenger) and validate it against
   * the current playerId. Returns the code to recover, or null when
   * there's nothing to do (no record, expired, or playerId drift).
   */
  loadColdStartCode(): string | null {
    const persisted = this.persistence.load();
    if (!persisted || persisted.role !== 'host') return null;

    const currentPlayerId = this.client.getPlayerId();
    if (currentPlayerId && currentPlayerId === persisted.playerId) {
      return persisted.code;
    }
    // playerId drift — abandon the stale entry rather than leaving
    // the user staring at a permanently-failing recover attempt.
    this.persistence.clear();
    return null;
  }

  /** Begin tracking `code` as the active host-side room. */
  startTrackingHost(code: string): void {
    this.activeRoomCode = code;
    this.persistence.save({
      code,
      role: 'host',
      playerId: this.client.getPlayerId(),
    });
    this.armHooks();
  }

  /**
   * Variant used by cold-start recover: assumes the persistence record
   * was already written by a previous tab and just rearms the hooks.
   */
  resumeTrackingHost(code: string): void {
    this.activeRoomCode = code;
    this.armHooks();
  }

  /** Persist a guest-side join attempt for cold-start surfacing. */
  trackGuestJoin(code: string): void {
    this.persistence.save({
      code,
      role: 'guest',
      playerId: this.client.getPlayerId(),
    });
  }

  /** Stop all recovery machinery and forget the active room. Idempotent. */
  stop(): void {
    this.disarmHooks();
    this.clearPreGameStallWatchdog();
    this.activeRoomCode = null;
    this.pendingRecoverRequested = false;
    this.pendingForceReconnectRequested = false;
    this.recoverAttempt = 0;
    this.hasGameStartedSinceTracking = false;
    this.persistence.clear();
    this.emit('recoveryStatus', { phase: 'idle' });
  }

  /**
   * Recover through a fresh socket even if Socket.IO still reports the
   * current one as connected. This handles mobile carrier/WebView
   * stalls where server→client packets stop arriving but heartbeat has
   * not fired yet, so the normal `disconnected` hook would be too late.
   */
  forceRecover(reason: string): void {
    if (!this.activeRoomCode) return;
    void reason;
    this.pendingForceReconnectRequested = true;
    this.scheduleRecover(NETWORK_STABILIZE_DELAY_MS);
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
      this.emit('recoveryStatus', {
        phase: 'recovering',
        attempt: this.recoverAttempt + 1,
      });
      await this.waitForOnlineAndStabilize();
      if (this.activeRoomCode !== code) return;

      // NOTE: we deliberately do NOT short-circuit on isConnected().
      // socket.io auto-reconnect can produce a fresh connection while
      // we were backgrounded — that socket has no record of being this
      // room's host, so we must send `room-recover` on it either way.
      // The server's recover path is idempotent and rebinds on the
      // live socket.
      if (forceReconnect && this.client.isConnected()) {
        this.client.disconnect();
        await delay(NETWORK_STABILIZE_DELAY_MS);
      }
      if (!this.client.isConnected()) {
        await this.client.connect();
      }
      await this.client.recoverRoom(code, getRecoverTimeoutMs(this.recoverBudget));

      this.recoverAttempt = 0;
      this.emit('recoveryStatus', { phase: 'idle' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[RoomRecovery] Recover failed: ${message}`);

      // Only TERMINAL failure: server explicitly says the room is gone.
      // Anything else (timeouts, dropped sockets) is transient.
      if (message === 'Room expired' || message === 'Room not found') {
        const reason = message === 'Room expired' ? 'expired' : 'not-found';
        this.stop();
        this.emit('roomTerminated', { reason });
        return;
      }

      this.recoverAttempt += 1;
      if (this.recoverAttempt >= this.maxRecoverAttempts) {
        this.recoverAttempt = 0;
        this.emit('recoveryStatus', { phase: 'gave-up' });
        // Don't redirect — game's UI should still expose a manual cancel.
        return;
      }
      const retryDelay = Math.min(
        2_000 * 2 ** (this.recoverAttempt - 1),
        30_000
      );
      this.emit('recoveryStatus', {
        phase: 'retrying',
        attempt: this.recoverAttempt,
        nextRetryMs: retryDelay,
      });
      this.recoverRetryTimer = setTimeout(() => {
        this.recoverRetryTimer = null;
        void this.tryRecover();
      }, retryDelay);
    } finally {
      this.isRecovering = false;
      if (
        this.pendingRecoverRequested &&
        this.activeRoomCode &&
        !this.recoverRetryTimer
      ) {
        this.scheduleRecover(NETWORK_STABILIZE_DELAY_MS);
      }
    }
  }

  // ── Pre-game stall watchdog ─────────────────────────────────────

  /**
   * Arm a one-shot timer: if `gameStart` doesn't arrive within
   * `preGameStallMs` we proactively `forceRecover` because the most
   * likely explanation is that the host's socket silently died mid-
   * countdown. Auto-armed on `matchFound` / `countdown` events when
   * `preGameStallWatchdog` is enabled — games rarely need to call this
   * directly.
   */
  armPreGameStallWatchdog(reason: string): void {
    if (!this.preGameStallEnabled) return;
    if (this.hasGameStartedSinceTracking) return;
    this.clearPreGameStallWatchdog();
    this.preGameStallTimer = setTimeout(() => {
      this.preGameStallTimer = null;
      if (this.hasGameStartedSinceTracking) return;
      if (!this.activeRoomCode) return;
      this.forceRecover(reason);
    }, this.preGameStallMs);
  }

  clearPreGameStallWatchdog(): void {
    if (!this.preGameStallTimer) return;
    clearTimeout(this.preGameStallTimer);
    this.preGameStallTimer = null;
  }

  // ── Internal arming/disarming ───────────────────────────────────

  private armHooks(): void {
    this.armBrowserLifecycle();
    this.armClientEventHooks();
  }

  private disarmHooks(): void {
    this.lifecycleHandle?.dispose();
    this.lifecycleHandle = null;
    for (const unsub of this.clientEventUnsubs) unsub();
    this.clientEventUnsubs = [];
    if (this.recoverRetryTimer) {
      clearTimeout(this.recoverRetryTimer);
      this.recoverRetryTimer = null;
    }
    if (this.recoverScheduleTimer) {
      clearTimeout(this.recoverScheduleTimer);
      this.recoverScheduleTimer = null;
    }
  }

  private armBrowserLifecycle(): void {
    if (this.lifecycleHandle) return;
    this.lifecycleHandle = armBrowserLifecycle({
      onVisible: () => this.scheduleRecover(),
    });
  }

  private armClientEventHooks(): void {
    if (this.clientEventUnsubs.length > 0) return;

    // Auto-reconnect produced a fresh socket — claim back the room.
    this.clientEventUnsubs.push(
      this.client.on('connected', () => {
        if (!this.activeRoomCode) return;
        this.scheduleRecover(CONNECTED_RECOVER_DELAY_MS);
      })
    );

    // Mobile networks can drop the transport during the private-room
    // countdown before PhalanxClient reaches `playing`. The generic
    // SocketManager reconnect path intentionally only handles in-game
    // reconnects, so private rooms must proactively recover themselves
    // as soon as this pre-game disconnect is observed.
    this.clientEventUnsubs.push(
      this.client.on('disconnected', () => {
        if (!this.activeRoomCode) return;
        this.scheduleRecover(DISCONNECTED_RECOVER_DELAY_MS);
      })
    );

    this.clientEventUnsubs.push(
      this.client.on('roomExpired', () => {
        this.stop();
        this.emit('roomTerminated', { reason: 'expired' });
      })
    );

    this.clientEventUnsubs.push(
      this.client.on('roomCancelled', () => {
        this.stop();
        this.emit('roomTerminated', { reason: 'cancelled' });
      })
    );

    // Pre-game stall watchdog — auto-armed on the events that lead up
    // to `gameStart`, auto-cleared once the game actually starts.
    if (this.preGameStallEnabled) {
      this.clientEventUnsubs.push(
        this.client.on('matchFound', () => {
          this.armPreGameStallWatchdog('game-start missing after match-found');
        })
      );
      this.clientEventUnsubs.push(
        this.client.on('countdown', (event) => {
          if (event.seconds > 0) {
            this.armPreGameStallWatchdog(
              `countdown stalled after ${event.seconds}`
            );
          }
        })
      );
      this.clientEventUnsubs.push(
        this.client.on('gameStart', () => {
          this.hasGameStartedSinceTracking = true;
          this.clearPreGameStallWatchdog();
        })
      );
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
    if (!isOnline()) {
      this.emit('recoveryStatus', { phase: 'waiting-network' });
      await waitForOnlineEvent(OFFLINE_WAIT_TIMEOUT_MS);
      if (!isOnline()) {
        throw new Error('Network offline');
      }
    }
    await delay(NETWORK_STABILIZE_DELAY_MS);
  }
}

