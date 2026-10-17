import { afterEach, describe, expect, it } from 'vitest';
import { scheduleOffTick } from '../../src/persistence/scheduleOffTick.js';

interface HostTimers {
  setImmediate?: (callback: () => void) => void;
  requestIdleCallback?: (callback: () => void) => void;
  MessageChannel?: new () => {
    port1: { onmessage: ((event: unknown) => void) | null; close(): void };
    port2: { postMessage(data: null): void; close(): void };
  };
  setTimeout: (callback: () => void, delay?: number) => unknown;
}

function host(): HostTimers {
  return globalThis as unknown as HostTimers;
}

describe('scheduleOffTick', () => {
  const saved = {
    setImmediate: host().setImmediate,
    requestIdleCallback: host().requestIdleCallback,
    MessageChannel: host().MessageChannel,
  };

  afterEach(() => {
    host().setImmediate = saved.setImmediate;
    host().requestIdleCallback = saved.requestIdleCallback;
    host().MessageChannel = saved.MessageChannel;
  });

  it('does not run the digest as a microtask when idle callbacks are missing', async () => {
    host().setImmediate = undefined;
    host().requestIdleCallback = undefined;
    let ran = false;
    const pending = scheduleOffTick(() => {
      ran = true;
    });
    await Promise.resolve();
    expect(ran).toBe(false);
    await pending;
    expect(ran).toBe(true);
  });

  it('uses setTimeout(0) when MessageChannel is also missing', async () => {
    host().setImmediate = undefined;
    host().requestIdleCallback = undefined;
    host().MessageChannel = undefined;
    let ran = false;
    const pending = scheduleOffTick(() => {
      ran = true;
    });
    await Promise.resolve();
    expect(ran).toBe(false);
    await pending;
    expect(ran).toBe(true);
  });
});
