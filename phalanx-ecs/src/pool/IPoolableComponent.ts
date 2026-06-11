import type { IComponent } from '../Component';

/**
 * Engine-called lifecycle hooks for components owned by pooled entities.
 * PoolManager invokes them automatically on spawn/despawn — game code never
 * calls them and entity authors don't need to know which components implement it.
 *
 * Use cases: SoAComponent re-adds/removes its store row; render components
 * toggle visibility.
 */
export interface IPoolableComponent extends IComponent {
  /** Restore backing storage to constructor defaults (e.g. re-add the SoA row). */
  onSpawn(): void;
  /** Release transient/backing storage (e.g. remove the SoA row, hide the mesh). Idempotent. */
  onDespawn(): void;
}

/** Type guard used by PoolManager. */
export function isPoolableComponent(c: IComponent): c is IPoolableComponent {
  return typeof (c as IPoolableComponent).onSpawn === 'function'
    && typeof (c as IPoolableComponent).onDespawn === 'function';
}
