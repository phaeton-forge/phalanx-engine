import { createComponentTypeRegistry } from 'phalanx-ecs';
import { PHYSICS_BODY_COMPONENT_TYPE } from 'phalanx-physics';

export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  PhysicsBody: 'PhysicsBody',
  Interpolation: 'Interpolation',
  PlayerInput: 'PlayerInput',
  Weapon: 'Weapon',
  EnemyAI: 'EnemyAI',
  Projectile: 'Projectile',
  Pickup: 'Pickup',
  Wave: 'Wave',
  Health: 'Health',
  EntityType: 'EntityType',
});

// Override PhysicsBody with canonical symbol from phalanx-physics
(ComponentType as Record<string, symbol>).PhysicsBody = PHYSICS_BODY_COMPONENT_TYPE;
