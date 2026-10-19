import { afterEach, describe, expect, it, vi } from 'vitest';
import { wallClock } from '../../src/host/wallClock.js';

describe('wallClock', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when the host has no setInterval', () => {
    vi.stubGlobal('setInterval', undefined);
    expect(() => wallClock()).toThrow('runtime: this host has no wall clock');
  });

  it('throws when the host has no clearInterval', () => {
    vi.stubGlobal('clearInterval', undefined);
    expect(() => wallClock()).toThrow('runtime: this host has no wall clock');
  });
});
