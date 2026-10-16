import { describe, expect, it } from 'vitest';
import { LocalTransport } from '../../src/transport/LocalTransport.js';

describe('LocalTransport', () => {
  it('delivers a bound submit on its target tick under the player id', () => {
    const transport = LocalTransport.manual();
    transport.bindSlots([{ slot: 0, playerId: 'local:0' }]);
    transport.submit(1, 0, [
      { type: 'spawn', data: { q: 0, p: { type: 'spawn', x: '3' } } },
    ]);
    const seen: string[] = [];
    transport.onTick((tick, batch) => {
      const commands = batch.commands['local:0'];
      seen.push(`${String(tick)}:${String(commands?.length ?? 0)}`);
    });
    transport.step(2);
    expect(seen).toEqual(['0:0', '1:1']);
    transport.dispose();
  });

  it('refuses step on a timed transport and a submit for a past tick', () => {
    const timed = new LocalTransport({ tickRate: 10 });
    expect(() => timed.step()).toThrow(/manual/);
    timed.dispose();

    const transport = LocalTransport.manual();
    transport.bindSlots([{ slot: 0, playerId: 'local:0' }]);
    transport.seek(4);
    expect(() =>
      transport.submit(3, 0, [{ type: 'move', data: { q: 0, p: null } }])
    ).toThrow(/already past/);
    expect(() =>
      transport.submit(4, 1, [{ type: 'move', data: { q: 0, p: null } }])
    ).toThrow(/not bound/);
    transport.dispose();
  });

  it('rejects a submit past maxAheadTicks', () => {
    const transport = LocalTransport.manual();
    transport.bindSlots([{ slot: 0, playerId: 'local:0' }]);
    const command = {
      type: 'move',
      data: { q: 0, p: null },
    } as const;
    transport.submit(8, 0, [command]);
    expect(() => transport.submit(9, 0, [command])).toThrow(/more than 8/);
    const tight = new LocalTransport({ tickRate: 10, maxAheadTicks: 1 });
    tight.bindSlots([{ slot: 0, playerId: 'local:0' }]);
    tight.submit(1, 0, [command]);
    expect(() => tight.submit(2, 0, [command])).toThrow(/more than 1/);
    tight.dispose();
    transport.dispose();
  });

  it('schedules the next timer for the remaining tick, not 0ms', () => {
    const transport = new LocalTransport({ tickRate: 10 });
    const delays: number[] = [];
    const host = globalThis as unknown as {
      setTimeout: (handler: () => void, timeout?: number) => unknown;
    };
    const original = host.setTimeout;
    host.setTimeout = (_handler, timeout) => {
      delays.push(timeout ?? 0);
      return 0;
    };
    try {
      transport.start();
    } finally {
      host.setTimeout = original;
      transport.stop();
    }
    expect(delays[0]).toBe(100);
  });

  it('keeps __proto__ and constructor as own command keys', () => {
    const transport = LocalTransport.manual();
    transport.bindSlots([
      { slot: 0, playerId: '__proto__' },
      { slot: 1, playerId: 'constructor' },
    ]);
    transport.submit(0, 0, [{ type: 'a', data: { q: 0, p: null } }]);
    transport.submit(0, 1, [{ type: 'b', data: { q: 0, p: null } }]);
    transport.onTick((_tick, batch) => {
      expect(Object.getPrototypeOf(batch.commands)).toBeNull();
      expect(Object.hasOwn(batch.commands, '__proto__')).toBe(true);
      expect(Object.hasOwn(batch.commands, 'constructor')).toBe(true);
      expect(
        batch.commands['__proto__']?.map((command) => command.type)
      ).toEqual(['a']);
      expect(
        batch.commands['constructor']?.map((command) => command.type)
      ).toEqual(['b']);
    });
    transport.step(1);
    transport.dispose();
  });

  it('rechecks pause between ticks of one timer callback', () => {
    let nowMs = 0;
    const host = globalThis as unknown as {
      setTimeout: (handler: () => void, timeout?: number) => unknown;
      clearTimeout: (handle: unknown) => void;
      performance: { now(): number };
    };
    const originalTimeout = host.setTimeout;
    const originalClear = host.clearTimeout;
    const originalNow = host.performance.now.bind(host.performance);
    const captured: { run: (() => void) | null } = { run: null };
    host.setTimeout = (handler) => {
      captured.run = handler;
      return 1;
    };
    host.clearTimeout = () => {
      captured.run = null;
    };
    host.performance.now = () => nowMs;
    const transport = new LocalTransport({ tickRate: 10, maxFrameTime: 1 });
    const ticks: number[] = [];
    let frames = 0;
    transport.onTick((tick) => {
      ticks.push(tick);
      if (ticks.length === 1) transport.requestPause();
    });
    transport.onFrame(() => {
      frames += 1;
    });
    try {
      transport.start();
      nowMs = 350;
      const fire = captured.run;
      captured.run = null;
      if (fire) fire();
    } finally {
      host.setTimeout = originalTimeout;
      host.clearTimeout = originalClear;
      host.performance.now = originalNow;
      transport.dispose();
    }
    expect(ticks).toEqual([0]);
    expect(frames).toBe(0);
  });

  it('pause blocks step until resume', () => {
    const transport = LocalTransport.manual();
    const ticks: number[] = [];
    transport.onTick((tick) => {
      ticks.push(tick);
    });
    transport.step(1);
    transport.requestPause();
    transport.step(3);
    expect(ticks).toEqual([0]);
    transport.requestResume();
    transport.step(1);
    expect(ticks).toEqual([0, 1]);
    transport.dispose();
  });
});
