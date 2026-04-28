/**
 * BrowserLifecycle — wires the small bag of DOM listeners every
 * mobile-friendly recovery flow needs:
 *
 *  - `visibilitychange` — fires when the user returns to the tab from
 *    another app or another tab (most reliable signal on Android).
 *  - `pageshow` — fires when iOS Safari restores the page from
 *    bfcache (in some cases `visibilitychange` does not fire).
 *  - `online`  — the OS reports the network came back; useful for the
 *    "wait for network to stabilize" portion of recovery.
 *
 * Idempotent and SSR-safe (no-ops when `document`/`window` are
 * unavailable). Returned object exposes `dispose()` for clean unwiring.
 */
export interface BrowserLifecycleHandle {
  dispose(): void;
}

export interface BrowserLifecycleHandlers {
  /** Called on visibilitychange→visible and on pageshow. */
  onVisible?: () => void;
  /** Called on `window` `online` event. */
  onOnline?: () => void;
}

export function armBrowserLifecycle(
  handlers: BrowserLifecycleHandlers
): BrowserLifecycleHandle {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { dispose: (): void => {} };
  }

  const visibilityHandler = (): void => {
    if (document.visibilityState !== 'visible') return;
    handlers.onVisible?.();
  };
  const pageShowHandler = (): void => {
    handlers.onVisible?.();
  };
  const onlineHandler = (): void => {
    handlers.onOnline?.();
  };

  if (handlers.onVisible) {
    document.addEventListener('visibilitychange', visibilityHandler);
    window.addEventListener('pageshow', pageShowHandler);
  }
  if (handlers.onOnline) {
    window.addEventListener('online', onlineHandler);
  }

  return {
    dispose(): void {
      if (handlers.onVisible) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        window.removeEventListener('pageshow', pageShowHandler);
      }
      if (handlers.onOnline) {
        window.removeEventListener('online', onlineHandler);
      }
    },
  };
}

/** True if the OS reports the device is currently online. */
export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/**
 * Resolve when the next `online` event fires, or after `timeoutMs`,
 * whichever comes first. Used to gate recovery attempts behind a fresh
 * network signal so we don't burn retries while the radio is still off.
 */
export function waitForOnlineEvent(timeoutMs: number): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onOnline = (): void => {
      window.removeEventListener('online', onOnline);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      window.removeEventListener('online', onOnline);
      resolve();
    }, timeoutMs);
    window.addEventListener('online', onOnline);
  });
}

