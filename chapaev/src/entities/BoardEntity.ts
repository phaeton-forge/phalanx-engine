import { Entity } from '@phalanx-engine/ecs';
import { TransformComponent } from '../components';
import { BoardComponent } from '../components/BoardComponent.ts';
import { FPVector3 } from '@phalanx-engine/math';

/**
 * Creates a board entity at the world origin.
 */
export function createBoardEntity(): Entity {
  const entity = new Entity();
  entity.addComponent(new TransformComponent(entity.id, FPVector3.Zero));
  entity.addComponent(new BoardComponent());
  return entity;
}

