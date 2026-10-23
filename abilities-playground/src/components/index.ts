import type {
  FPQuaternion as FPQuaternionType,
  FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';
import { readFpPosition, readFpRotation } from '@phalanx-engine/physics';
import { ComponentType } from './Component';

export { ComponentType };
export type { ComponentTypeKey, IComponent } from './Component';
export { TransformSoASchema } from '@phalanx-engine/physics';

/** Copy of the shared transform scratch. Safe to keep. */
export function copyFpPosition(entityId: number): FPVector3Type {
  const value = readFpPosition(entityId);
  return { x: value.x, y: value.y, z: value.z };
}

/** Copy of the shared rotation scratch. Safe to keep. */
export function copyFpRotation(entityId: number): FPQuaternionType {
  const value = readFpRotation(entityId);
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}
export {
  TeamComponent,
  UnitTypeComponent,
  StatsComponent,
  TargetStateComponent,
  MeshComponent,
  HealthBarComponent,
  DeathFadeComponent,
  SimulationStateComponent,
  DetectionRingComponent,
  HealAuraComponent,
  CubeStateComponent,
  AutoAttackTimerComponent,
  SupportUnitTargetingComponent,
  TurretComponent,
} from './UnitComponents';
export type { TeamId } from './UnitComponents';
export { SpawnPointComponent } from './SpawnPointComponent';
export { MissileComponent } from './MissileComponent';
export { ArtilleryShellComponent } from './ArtilleryShellComponent';
export type { ShrapnelConfig } from './ArtilleryShellComponent';
export { ShrapnelPayloadComponent } from './ShrapnelPayloadComponent';
