import { describe, expect, it } from 'vitest';
import { GameSystem, GameWorld } from '../src/index.js';
import type { SystemContext } from '../src/index.js';
import { manualTickProvider } from './support/manualTickProvider.js';

class Recorder extends GameSystem {
  public inits = 0;

  public constructor(
    private readonly label: string,
    private readonly log: string[]
  ) {
    super();
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.inits += 1;
  }

  public override processTick(): void {
    this.log.push(this.label);
  }

  public override update(): void {
    this.log.push(this.label);
  }
}

class ModuleTick extends Recorder {}
class ModuleFrame extends Recorder {}

function world(): GameWorld {
  return new GameWorld({ tickFrameProvider: manualTickProvider() });
}

describe('world.addModuleSystems', () => {
  it('runs module systems before the given systems and inits them once per registerSystems', () => {
    const log: string[] = [];
    const w = world();
    const tick = new ModuleTick('module-tick', log);
    const frame = new ModuleFrame('module-frame', log);
    w.addModuleSystems([tick], [frame]);
    expect(w.getSystem(ModuleTick)).toBe(tick);
    expect(tick.inits).toBe(0);

    w.registerSystems(
      [new Recorder('game-tick', log)],
      [new Recorder('game-frame', log)]
    );
    expect(tick.inits).toBe(1);
    expect(frame.inits).toBe(1);

    w.processAllTicks(1);
    w.updateAll(0.016);
    expect(log).toEqual([
      'module-tick',
      'game-tick',
      'module-frame',
      'game-frame',
    ]);
  });

  it('keeps the position of a module system listed explicitly', () => {
    const log: string[] = [];
    const w = world();
    const tick = new ModuleTick('module-tick', log);
    w.addModuleSystems([tick], []);
    w.registerSystems([new Recorder('game-tick', log), tick], []);
    w.processAllTicks(1);
    expect(log).toEqual(['game-tick', 'module-tick']);
  });

  it('rejects a partial or reordered module group', () => {
    const a = new ModuleTick('a', []);
    const b = new ModuleTick('b', []);
    const partial = world();
    partial.addModuleSystems([a, b], []);
    expect(() => partial.registerSystems([a], [])).toThrow('or none of them');
    const reordered = world();
    reordered.addModuleSystems([a, b], []);
    expect(() => reordered.registerSystems([b, a], [])).toThrow(
      'must keep their order'
    );
    const whole = world();
    whole.addModuleSystems([a, b], []);
    expect(() =>
      whole.registerSystems([new ModuleTick('g', []), a, b], [])
    ).not.toThrow();
  });

  it('throws after registerSystems', () => {
    const w = world();
    w.registerSystems([], []);
    expect(() => {
      w.addModuleSystems([new ModuleTick('late', [])], []);
    }).toThrow(
      'addModuleSystems: call before registerSystems (attach modules first)'
    );
  });
});
