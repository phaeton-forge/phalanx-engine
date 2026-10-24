import { describe, expect, it } from 'vitest';
import { GameSystem, GameWorld, SystemRegistry } from '../src/index.js';
import { manualTickProvider } from './support/manualTickProvider.js';

class Named extends GameSystem {
  public constructor(
    public override readonly name: string,
    private readonly log: string[]
  ) {
    super();
  }

  public override processTick(): void {
    this.log.push(this.name);
  }

  public override update(): void {
    this.log.push(this.name);
  }
}

function world(): GameWorld {
  return new GameWorld({ tickFrameProvider: manualTickProvider() });
}

describe('system phases', () => {
  it('runs tick phases in order, and registration order inside a phase', () => {
    const log: string[] = [];
    const game = world();
    game.addSystem(new Named('late', log), { phase: 'late' });
    game.addSystem(new Named('input-b', log), { phase: 'input' });
    game.addSystem(new Named('physics', log), { phase: 'physics' });
    game.addSystem(new Named('input-a', log), { phase: 'input' });
    game.addSystem(new Named('abilities', log), { phase: 'abilities' });

    game.processAllTicks(1);

    expect(log).toEqual(['input-b', 'input-a', 'physics', 'abilities', 'late']);
    expect(game.systemNames()).toEqual({
      tick: ['input-b', 'input-a', 'physics', 'abilities', 'late'],
      frame: [],
    });
  });

  it('runs frame phases in order', () => {
    const log: string[] = [];
    const game = world();
    game.addSystem(new Named('present', log), { phase: 'present' });
    game.addSystem(new Named('render', log), { phase: 'render' });
    game.addSystem(new Named('interpolation', log), { phase: 'interpolation' });

    game.updateAll(0.016);

    expect(log).toEqual(['interpolation', 'render', 'present']);
    expect(game.systemNames().frame).toEqual([
      'interpolation',
      'render',
      'present',
    ]);
  });

  it('applies before and after inside a phase', () => {
    const log: string[] = [];
    const game = world();
    game.addSystem(new Named('middle', log), { phase: 'physics' });
    game.addSystem(new Named('last', log), {
      phase: 'physics',
      after: 'middle',
    });
    game.addSystem(new Named('first', log), {
      phase: 'physics',
      before: ['middle', 'last'],
    });

    game.processAllTicks(1);

    expect(log).toEqual(['first', 'middle', 'last']);
  });

  it('throws on a constraint cycle when the world starts', () => {
    const log: string[] = [];
    const provider = manualTickProvider();
    const started = new GameWorld({ tickFrameProvider: provider });
    started.addSystem(new Named('a', log), { phase: 'late', after: 'b' });
    started.addSystem(new Named('b', log), { phase: 'late', after: 'a' });

    expect(() => started.start()).toThrow(
      "world.start: system order cycle in phase 'late': a → b → a"
    );
  });

  it('throws when a constraint names another phase', () => {
    const log: string[] = [];
    const game = world();
    game.addSystem(new Named('early', log), { phase: 'input' });
    game.addSystem(new Named('scoring', log), {
      phase: 'late',
      before: 'early',
    });

    expect(() => game.systemNames()).toThrow(
      "world.systemNames: system 'scoring' is before 'early', which is in phase 'input' not 'late'"
    );
  });

  it('throws when a constraint names an unknown system', () => {
    const game = world();
    game.addSystem(new Named('scoring', []), {
      phase: 'late',
      after: 'missing',
    });

    expect(() => game.processAllTicks(1)).toThrow(
      "world.processAllTicks: system 'scoring' is after unknown system 'missing'"
    );
  });

  it('throws when addSystem is called after start', () => {
    const provider = manualTickProvider();
    const game = new GameWorld({ tickFrameProvider: provider });
    game.addSystem(new Named('scoring', []), { phase: 'late' });
    game.start();

    expect(() =>
      game.addSystem(new Named('later', []), { phase: 'late' })
    ).toThrow('world.addSystem: system order is frozen');
    provider.step(1);
    game.stop();
  });

  it('rejects an unknown phase, an empty name, and a duplicate name', () => {
    const game = world();
    const named = new Named('scoring', []);
    expect(() => game.addSystem(named, { phase: 'sim' as 'late' })).toThrow(
      /unknown phase 'sim'/
    );
    game.addSystem(named, { phase: 'late' });
    expect(() => game.addSystem(named, { phase: 'late' })).toThrow(
      "world.addSystem: system instance 'scoring' is already registered"
    );
    expect(() =>
      game.addSystem(new Named('scoring', []), { phase: 'late' })
    ).toThrow("world.addSystem: system name 'scoring' is already registered");

    class Blank extends GameSystem {
      public override readonly name = '';
    }
    expect(() => game.addSystem(new Blank(), { phase: 'late' })).toThrow(
      'world.addSystem: system name is required'
    );
  });

  it('names updateAll when a frame constraint cannot be resolved', () => {
    const game = world();
    game.addSystem(new Named('draw', []), {
      phase: 'render',
      after: 'missing',
    });

    expect(() => game.updateAll(0)).toThrow(
      "world.updateAll: system 'draw' is after unknown system 'missing'"
    );
  });

  it('inits each ordered system once from SystemRegistry', () => {
    const seen: string[] = [];
    class Probe extends GameSystem {
      public override readonly name = 'probe';

      public override init(): void {
        seen.push(this.name);
      }
    }
    const registry = new SystemRegistry();
    const probe = new Probe();
    registry.add(probe);
    registry.setOrder([probe], [probe]);
    registry.init();

    expect(seen).toEqual(['probe']);
  });
});
