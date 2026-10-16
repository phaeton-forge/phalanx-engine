/**
 * Wall-clock access for the local transport timer and fast-forward budgets.
 * The package `lib` is ES2022, which has neither DOM nor Node timer types.
 * These calls never feed the simulation.
 */

export interface MessagePortPair {
  port1: {
    onmessage: ((event: unknown) => void) | null;
    close(): void;
  };
  port2: {
    postMessage(data: null): void;
    close(): void;
  };
}

export interface WallClock {
  setTimeout(handler: () => void, timeout?: number): unknown;
  clearTimeout(handle: unknown): void;
  performance: { now(): number };
  MessageChannel?: new () => MessagePortPair;
}

/** The process wall clock, or a throw when this host has none. */
export function wallClock(): WallClock {
  const host: unknown = globalThis;
  if (!isWallClock(host)) {
    throw new Error('runtime: this host has no wall clock');
  }
  return host;
}

function isWallClock(value: unknown): value is WallClock {
  if (typeof value !== 'object' || value === null) return false;
  if (!('setTimeout' in value) || typeof value.setTimeout !== 'function') {
    return false;
  }
  if (!('clearTimeout' in value) || typeof value.clearTimeout !== 'function') {
    return false;
  }
  if (
    !('performance' in value) ||
    typeof value.performance !== 'object' ||
    value.performance === null ||
    !('now' in value.performance) ||
    typeof value.performance.now !== 'function'
  ) {
    return false;
  }
  if (
    'MessageChannel' in value &&
    value.MessageChannel !== undefined &&
    typeof value.MessageChannel !== 'function'
  ) {
    return false;
  }
  return true;
}
