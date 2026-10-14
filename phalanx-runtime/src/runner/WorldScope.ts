import { notImplemented } from '../notImplemented.js';

/**
 * Isolates the two process-global registers of phalanx-ecs — the entity id
 * counter (`Entity.ts`) and the `SoAComponent` EntityManager context — per
 * world, so several matches can run in one Node process (SimHost) or one
 * test.
 *
 * `run(fn)` saves the current globals, installs this scope's counter and
 * EntityManager, runs `fn` synchronously, stores the counter back and
 * restores the previous globals. The runner wraps EVERY entry into its
 * world in `run`: `createWorld`, each tick, `snapshot`, `restore` and bot
 * decisions. Simulation code must never yield (`await`, timers) inside a
 * tick, which lockstep already requires.
 *
 * Requires the Task 3 ecs accessors `getEntityIdCounter`,
 * `setEntityIdCounter` and `SoAComponent.currentEntityManager()`.
 */
export class WorldScope {
  public constructor() {
    notImplemented('WorldScope', 6);
  }

  public run<T>(_fn: () => T): T {
    return notImplemented('WorldScope.run', 6);
  }
}
