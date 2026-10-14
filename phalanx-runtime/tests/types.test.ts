import { describe, expectTypeOf, it } from 'vitest';
import {
  defineGame,
  type AnyGameDefinition,
  type CommandOf,
  type ConfigOf,
  type MatchRunner,
  type SimOf,
  type StateWriter,
} from '../src/index.js';
import {
  TinyGame,
  type TinyCommand,
  type TinyConfig,
  type TinySim,
} from './fixtures/tinyGame.js';

describe('contract types', () => {
  it('infers config, command and sim types from a game definition', () => {
    expectTypeOf<ConfigOf<typeof TinyGame>>().toEqualTypeOf<TinyConfig>();
    expectTypeOf<CommandOf<typeof TinyGame>>().toEqualTypeOf<TinyCommand>();
    expectTypeOf<SimOf<typeof TinyGame>>().toEqualTypeOf<TinySim>();
  });

  it('accepts a concrete game where any game definition is expected', () => {
    const anyGame: AnyGameDefinition = TinyGame;
    expectTypeOf(anyGame).toMatchTypeOf<AnyGameDefinition>();
  });

  it('types MatchRunner.submit with the game command union', () => {
    expectTypeOf<
      Parameters<MatchRunner<typeof TinyGame>['submit']>[0]
    >().toEqualTypeOf<TinyCommand>();
  });

  it('rejects definitions without a state spec', () => {
    const { state: _state, ...withoutState } = TinyGame;
    // @ts-expect-error `state` is required
    expectTypeOf(defineGame).toBeCallableWith(withoutState);
  });

  it('exposes no float writer on StateWriter', () => {
    expectTypeOf<StateWriter>().not.toHaveProperty('f64');
    expectTypeOf<StateWriter>().not.toHaveProperty('f32');
    expectTypeOf<StateWriter>().toHaveProperty('i64');
  });
});
