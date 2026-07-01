import { createComponentTypeRegistry } from '@phalanx-engine/ecs';
import {
  TRANSFORM_COMPONENT_TYPE,
  PHYSICS_BODY_COMPONENT_TYPE,
  INTERPOLATION_COMPONENT_TYPE,
} from '@phalanx-engine/physics';

/**
 * Component type symbols for type-safe component queries.
 *
 * Transform / PhysicsBody / Interpolation reuse the library symbols from
 * @phalanx-engine/physics so chapaev entities share the library's SoA stores
 * and systems. Remaining component types are game-specific.
 */
const localTypes = createComponentTypeRegistry({
  Checker: 'Checker',
  Board: 'Board',
  GameState: 'GameState',
  Player: 'Player',
});

export const ComponentType = {
  ...localTypes,
  Transform: TRANSFORM_COMPONENT_TYPE,
  PhysicsBody: PHYSICS_BODY_COMPONENT_TYPE,
  Interpolation: INTERPOLATION_COMPONENT_TYPE,
} as const;

export type ComponentTypeKey = keyof typeof ComponentType;
