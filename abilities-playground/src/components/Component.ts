import { createComponentTypeRegistry } from 'phalanx-ecs';
import type { IComponent } from 'phalanx-ecs';
import { PHYSICS_BODY_COMPONENT_TYPE } from 'phalanx-physics';

export type { IComponent };

export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Team: 'Team',
  UnitType: 'UnitType',
  UnitStats: 'UnitStats',
  TargetState: 'TargetState',
  RenderRefs: 'RenderRefs',
  HealthBar: 'HealthBar',
  DeathFade: 'DeathFade',
  HealerAuraLink: 'HealerAuraLink',
  ConeBeam: 'ConeBeam',
  Interpolation: 'Interpolation',
  SimulationState: 'SimulationState',
  PhysicsBody: 'PhysicsBody',
});

(ComponentType as Record<string, symbol>).PhysicsBody =
  PHYSICS_BODY_COMPONENT_TYPE;

export type ComponentTypeKey = keyof typeof ComponentType;
