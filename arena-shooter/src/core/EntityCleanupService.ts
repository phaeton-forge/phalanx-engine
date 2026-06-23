import type { EntityManager, Entity } from '@phalanx-engine/ecs';
import type { Mesh } from '@babylonjs/core';
import type { EntityFactory } from './EntityFactory.ts';

export class EntityCleanupService {
  private entityManager: EntityManager;
  private meshMap: Map<number, Mesh>;
  private entityFactory: EntityFactory;

  constructor(entityManager: EntityManager, meshMap: Map<number, Mesh>, entityFactory: EntityFactory) {
    this.entityManager = entityManager;
    this.meshMap = meshMap;
    this.entityFactory = entityFactory;
  }

  public cleanupDestroyedEntities(): void {
    const destroyed = this.entityManager.cleanupDestroyed();

    for (const entity of destroyed) {
      this.disposeMesh(entity);
      this.entityFactory.disposeParticles(entity.id);
    }
  }

  private disposeMesh(entity: Entity): void {
    const mesh = this.meshMap.get(entity.id);
    if (mesh) {
      mesh.dispose(false, true);
      this.meshMap.delete(entity.id);
    }
  }
}
