// Component system exports
export { ComponentType } from './Component';
export type { IComponent, ComponentTypeKey } from './Component';

// SoA schemas (co-located with their component classes)
export { TransformSoASchema } from './TransformComponent';
export { PhysicsSoASchema } from '@phalanx-engine/physics';

export { TeamComponent } from './TeamComponent';
export { HealthComponent } from './HealthComponent';
export { DeathComponent } from './DeathComponent'; // Add death timer component
export { AttackComponent } from './AttackComponent';
export type { AttackConfig, AttackType } from './AttackComponent';
export { MovementComponent } from './MovementComponent';
export { UnitTypeComponent, UnitType, UnitGridSize } from './UnitTypeComponent';
export { ResourceComponent } from './ResourceComponent';
export { AnimationComponent, AnimationState } from './AnimationComponent';
export type { AnimationStateType, AnimationNames } from './AnimationComponent';
export { RotationComponent } from './RotationComponent';
export { AttackLockComponent } from './AttackLockComponent';
export { PhysicsBodyComponent } from '@phalanx-engine/physics';
export { HealthBarComponent } from './HealthBarComponent';
export { InterpolationComponent } from './InterpolationComponent';
export { TransformComponent } from './TransformComponent';
export { ProjectileComponent } from './ProjectileComponent';
