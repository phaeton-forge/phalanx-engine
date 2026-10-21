import { SoAComponent, type EntityManager } from '@phalanx-engine/ecs';

/**
 * Isolates the process-global `SoAComponent` EntityManager context per
 * world, so several matches can run in one Node process.
 *
 * The entity id counter lives on each world's EntityManager and is not
 * swapped here.
 *
 * One scope is active at a time. Entering a different scope stores the
 * active scope's EntityManager, then installs this scope's. Leaving
 * restores the previous scope. Immediate re-entry into the scope that
 * is already active does not touch the context. Simulation code must
 * never yield inside a tick.
 */
export class WorldScope {
  private static active: WorldScope | null = null;
  private manager: EntityManager | null = null;

  public run<T>(fn: () => T): T {
    if (WorldScope.active === this) return fn();
    const previous = WorldScope.active;
    if (previous === null) captureAmbient();
    else previous.capture();
    this.install();
    WorldScope.active = this;
    try {
      return fn();
    } finally {
      this.capture();
      if (previous === null) restoreAmbient();
      else previous.install();
      WorldScope.active = previous;
    }
  }

  private capture(): void {
    this.manager = SoAComponent.currentEntityManager();
  }

  private install(): void {
    SoAComponent.useEntityManager(this.manager);
  }
}

const ambient = {
  manager: null as EntityManager | null,
};

function captureAmbient(): void {
  ambient.manager = SoAComponent.currentEntityManager();
}

function restoreAmbient(): void {
  SoAComponent.useEntityManager(ambient.manager);
}
