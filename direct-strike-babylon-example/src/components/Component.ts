import type { IComponent } from 'phalanx-babylon-ecs';
import { createComponentTypeRegistry } from 'phalanx-babylon-ecs';

// Re-export IComponent for convenience
export type { IComponent };

/**
 * Component type symbols for type-safe component queries
 * Using symbols ensures uniqueness and good performance for Map keys
 */
export const ComponentType = createComponentTypeRegistry({
  Team: 'Team',
  Health: 'Health',
  Attack: 'Attack',
  Movement: 'Movement',
  Selectable: 'Selectable',
  Renderable: 'Renderable',
  UnitType: 'UnitType',
  Resource: 'Resource',
  Animation: 'Animation',
  Rotation: 'Rotation',
  AttackLock: 'AttackLock',
  Death: 'Death',
  PhysicsBody: 'PhysicsBody',
  HealthBar: 'HealthBar',
  Interpolation: 'Interpolation',
});

export type ComponentTypeKey = keyof typeof ComponentType;
