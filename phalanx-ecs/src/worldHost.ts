import type { Entity } from './Entity.js';
import type { GameWorld } from './GameWorld.js';
import type {
  SoAFieldsOf,
  SoASchema,
  SoASchemaDefinition,
} from './SoASchema.js';

/**
 * Save / spawn implementation installed by `@phalanx-engine/runtime`.
 * ECS does not own the byte format.
 */
export interface WorldModuleHost {
  save(world: GameWorld): Uint8Array;
  restore(world: GameWorld, bytes: Uint8Array): void;
  spawn(
    world: GameWorld,
    spec: Readonly<Record<string, Readonly<Record<string, number | bigint>>>>
  ): Entity;
  despawn(world: GameWorld, entity: Entity): void;
  each<S extends SoASchemaDefinition>(
    world: GameWorld,
    component: { readonly schema: SoASchema<S> },
    fn: (view: SoAFieldsOf<S>) => void
  ): void;
}

let host: WorldModuleHost | null = null;

/** @internal Called once when the runtime package is imported. */
export function setWorldModuleHost(next: WorldModuleHost): void {
  host = next;
}

export function requireWorldModules(): WorldModuleHost {
  if (host === null) {
    throw new Error(
      'GameWorld: world modules are not installed. Import @phalanx-engine/runtime before using save, restore, spawn, despawn, or each.'
    );
  }
  return host;
}
