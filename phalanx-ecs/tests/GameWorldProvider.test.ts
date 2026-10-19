import { describe, expect, it, vi } from 'vitest';
import {
  GameWorld,
  GameWorldEvents,
  type GameWorldConfig,
} from '../src/GameWorld.js';
import { manualTickProvider } from './support/manualTickProvider.js';

describe('GameWorld tick provider', () => {
  it('does not compile without tickFrameProvider', () => {
    // @ts-expect-error tickFrameProvider is required
    const missing: GameWorldConfig = {};
    expect(missing).toEqual({});
  });

  it('start and stop do not start or stop the provider', () => {
    const provider = manualTickProvider();
    const start = vi.fn();
    const stop = vi.fn();
    const probed = Object.assign(provider, { start, stop });
    const world = new GameWorld({ tickFrameProvider: probed });
    world.start();
    world.stop();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    world.dispose();
  });

  it('pause from the provider sets paused and emits PAUSED', () => {
    const provider = manualTickProvider();
    const world = new GameWorld({ tickFrameProvider: provider });
    const paused: string[] = [];
    world.eventBus.on(GameWorldEvents.PAUSED, () => {
      paused.push(GameWorldEvents.PAUSED);
    });
    world.start();
    world.pause();
    expect(world.paused).toBe(true);
    expect(paused).toEqual([GameWorldEvents.PAUSED]);
    world.dispose();
  });
});
