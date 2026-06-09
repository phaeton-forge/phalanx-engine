import { createComponentTypeRegistry } from 'phalanx-ecs';
import type { IComponent } from 'phalanx-ecs';
import {
  INTERPOLATION_COMPONENT_TYPE,
  PHYSICS_BODY_COMPONENT_TYPE,
  TRANSFORM_COMPONENT_TYPE,
} from 'phalanx-physics';

export type { IComponent };

export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Team: 'Team',
  UnitType: 'UnitType',
  Projectile: 'Projectile',
  UnitStats: 'UnitStats',
  TargetState: 'TargetState',
  Mesh: 'Mesh',
  HealthBar: 'HealthBar',
  DeathFade: 'DeathFade',
  Interpolation: 'Interpolation',
  SimulationState: 'SimulationState',
  PhysicsBody: 'PhysicsBody',
  SpawnPoint: 'SpawnPoint',
  DetectionRing: 'DetectionRing',
});

(ComponentType as Record<string, symbol>).PhysicsBody =
  PHYSICS_BODY_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).Transform = TRANSFORM_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).Interpolation =
  INTERPOLATION_COMPONENT_TYPE;

export type ComponentTypeKey = keyof typeof ComponentType;
