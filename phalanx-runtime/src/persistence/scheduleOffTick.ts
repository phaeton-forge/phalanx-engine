/**
 * Run `work` after the current turn. Node uses `setImmediate`. Browsers
 * use `requestIdleCallback` (timed out so a busy page still encodes).
 * Anything else falls back to a microtask. The returned promise settles
 * when `work` finishes. Callers on the tick path must not await it.
 */
export function scheduleOffTick(work: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const run = (): void => {
      try {
        work();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const host: unknown = globalThis;
    if (isRecord(host)) {
      const immediate = host['setImmediate'];
      if (isCallback(immediate)) {
        immediate(run);
        return;
      }
      const idle = host['requestIdleCallback'];
      if (isIdleCallback(idle)) {
        idle(run, { timeout: 50 });
        return;
      }
    }
    queueMicrotask(run);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCallback(value: unknown): value is (callback: () => void) => void {
  return typeof value === 'function';
}

function isIdleCallback(
  value: unknown
): value is (callback: () => void, options: { timeout: number }) => void {
  return typeof value === 'function';
}
