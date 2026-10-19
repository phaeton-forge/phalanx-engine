import type { GameWorld } from '@phalanx-engine/ecs';
import type { SaveSpec } from '../state/GameState.js';
import { readWorld, writeWorld } from './modules.js';

/**
 * Default `defineGame` save handler: the world modules, format version 1.
 * Engine sections match `StateHelpers`. Registered module sections follow them.
 */
export function createDefaultWorldState<
  Sim extends { readonly world: GameWorld },
>(): SaveSpec<Sim> {
  return {
    formatVersion: 1,
    handler: (sim) => ({
      save(writer) {
        writeWorld(sim.world, writer);
      },
      restore(reader) {
        readWorld(sim.world, reader);
      },
    }),
  };
}
