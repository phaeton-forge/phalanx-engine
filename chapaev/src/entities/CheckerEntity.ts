import { Entity } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FPVector3 as FPVector3Type } from 'phalanx-math';
import { TransformComponent } from '../components/TransformComponent.ts';
import { CheckerComponent } from '../components/CheckerComponent.ts';
import { PhysicsBodyComponent } from '../components/PhysicsBodyComponent.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import { CHECKER_RADIUS, CHECKER_MASS, FRICTION } from '../config/constants.ts';

/**
 * Creates a checker entity with transform, checker, and physics body components.
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
    friction: FP.FromFloat(FRICTION),
  }));
  return entity;
}

