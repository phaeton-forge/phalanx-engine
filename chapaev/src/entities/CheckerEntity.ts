import { Entity } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FPVector3 as FPVector3Type } from '@phalanx-engine/math';
import { TransformComponent, PhysicsBodyComponent } from '../components';
import { CheckerComponent } from '../components/CheckerComponent.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import {
  CHECKER_RADIUS,
  CHECKER_MASS,
  FRICTION,
  RESTITUTION,
  PHYSICS_DT,
} from '../config/constants.ts';

/**
 * Creates a checker entity with transform, checker, and physics body components.
 *
 * The library PhysicsSystem applies friction as a per-sub-step multiplier, so
 * the legacy friction coefficient is converted to a decay factor. With
 * subSteps=1 this reproduces the original per-tick damping of `1 - FRICTION*dt`.
 */
export function createCheckerEntity(
  team: TeamTag,
  position: FPVector3Type,
): Entity {
  const entity = new Entity();
  entity.addComponent(new TransformComponent(entity.id, position));
  entity.addComponent(new CheckerComponent(team));
  entity.addComponent(new PhysicsBodyComponent(entity.id, {
    radius: FP.FromFloat(CHECKER_RADIUS),
    mass: FP.FromFloat(CHECKER_MASS),
    restitution: FP.FromFloat(RESTITUTION),
    friction: FP.FromFloat(1 - FRICTION * PHYSICS_DT),
  }));
  return entity;
}
