import { manualTickProvider } from './support/manualTickProvider.js';
import {
  GameWorld,
  SoAComponent,
  type SystemContext,
} from '@phalanx-engine/ecs';

/**
 * Isolated physics tests build a `SystemContext` without a `GameWorld`.
 * `PhysicsSystem` and `CollisionSystem` register their save section on
 * that world, so the context has to own one before `init`.
 */
export function bindTestWorld(context: SystemContext): GameWorld {
  const entityManager = context.entityManager;
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  context.world = world;
  SoAComponent.useEntityManager(entityManager);
  return world;
}
