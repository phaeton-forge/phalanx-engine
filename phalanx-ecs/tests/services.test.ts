import { describe, expect, it } from 'vitest';
import { GameSystem, GameWorld, defineService } from '../src/index.js';
import type { SystemContext } from '../src/index.js';
import { manualTickProvider } from './support/manualTickProvider.js';

interface Clock {
  readonly now: number;
}

const ClockService = defineService<Clock>('clock');

function world(): GameWorld {
  return new GameWorld({ tickFrameProvider: manualTickProvider() });
}

class ClockReader extends GameSystem {
  public seen: Clock | undefined;

  public override init(context: SystemContext): void {
    super.init(context);
    this.seen = context.getService(ClockService);
  }
}

describe('world services', () => {
  it('returns the provided implementation by key', () => {
    const game = world();
    const clock: Clock = { now: 3 };
    game.provide(ClockService, clock);

    const reader = new ClockReader();
    game.addSystem(reader, { phase: 'late' });

    expect(reader.seen).toBe(clock);
    expect(game.context.tryGetService(ClockService)).toBe(clock);
    expect(game.context.serviceNames()).toEqual(['clock']);
  });

  it('keeps services per world', () => {
    const first = world();
    const second = world();
    first.provide(ClockService, { now: 1 });

    expect(second.context.tryGetService(ClockService)).toBeUndefined();
  });

  it('returns undefined from tryGetService when absent', () => {
    expect(world().context.tryGetService(ClockService)).toBeUndefined();
  });

  it('throws on a second provide of the same key', () => {
    const game = world();
    game.provide(ClockService, { now: 1 });

    expect(() => game.provide(ClockService, { now: 2 })).toThrow(
      "provide: service 'clock' is already provided"
    );
  });

  it('throws when another key with the same name is provided', () => {
    const game = world();
    game.provide(ClockService, { now: 1 });
    const duplicate = defineService<Clock>('clock');

    expect(() => game.provide(duplicate, { now: 2 })).toThrow(
      /another service key named 'clock'.*two copies of the package/
    );
  });

  it('names the missing service and the provided ones', () => {
    const game = world();
    game.provide(ClockService, { now: 1 });
    game.provide(defineService<object>('audio'), {});
    const missing = defineService<object>('physics');

    expect(() => game.context.getService(missing)).toThrow(
      "getService: service 'physics' is not provided; provided: clock, audio"
    );
    expect(() => world().context.getService(missing)).toThrow(
      "getService: service 'physics' is not provided; provided: (none)"
    );
  });
});
