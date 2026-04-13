import { describe, it, expect, vi } from 'vitest';
import { ExternalPhysicsTickProvider } from '../src/tick/ExternalPhysicsTickProvider';

describe('ExternalPhysicsTickProvider', () => {
  it('tick() calls onStep', () => {
    const provider = new ExternalPhysicsTickProvider();
    const onStep = vi.fn();

    provider.start(onStep);
    provider.tick();

    expect(onStep).toHaveBeenCalledOnce();
  });

  it('stop() detaches handler — tick() becomes a no-op', () => {
    const provider = new ExternalPhysicsTickProvider();
    const onStep = vi.fn();

    provider.start(onStep);
    provider.stop();
    provider.tick();

    expect(onStep).not.toHaveBeenCalled();
  });

  it('multiple tick() calls work', () => {
    const provider = new ExternalPhysicsTickProvider();
    const onStep = vi.fn();

    provider.start(onStep);
    provider.tick();
    provider.tick();
    provider.tick();

    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it('tick() before start() is a no-op', () => {
    const provider = new ExternalPhysicsTickProvider();
    // Should not throw
    provider.tick();
  });

  it('can restart after stop', () => {
    const provider = new ExternalPhysicsTickProvider();
    const onStep1 = vi.fn();
    const onStep2 = vi.fn();

    provider.start(onStep1);
    provider.tick();
    provider.stop();

    provider.start(onStep2);
    provider.tick();

    expect(onStep1).toHaveBeenCalledOnce();
    expect(onStep2).toHaveBeenCalledOnce();
  });
});
