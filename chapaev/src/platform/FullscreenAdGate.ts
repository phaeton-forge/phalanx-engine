const AD_COOLDOWN_MS = 90_000;

/**
 * Shared cooldown policy for fullscreen interstitials.
 * Platform adapters own the SDK call and use this gate to decide when it is allowed.
 */
export class FullscreenAdGate {
  private lastShownAt = 0;

  canShow(): boolean {
    return Date.now() - this.lastShownAt >= AD_COOLDOWN_MS;
  }

  recordShown(): void {
    this.lastShownAt = Date.now();
  }
}
