import type {
  RoomRecoveryController,
  RoomRecoveryStatusEvent,
  RoomTerminatedEvent,
  Unsubscribe,
} from '@phalanx-engine/client';
import type { NetworkContext } from './NetworkContext.ts';
import { t } from '../i18n/i18n.ts';

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
 * Thin adapter around the engine's `RoomRecoveryController`.
 *
 * The state machine, browser-lifecycle wiring, persistence, and
 * pre-game stall watchdog all live in `phalanx-client` now — this
 * class only:
 *  1. forwards control calls (`startTrackingHostRoom` / `stop` / …)
 *     to the engine controller, looked up via
 *     `ctx.manager.client.roomRecovery` each time so a fresh
 *     `NetworkManager` after a `replace()` is transparently re-bound;
 *  2. translates engine `recoveryStatus` / `roomTerminated` events
 *     into the Russian UI strings the Chapayev waiting screen renders.
 */
export class RoomRecoveryManager {
  private eventUnsubs: Unsubscribe[] = [];
  private boundController: RoomRecoveryController | null = null;

  constructor(
    private readonly ctx: NetworkContext,
    private readonly ui: RecoveryUI,
    private readonly callbacks: RecoveryCallbacks
  ) {
    this.bindCurrentClient();
    // Re-bind whenever NetworkContext.replace() swaps in a fresh client
    // (cancel → main-menu cycle).
    this.ctx.onReplace(() => this.bindCurrentClient());
  }

  hasActiveRoom(): boolean {
    return this.controller()?.hasActiveRoom() ?? false;
  }

  getActiveRoomCode(): string | null {
    return this.controller()?.getActiveRoomCode() ?? null;
  }

  loadColdStartCode(): string | null {
    return this.controller()?.loadColdStartCode() ?? null;
  }

  startTrackingHostRoom(code: string): void {
    this.bindCurrentClient();
    this.controller()?.startTrackingHost(code);
  }

  resumeTrackingHostRoom(code: string): void {
    this.bindCurrentClient();
    this.controller()?.resumeTrackingHost(code);
  }

  trackGuestJoin(code: string): void {
    this.controller()?.trackGuestJoin(code);
  }

  stop(): void {
    this.controller()?.stop();
  }

  forceRecover(reason: string): void {
    this.controller()?.forceRecover(reason);
  }

  async tryRecover(): Promise<void> {
    await this.controller()?.tryRecover();
  }

  /** Re-bind to the current client's controller after a NetworkContext.replace(). */
  rebind(): void {
    this.bindCurrentClient();
  }

  private controller(): RoomRecoveryController | null {
    return this.ctx.manager.client.roomRecovery;
  }

  private bindCurrentClient(): void {
    const controller = this.controller();
    if (!controller || controller === this.boundController) return;

    for (const unsub of this.eventUnsubs) unsub();
    this.eventUnsubs = [];

    const client = this.ctx.manager.client;
    this.eventUnsubs.push(
      client.on('recoveryStatus', (event: RoomRecoveryStatusEvent) => {
        this.ui.setRecoveryStatus(this.formatRecoveryStatus(event));
      })
    );
    this.eventUnsubs.push(
      client.on('roomTerminated', (event: RoomTerminatedEvent) => {
        if (event.reason === 'cancelled') return; // silent — game cancels itself
        this.ui.setRecoveryStatus(null);
        this.ui.setMatchmakingStatus(t('recovery.roomExpired'));
        this.callbacks.onRoomTerminated();
      })
    );
    this.boundController = controller;
  }

  private formatRecoveryStatus(event: RoomRecoveryStatusEvent): string | null {
    switch (event.phase) {
      case 'idle':
        return null;
      case 'waiting-network':
        return t('recovery.waitingNetwork');
      case 'recovering':
        return t('recovery.restoring');
      case 'retrying': {
        const seconds = Math.ceil((event.nextRetryMs ?? 0) / 1000);
        return t('recovery.retrying', { seconds });
      }
      case 'gave-up':
        return t('recovery.gaveUp');
    }
  }
}

