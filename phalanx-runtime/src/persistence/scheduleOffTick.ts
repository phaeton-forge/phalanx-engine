import type { MessagePortPair } from '../host/wallClock.js';

/**
 * Run `work` after the current turn, and not in the same frame.
 *
 * Node uses `setImmediate`. Browsers use `requestIdleCallback` (timed out
 * so a busy page still encodes). Safari has neither `setImmediate` nor
 * `requestIdleCallback`; a microtask would run the digest before paint, so
 * the fallback is `MessageChannel`, then `setTimeout(0)`. `queueMicrotask`
 * is only used when this host has none of those.
 *
 * The returned promise settles when `work` finishes. Callers on the tick
 * path must not await it.
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
      const Channel = host['MessageChannel'];
      if (isMessageChannelCtor(Channel)) {
        const channel = new Channel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          run();
        };
        channel.port2.postMessage(null);
        return;
      }
      const timeout = host['setTimeout'];
      if (isTimeout(timeout)) {
        timeout(run, 0);
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

function isMessageChannelCtor(
  value: unknown
): value is new () => MessagePortPair {
  return typeof value === 'function';
}

function isTimeout(
  value: unknown
): value is (callback: () => void, delay: number) => void {
  return typeof value === 'function';
}
