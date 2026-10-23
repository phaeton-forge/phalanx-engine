import type { IComponent } from '@phalanx-engine/ecs';
import { Interpolation, PhysicsBody, Transform } from '@phalanx-engine/physics';

export type { IComponent };

export const ComponentType = {
  Transform: Transform.type,
  Team: Symbol('Team'),
  UnitType: Symbol('UnitType'),
  Projectile: Symbol('Projectile'),
  UnitStats: Symbol('UnitStats'),
  TargetState: Symbol('TargetState'),
  Mesh: Symbol('Mesh'),
  HealthBar: Symbol('HealthBar'),
  DeathFade: Symbol('DeathFade'),
  Interpolation: Interpolation.type,
  SimulationState: Symbol('SimulationState'),
  PhysicsBody: PhysicsBody.type,
  SpawnPoint: Symbol('SpawnPoint'),
  DetectionRing: Symbol('DetectionRing'),
  HealAura: Symbol('HealAura'),
  CubeState: Symbol('CubeState'),
  AutoAttackTimer: Symbol('AutoAttackTimer'),
  Missile: Symbol('Missile'),
  SupportUnitTargeting: Symbol('SupportUnitTargeting'),
  Turret: Symbol('Turret'),
  ArtilleryShell: Symbol('ArtilleryShell'),
  ShrapnelPayload: Symbol('ShrapnelPayload'),
} as const;

export type ComponentTypeKey = keyof typeof ComponentType;
