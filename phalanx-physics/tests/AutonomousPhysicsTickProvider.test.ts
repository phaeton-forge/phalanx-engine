import { describe, it, expect, vi } from 'vitest';
import { AutonomousPhysicsTickProvider } from '../src/tick/AutonomousPhysicsTickProvider';

describe('AutonomousPhysicsTickProvider', () => {
  it('stops when isSettled returns true and fires onSettled', async () => {
    let stepCount = 0;
    const onSettled = vi.fn();
    const provider = new AutonomousPhysicsTickProvider({
      isSettled: () => stepCount >= 5,
      onSettled,
    });

    provider.start(() => { stepCount++; });

    // Wait for async execution to complete
    await new Promise<void>((resolve) => {
      const check = () => {
        if (onSettled.mock.calls.length > 0) {
          resolve();
        } else {
          setImmediate(check);
        }
      };
      setImmediate(check);
    });

    expect(stepCount).toBe(5);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('respects maxSteps limit', async () => {
    let stepCount = 0;
    const onSettled = vi.fn();
    const provider = new AutonomousPhysicsTickProvider({
      maxSteps: 10,
      isSettled: () => false, // never settles
      onSettled,
    });

    provider.start(() => { stepCount++; });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (onSettled.mock.calls.length > 0) {
          resolve();
        } else {
          setImmediate(check);
        }
      };
      setImmediate(check);
    });

    expect(stepCount).toBe(10);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('stop() halts mid-run', async () => {
    let stepCount = 0;
    const onSettled = vi.fn();
    const provider = new AutonomousPhysicsTickProvider({
      maxSteps: 1000,
      isSettled: () => false,
      onSettled,
    });

    provider.start(() => {
      stepCount++;
      if (stepCount === 3) {
        provider.stop();
      }
    });

    // Wait a bit for the provider to finish
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stepCount).toBe(3);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('calls onStep on each tick', async () => {
    const onStep = vi.fn();
    let settled = false;
    const onSettled = vi.fn();
    const provider = new AutonomousPhysicsTickProvider({
      maxSteps: 100,
      isSettled: () => {
        if (onStep.mock.calls.length >= 3) settled = true;
        return settled;
      },
      onSettled,
    });

    provider.start(onStep);

    await new Promise<void>((resolve) => {
      const check = () => {
        if (onSettled.mock.calls.length > 0) {
          resolve();
        } else {
          setImmediate(check);
        }
      };
      setImmediate(check);
    });

    expect(onStep).toHaveBeenCalledTimes(3);
  });
});
