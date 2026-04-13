import { Entity } from 'phalanx-ecs';
import type { FPVector3 as FPVector3Type } from 'phalanx-math';
import { TransformComponent } from '../components/TransformComponent.ts';
import { CheckerComponent } from '../components/CheckerComponent.ts';
import { TeamTag } from '../enums/TeamTag.ts';

/**
 * Creates a checker entity with transform and checker components.
 */
export function createCheckerEntity(
  team: TeamTag,
  position: FPVector3Type,
): Entity {
  const entity = new Entity();
  entity.addComponent(new TransformComponent(entity.id, position));
  entity.addComponent(new CheckerComponent(team));
  return entity;
}

