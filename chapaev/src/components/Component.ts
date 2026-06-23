import { createComponentTypeRegistry } from '@phalanx-engine/ecs';

/**
 * Component type symbols for type-safe component queries.
 * Using symbols ensures uniqueness and good performance for Map keys.
 */
export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Checker: 'Checker',
  Board: 'Board',
  PhysicsBody: 'PhysicsBody',
  GameState: 'GameState',
  Player: 'Player',
  Interpolation: 'Interpolation',
});

export type ComponentTypeKey = keyof typeof ComponentType;

