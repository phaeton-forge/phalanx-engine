import { afterEach, describe, expect, it, vi } from 'vitest';
import { TickFrameManager } from '../../src/host/TickFrameManager.js';

interface FrameClock {
  seconds: number;
  pending: { id: number; cb: (time: number) => void }[];
  cancelCount: number;
}

function installClock(withAnimationFrame: boolean): FrameClock {
  const clock: FrameClock = {
    seconds: 0,
    pending: [],
    cancelCount: 0,
  };
  let nextId = 1;
  vi.stubGlobal('setTimeout', () => 0);
  vi.stubGlobal('clearTimeout', () => {});
  vi.stubGlobal('setInterval', () => 0);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('performance', { now: () => clock.seconds * 1000 });
  if (withAnimationFrame) {
    vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
      const id = nextId;
      nextId += 1;
      clock.pending.push({ id, cb });
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      clock.cancelCount += 1;
      clock.pending = clock.pending.filter((frame) => frame.id !== handle);
    });
  } else {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
  }
  return clock;
}

function flush(clock: FrameClock, advanceSeconds: number): void {
  clock.seconds += advanceSeconds;
  const frame = clock.pending.shift();
  frame?.cb(clock.seconds * 1000);
}

describe('TickFrameManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('imports in a host without a DOM', async () => {
    const loaded = await import('../../src/host/TickFrameManager.js');
    expect(loaded.TickFrameManager).toBeTypeOf('function');
  });

  it('runs 60 ticks in one second at tickRate 60', () => {
    const clock = installClock(true);
    const manager = new TickFrameManager({ tickRate: 60, maxFrameTime: 1 });
    const ticks: number[] = [];
    manager.onTick((tick) => {
      ticks.push(tick);
    });
    manager.start();
    expect(ticks).toEqual([]);
    for (let frame = 0; frame < 60; frame += 1) {
      flush(clock, 1 / 60);
    }
    expect(ticks).toHaveLength(60);
    expect(ticks[0]).toBe(0);
    expect(ticks[59]).toBe(59);
    manager.dispose();
  });

  it('clamps a 1 second frame to floor(0.25 * 60) ticks', () => {
    const clock = installClock(true);
    const manager = new TickFrameManager({ tickRate: 60 });
    let count = 0;
    manager.onTick(() => {
      count += 1;
    });
    manager.start();
    flush(clock, 1);
    expect(count).toBe(Math.floor(0.25 * 60));
    manager.dispose();
  });

  it('sets alpha to the remainder divided by the tick duration', () => {
    const clock = installClock(true);
    const manager = new TickFrameManager({ tickRate: 60, maxFrameTime: 1 });
    const frames: number[] = [];
    manager.onFrame((alpha) => {
      frames.push(alpha);
    });
    manager.start();
    frames.length = 0;
    flush(clock, 0.02);
    const tickDuration = 1 / 60;
    const frameTime = 0.02;
    const tickCount = Math.floor(frameTime / tickDuration);
    const remainder = frameTime - tickCount * tickDuration;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBeCloseTo(remainder / tickDuration);
    manager.dispose();
  });

  it('stop cancels the scheduled frame', () => {
    const clock = installClock(true);
    const manager = new TickFrameManager({ tickRate: 60 });
    let frames = 0;
    manager.onFrame(() => {
      frames += 1;
    });
    manager.start();
    const framesAfterStart = frames;
    expect(clock.pending).toHaveLength(1);
    manager.stop();
    expect(clock.cancelCount).toBe(1);
    flush(clock, 1);
    expect(frames).toBe(framesAfterStart);
    manager.dispose();
  });

  it('requestPause notifies subscribers and stops the loop', () => {
    const clock = installClock(true);
    const manager = new TickFrameManager({ tickRate: 60, maxFrameTime: 1 });
    const paused = vi.fn();
    manager.onPause(paused);
    let ticks = 0;
    manager.onTick(() => {
      ticks += 1;
    });
    manager.start();
    manager.requestPause();
    expect(paused).toHaveBeenCalledTimes(1);
    flush(clock, 1);
    expect(ticks).toBe(0);
    expect(manager.isActive()).toBe(false);
    manager.dispose();
  });

  it('requestResume notifies subscribers and runs again', () => {
    const clock = installClock(true);
    const manager = new TickFrameManager({ tickRate: 60, maxFrameTime: 1 });
    const resumed = vi.fn();
    manager.onResume(resumed);
    let ticks = 0;
    manager.onTick(() => {
      ticks += 1;
    });
    manager.start();
    manager.requestPause();
    manager.requestResume();
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(manager.isActive()).toBe(true);
    for (let frame = 0; frame < 60; frame += 1) {
      flush(clock, 1 / 60);
    }
    expect(ticks).toBe(60);
    manager.dispose();
  });

  it('throws when the host has no requestAnimationFrame', () => {
    installClock(false);
    const manager = new TickFrameManager();
    expect(() => manager.start()).toThrow(
      'TickFrameManager: this host has no requestAnimationFrame'
    );
    expect(manager.isActive()).toBe(false);
  });
});
