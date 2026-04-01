import type { IComponent } from 'phalanx-ecs';
import { createComponentTypeRegistry } from 'phalanx-ecs';
import { PHYSICS_BODY_COMPONENT_TYPE } from 'phalanx-physics';

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
  HealthBar: 'HealthBar',
  Interpolation: 'Interpolation',
  Transform: 'Transform',
  Projectile: 'Projectile',
  PhysicsBody: 'PhysicsBody',
});

// Override PhysicsBody to use the canonical symbol from phalanx-physics
// so that entity.getComponent(ComponentType.PhysicsBody) resolves correctly
(ComponentType as Record<string, symbol>).PhysicsBody = PHYSICS_BODY_COMPONENT_TYPE;

export type ComponentTypeKey = keyof typeof ComponentType;
