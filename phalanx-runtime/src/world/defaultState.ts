import type { GameWorld } from '@phalanx-engine/ecs';
import type { GameStateSpec } from '../state/GameState.js';
import { readWorld, writeWorld } from './modules.js';

/**
 * Default `defineGame` state: the world modules, format version 1.
 * Section bytes match a manual `StateHelpers` save of the same world.
 */
export function createDefaultWorldState<
  Sim extends { readonly world: GameWorld },
>(): GameStateSpec<Sim> {
  return {
    formatVersion: 1,
    bind: (sim) => ({
      save(writer) {
        writeWorld(sim.world, writer);
      },
      restore(reader) {
        readWorld(sim.world, reader);
      },
    }),
  };
}
