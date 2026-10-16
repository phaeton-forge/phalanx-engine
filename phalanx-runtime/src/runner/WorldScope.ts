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
 * `run` saves the current globals, installs this scope's counter and
 * EntityManager, runs `fn` synchronously, stores the counter back and
 * restores the previous globals. Re-entering the same scope (snapshot
 * taken from inside a tick) keeps the globals already installed.
 * Simulation code must never yield inside a tick.
 */
export class WorldScope {
  private counter = 0;
  private manager: EntityManager | null = null;
  private depth = 0;

  public run<T>(fn: () => T): T {
    const outer = this.depth === 0;
    let previousCounter = 0;
    let previousManager: EntityManager | null = null;
    if (outer) {
      previousCounter = getEntityIdCounter();
      previousManager = SoAComponent.currentEntityManager();
      setEntityIdCounter(this.counter);
      SoAComponent.useEntityManager(this.manager);
    }
    this.depth += 1;
    try {
      return fn();
    } finally {
      this.depth -= 1;
      if (outer) {
        this.counter = getEntityIdCounter();
        this.manager = SoAComponent.currentEntityManager();
        setEntityIdCounter(previousCounter);
        SoAComponent.useEntityManager(previousManager);
      }
    }
  }
}
