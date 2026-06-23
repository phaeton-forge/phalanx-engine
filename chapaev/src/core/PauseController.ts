import type { GamePausedEvent, GameResumedEvent } from '@phalanx-engine/client';
import type { NetworkContext } from '../network/NetworkContext.ts';
import type { UIManager } from '../ui/UIManager.ts';
import type { PauseOverlay } from '../ui/screens/PauseOverlay.ts';
import type { FlickInputSystem } from '../systems';

/**
 * Drives the in-match pause overlay. The actual pause/resume decision
 * is server-authoritative — we just route requests and reflect the
 * broadcast state on both clients.
 */
export class PauseController {
  private isPausedFlag = false;
  private flickInputSystem: FlickInputSystem | null = null;

  constructor(
    private readonly ctx: NetworkContext,
    private readonly uiManager: UIManager,
    private readonly pauseOverlay: PauseOverlay
  ) {}

  setFlickInputSystem(system: FlickInputSystem | null): void {
    this.flickInputSystem = system;
  }

  isPaused(): boolean {
    return this.isPausedFlag;
  }

  /** User pressed pause button. Server will broadcast `gamePaused`. */
  requestPause(): void {
    if (this.isPausedFlag) return;
    this.ctx.manager.client.pauseGame();
  }

  /** User pressed resume in the overlay. Server will broadcast `gameResumed`. */
  requestResume(): void {
    this.ctx.manager.client.resumeGame();
  }

  handleNetworkPause(event: GamePausedEvent): void {
    this.isPausedFlag = true;

    if (this.flickInputSystem) {
      this.flickInputSystem.cancelDrag();
      this.flickInputSystem.enabled = false;
    }

    // Only the original pauser may resume.
    const localPlayerId = this.ctx.manager.client.getPlayerId();
    this.pauseOverlay.setCanResume(event.requestedBy === localPlayerId);

    this.uiManager.destroyScreen('pause');
    this.uiManager.showOverlay('pause');
  }

  handleNetworkResume(_event: GameResumedEvent): void {
    this.isPausedFlag = false;
    if (this.flickInputSystem) {
      this.flickInputSystem.enabled = true;
    }
    this.uiManager.hideScreen('pause');
  }

  reset(): void {
    this.isPausedFlag = false;
    this.flickInputSystem = null;
  }
}
