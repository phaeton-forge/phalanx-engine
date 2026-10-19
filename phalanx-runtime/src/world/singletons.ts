import type { GameWorld } from '@phalanx-engine/ecs';
import type { StateReader, StateWriter } from '@phalanx-engine/ecs';

/**
 * Optional bytes after the engine sections. Used for simulation
 * singletons that are not entities. `onSave` and `onRestore` must write
 * and read the same sections.
 */
export interface WorldSingletonHooks {
  onSave?(writer: StateWriter): void;
  onRestore?(reader: StateReader): void;
}

const hooksByWorld = new WeakMap<GameWorld, WorldSingletonHooks>();

/** Attach the `game` world module for one world. */
export function bindWorldSingletons(
  world: GameWorld,
  hooks: WorldSingletonHooks
): void {
  hooksByWorld.set(world, hooks);
}

export function singletonHooks(
  world: GameWorld
): WorldSingletonHooks | undefined {
  return hooksByWorld.get(world);
}
