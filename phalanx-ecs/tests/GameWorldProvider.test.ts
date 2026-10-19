import { describe, expect, it, vi } from 'vitest';
import { GameWorld, type GameWorldConfig } from '../src/GameWorld.js';
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
});
