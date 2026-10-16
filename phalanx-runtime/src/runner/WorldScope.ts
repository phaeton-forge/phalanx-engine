import {
  SoAComponent,
  getEntityIdCounter,
  setEntityIdCounter,
  type EntityManager,
} from '@phalanx-engine/ecs';

/**
 * Isolates the two process-global registers of phalanx-ecs — the entity id
 * counter and the `SoAComponent` EntityManager context — per world, so
 * several matches can run in one Node process.
 *
 * One scope is active at a time. Entering a different scope stores the
 * active scope's live registers back into that scope, then installs this
 * scope's saved counter and EntityManager. Leaving restores the previous
 * scope. Immediate re-entry into the scope that is already active does
 * not touch the registers, so a snapshot taken from inside a tick does
 * not rewind the counter. Simulation code must never yield inside a tick.
 */
export class WorldScope {
  private static active: WorldScope | null = null;
  private counter = 0;
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
    this.counter = getEntityIdCounter();
    this.manager = SoAComponent.currentEntityManager();
  }

  private install(): void {
    setEntityIdCounter(this.counter);
    SoAComponent.useEntityManager(this.manager);
  }
}

const ambient = {
  counter: 0,
  manager: null as EntityManager | null,
};

function captureAmbient(): void {
  ambient.counter = getEntityIdCounter();
  ambient.manager = SoAComponent.currentEntityManager();
}

function restoreAmbient(): void {
  setEntityIdCounter(ambient.counter);
  SoAComponent.useEntityManager(ambient.manager);
}
